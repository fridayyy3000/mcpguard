import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";

import { z } from "zod";

import { logger } from "../shared/logger.js";
import {
  parseProviderDelta,
  replaceProviderContent,
  syntheticContentDelta,
} from "./provider-stream.js";
import { StreamingPiiRedactor, type RedactionStats } from "./redactor.js";
import { serializeSseData, SseParser, type SseEvent } from "./sse.js";

const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;

const streamingGenerationRequestSchema = z
  .object({ stream: z.literal(true) })
  .passthrough();

export interface LlmGatewayConfig {
  providerUrl: URL;
  providerApiKey?: string;
  maxRequestBytes?: number;
  fetchImplementation?: typeof fetch;
}

class BodyTooLargeError extends Error {}
class ClientDisconnectedError extends Error {}

function isJsonContentType(contentType: string | undefined): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function isEventStream(contentType: string | null): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream"
  );
}

async function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BodyTooLargeError("Request body is too large");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;

    if (totalBytes > maxBytes) {
      throw new BodyTooLargeError("Request body is too large");
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks);
}

function sendJsonError(
  response: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  const body = JSON.stringify({ error: { code, message } });
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function providerHeaders(
  request: IncomingMessage,
  providerApiKey: string | undefined,
): Headers {
  const headers = new Headers({
    accept: "text/event-stream",
    "content-type": "application/json",
  });

  if (providerApiKey) {
    headers.set("authorization", `Bearer ${providerApiKey}`);
  }

  const requestId = request.headers["x-request-id"];
  if (typeof requestId === "string") {
    headers.set("x-request-id", requestId);
  }

  return headers;
}

async function writeWithBackpressure(
  response: ServerResponse,
  value: string,
): Promise<void> {
  if (response.destroyed || response.writableEnded) {
    throw new ClientDisconnectedError("Client disconnected");
  }

  if (!response.write(value)) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        response.off("drain", onDrain);
        response.off("close", onClose);
      };
      const onDrain = (): void => {
        cleanup();
        resolve();
      };
      const onClose = (): void => {
        cleanup();
        reject(new ClientDisconnectedError("Client disconnected"));
      };

      response.once("drain", onDrain);
      response.once("close", onClose);
    });
  }
}

async function writeDataEvent(
  response: ServerResponse,
  data: string,
  event?: string,
): Promise<void> {
  await writeWithBackpressure(response, serializeSseData(data, event));
}

async function writeContent(
  response: ServerResponse,
  content: string,
): Promise<void> {
  if (content.length > 0) {
    await writeDataEvent(
      response,
      JSON.stringify(syntheticContentDelta(content)),
    );
  }
}

interface StreamState {
  done: boolean;
}

async function processProviderEvent(
  event: SseEvent,
  response: ServerResponse,
  redactor: StreamingPiiRedactor,
  state: StreamState,
): Promise<void> {
  if (event.data.trim() === "[DONE]") {
    await writeContent(response, redactor.finish());
    await writeDataEvent(response, "[DONE]", event.event);
    state.done = true;
    return;
  }

  const providerDelta = parseProviderDelta(event.data);

  if (providerDelta.content !== undefined) {
    let safeContent = redactor.push(providerDelta.content);

    if (providerDelta.terminal) {
      safeContent += redactor.finish();
    }

    // An empty safe result means this delta is still an unresolved PII
    // candidate. Suppressing the frame avoids leaking a partial identifier.
    if (safeContent.length > 0 || providerDelta.terminal) {
      const output = replaceProviderContent(providerDelta, safeContent);
      await writeDataEvent(response, JSON.stringify(output), event.event);
    }

    return;
  }

  if (providerDelta.terminal) {
    await writeContent(response, redactor.finish());
  }

  // Metadata-only events (for example, the initial role delta or usage data)
  // contain no user text and can pass through without inspection.
  await writeDataEvent(
    response,
    JSON.stringify(providerDelta.payload),
    event.event,
  );
}

async function streamProviderBody(
  providerBody: ReadableStream<Uint8Array>,
  response: ServerResponse,
): Promise<RedactionStats> {
  const parser = new SseParser();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const redactor = new StreamingPiiRedactor();
  const state: StreamState = { done: false };

  for await (const bytes of providerBody) {
    const decoded = decoder.decode(bytes, { stream: true });

    for (const event of parser.push(decoded)) {
      await processProviderEvent(event, response, redactor, state);
      if (state.done) {
        break;
      }
    }

    if (state.done) {
      break;
    }
  }

  if (!state.done) {
    const finalDecoded = decoder.decode();
    const finalEvents = [...parser.push(finalDecoded), ...parser.finish()];

    for (const event of finalEvents) {
      await processProviderEvent(event, response, redactor, state);
      if (state.done) {
        break;
      }
    }
  }

  if (!state.done) {
    await writeContent(response, redactor.finish());
  }

  return redactor.getStats();
}

export function createLlmGatewayServer(config: LlmGatewayConfig): HttpServer {
  const maxRequestBytes = config.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const fetchImplementation = config.fetchImplementation ?? fetch;

  if (!Number.isInteger(maxRequestBytes) || maxRequestBytes <= 0) {
    throw new Error("maxRequestBytes must be a positive integer");
  }

  return createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://gateway.local");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const body = JSON.stringify({ status: "ok" });
        response.writeHead(200, {
          "content-length": Buffer.byteLength(body),
          "content-type": "application/json; charset=utf-8",
        });
        response.end(body);
        return;
      }

      if (
        request.method !== "POST" ||
        requestUrl.pathname !== "/v1/chat/completions"
      ) {
        sendJsonError(response, 404, "NOT_FOUND", "Not Found");
        return;
      }

      if (!isJsonContentType(request.headers["content-type"])) {
        sendJsonError(
          response,
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Content-Type must be application/json",
        );
        return;
      }

      let rawBody: Buffer;
      try {
        rawBody = await readBody(request, maxRequestBytes);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          sendJsonError(
            response,
            413,
            "REQUEST_TOO_LARGE",
            "Request body is too large",
          );
          return;
        }

        throw error;
      }

      let generationRequest: unknown;
      try {
        generationRequest = JSON.parse(rawBody.toString("utf8"));
      } catch {
        sendJsonError(response, 400, "INVALID_JSON", "Invalid JSON body");
        return;
      }

      if (
        !streamingGenerationRequestSchema.safeParse(generationRequest).success
      ) {
        sendJsonError(
          response,
          400,
          "STREAMING_REQUIRED",
          "Request must set stream to true",
        );
        return;
      }

      const abortController = new AbortController();
      const abortOnClientClose = (): void => {
        if (!response.writableEnded) {
          abortController.abort();
        }
      };
      response.once("close", abortOnClientClose);

      try {
        const providerResponse = await fetchImplementation(config.providerUrl, {
          method: "POST",
          headers: providerHeaders(request, config.providerApiKey),
          body: new Uint8Array(rawBody),
          signal: abortController.signal,
        });

        if (!providerResponse.ok) {
          await providerResponse.body?.cancel();
          sendJsonError(
            response,
            502,
            "PROVIDER_ERROR",
            `LLM provider returned HTTP ${providerResponse.status}`,
          );
          return;
        }

        if (
          !providerResponse.body ||
          !isEventStream(providerResponse.headers.get("content-type"))
        ) {
          await providerResponse.body?.cancel();
          sendJsonError(
            response,
            502,
            "INVALID_PROVIDER_RESPONSE",
            "LLM provider did not return an SSE stream",
          );
          return;
        }

        response.writeHead(200, {
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "content-type": "text/event-stream; charset=utf-8",
          "x-accel-buffering": "no",
          "x-content-type-options": "nosniff",
        });
        response.flushHeaders();

        const stats = await streamProviderBody(providerResponse.body, response);
        response.end();

        logger.info("LLM stream completed", {
          peak_buffered_characters: stats.peakBufferedCharacters,
          redaction_count: stats.redactionCount,
        });
      } catch (error) {
        if (
          error instanceof ClientDisconnectedError ||
          abortController.signal.aborted
        ) {
          return;
        }

        logger.error("LLM provider stream failed", {
          error_type:
            error instanceof Error ? error.constructor.name : "UnknownError",
        });

        if (!response.headersSent) {
          sendJsonError(
            response,
            502,
            "PROVIDER_UNAVAILABLE",
            "LLM provider unavailable",
          );
        } else if (!response.destroyed && !response.writableEnded) {
          await writeDataEvent(
            response,
            JSON.stringify({
              error: {
                code: "INVALID_PROVIDER_STREAM",
                message: "Provider stream could not be processed",
              },
            }),
            "error",
          );
          response.end();
        }
      } finally {
        response.off("close", abortOnClientClose);
      }
    })().catch(() => {
      if (!response.headersSent && !response.writableEnded) {
        sendJsonError(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal gateway error",
        );
      } else if (!response.writableEnded) {
        response.end();
      }
    });
  });
}
