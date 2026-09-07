import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";

import { logger } from "../shared/logger.js";
import { extractBearerToken, type TokenVerifier } from "./auth.js";
import { authorizeToolCall } from "./authorization.js";
import {
  AUTHENTICATION_REQUIRED,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  UNAUTHORIZED_TOOL_CALL,
  jsonRpcError,
  parseJsonRpcRequest,
  toolCallParamsSchema,
  type JsonRpcErrorResponse,
  type JsonRpcId,
} from "./json-rpc.js";

const DEFAULT_MAX_BODY_BYTES = 1_048_576;
const DEFAULT_DOWNSTREAM_TIMEOUT_MS = 5_000;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface GatewayConfig {
  downstreamUrl: URL;
  tokenVerifier: TokenVerifier;
  maxBodyBytes?: number;
  downstreamTimeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

class BodyTooLargeError extends Error {}

function isJsonContentType(contentType: string | undefined): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

async function readBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw new BodyTooLargeError("Request body is too large");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;

    if (totalBytes > maxBodyBytes) {
      throw new BodyTooLargeError("Request body is too large");
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks);
}

function sendJson(
  response: ServerResponse,
  httpStatus: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const serialized = JSON.stringify(body);

  response.writeHead(httpStatus, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(serialized),
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(serialized);
}

function sendRpcError(
  response: ServerResponse,
  httpStatus: number,
  error: JsonRpcErrorResponse,
  headers?: Record<string, string>,
): void {
  sendJson(response, httpStatus, error, headers);
}

function requestHeadersForDownstream(
  incomingHeaders: IncomingHttpHeaders,
): Headers {
  const outgoing = new Headers();

  for (const [name, value] of Object.entries(incomingHeaders)) {
    const lowerName = name.toLowerCase();

    // The caller's gateway credential must never leak to the downstream MCP
    // server. Hop-by-hop headers are owned by each HTTP connection.
    if (
      value === undefined ||
      lowerName === "authorization" ||
      HOP_BY_HOP_HEADERS.has(lowerName)
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        outgoing.append(name, item);
      }
    } else {
      outgoing.set(name, value);
    }
  }

  outgoing.set("content-type", "application/json");
  return outgoing;
}

function copyDownstreamHeaders(
  downstreamHeaders: Headers,
  response: ServerResponse,
): void {
  downstreamHeaders.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      response.setHeader(name, value);
    }
  });
}

async function forwardRequest(
  request: IncomingMessage,
  response: ServerResponse,
  rawBody: Buffer,
  requestId: JsonRpcId | undefined,
  method: string,
  config: Required<
    Pick<GatewayConfig, "downstreamTimeoutMs" | "fetchImplementation">
  > &
    Pick<GatewayConfig, "downstreamUrl">,
): Promise<void> {
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    config.downstreamTimeoutMs,
  );
  timeout.unref();

  const abortOnDisconnect = (): void => abortController.abort();
  request.once("aborted", abortOnDisconnect);

  try {
    const downstreamResponse = await config.fetchImplementation(
      config.downstreamUrl,
      {
        method: "POST",
        headers: requestHeadersForDownstream(request.headers),
        body: new Uint8Array(rawBody),
        signal: abortController.signal,
      },
    );
    const responseBody = Buffer.from(await downstreamResponse.arrayBuffer());

    response.statusCode = downstreamResponse.status;
    copyDownstreamHeaders(downstreamResponse.headers, response);
    response.removeHeader("content-length");
    response.setHeader("content-length", responseBody.length);
    response.end(responseBody);
  } catch {
    logger.error("Downstream MCP request failed", {
      method,
      request_id: requestId === undefined ? null : String(requestId),
    });

    if (!response.destroyed && !response.writableEnded) {
      sendRpcError(
        response,
        502,
        jsonRpcError(
          requestId,
          JSON_RPC_INTERNAL_ERROR,
          "Downstream MCP server unavailable",
        ),
      );
    }
  } finally {
    clearTimeout(timeout);
    request.off("aborted", abortOnDisconnect);
  }
}

export function createGatewayServer(config: GatewayConfig): HttpServer {
  const maxBodyBytes = config.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const downstreamTimeoutMs =
    config.downstreamTimeoutMs ?? DEFAULT_DOWNSTREAM_TIMEOUT_MS;
  const fetchImplementation = config.fetchImplementation ?? fetch;

  if (maxBodyBytes <= 0 || !Number.isInteger(maxBodyBytes)) {
    throw new Error("maxBodyBytes must be a positive integer");
  }

  if (downstreamTimeoutMs <= 0 || !Number.isFinite(downstreamTimeoutMs)) {
    throw new Error("downstreamTimeoutMs must be positive and finite");
  }

  return createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://gateway.local");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method !== "POST" || requestUrl.pathname !== "/mcp") {
        sendJson(response, 404, { error: "Not Found" });
        return;
      }

      if (!isJsonContentType(request.headers["content-type"])) {
        sendJson(response, 415, {
          error: "Content-Type must be application/json",
        });
        return;
      }

      let rawBody: Buffer;
      try {
        rawBody = await readBody(request, maxBodyBytes);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          sendRpcError(
            response,
            413,
            jsonRpcError(
              undefined,
              JSON_RPC_INVALID_REQUEST,
              "Request body too large",
            ),
          );
          return;
        }

        throw error;
      }

      const parsed = parseJsonRpcRequest(rawBody);
      if (!parsed.success) {
        sendRpcError(response, parsed.httpStatus, parsed.error);
        return;
      }

      const rpcRequest = parsed.request;
      const token = extractBearerToken(request.headers.authorization);
      const authContext = token
        ? config.tokenVerifier.verify(token)
        : undefined;

      if (!authContext) {
        sendRpcError(
          response,
          401,
          jsonRpcError(
            rpcRequest.id,
            AUTHENTICATION_REQUIRED,
            "Authentication Required",
          ),
          { "www-authenticate": "Bearer" },
        );
        return;
      }

      if (rpcRequest.method === "tools/call") {
        const toolCall = toolCallParamsSchema.safeParse(rpcRequest.params);

        if (!toolCall.success) {
          sendRpcError(
            response,
            200,
            jsonRpcError(
              rpcRequest.id,
              JSON_RPC_INVALID_PARAMS,
              "Invalid tools/call parameters",
            ),
          );
          return;
        }

        const toolName = toolCall.data.name;
        const authorization = authorizeToolCall(authContext.role, toolName);
        if (!authorization.allowed) {
          logger.info("Blocked unauthorized MCP tool call", {
            request_id:
              rpcRequest.id === undefined ? null : String(rpcRequest.id),
            role: authContext.role,
            tool: toolName,
          });
          sendRpcError(
            response,
            200,
            jsonRpcError(
              rpcRequest.id,
              UNAUTHORIZED_TOOL_CALL,
              "Unauthorized Tool Call",
            ),
          );
          return;
        }
      }

      await forwardRequest(
        request,
        response,
        rawBody,
        rpcRequest.id,
        rpcRequest.method,
        {
          downstreamUrl: config.downstreamUrl,
          downstreamTimeoutMs,
          fetchImplementation,
        },
      );
    })().catch(() => {
      if (!response.destroyed && !response.writableEnded) {
        sendRpcError(
          response,
          500,
          jsonRpcError(
            undefined,
            JSON_RPC_INTERNAL_ERROR,
            "Internal gateway error",
          ),
        );
      }
    });
  });
}
