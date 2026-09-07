import { type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLlmGatewayServer } from "../../src/task3/gateway.js";
import {
  createMockLlmProvider,
  type MockProviderState,
} from "../../src/task3/mock-provider.js";
import { parseProviderDelta } from "../../src/task3/provider-stream.js";
import { REDACTION_MARKER } from "../../src/task3/redactor.js";
import { serializeSseData, SseParser } from "../../src/task3/sse.js";

async function listen(server: HttpServer): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an IPv4 test server address");
  }

  return (address as AddressInfo).port;
}

async function close(server: HttpServer | undefined): Promise<void> {
  if (!server?.listening) {
    return;
  }

  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function streamedContent(wire: string): string {
  const parser = new SseParser();
  const events = [...parser.push(wire), ...parser.finish()];
  let text = "";

  for (const event of events) {
    if (event.data === "[DONE]" || event.event === "error") {
      continue;
    }

    text += parseProviderDelta(event.data).content ?? "";
  }

  return text;
}

describe("Task 3 LLM streaming gateway", () => {
  let provider: HttpServer | undefined;
  let gateway: HttpServer | undefined;
  let gatewayUrl: string;
  let providerState: MockProviderState;

  beforeEach(() => {
    providerState = { requests: [] };
  });

  afterEach(async () => {
    await close(gateway);
    await close(provider);
  });

  async function startGateway(
    providerServer: HttpServer,
    providerApiKey?: string,
  ): Promise<void> {
    provider = providerServer;
    const providerPort = await listen(provider);

    gateway = createLlmGatewayServer({
      providerUrl: new URL(
        `http://127.0.0.1:${providerPort}/v1/chat/completions`,
      ),
      ...(providerApiKey ? { providerApiKey } : {}),
    });
    const gatewayPort = await listen(gateway);
    gatewayUrl = `http://127.0.0.1:${gatewayPort}/v1/chat/completions`;
  }

  function post(body: string | object): Promise<Response> {
    return fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-request-id": "trace-123",
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("redacts boundary-split email, SSN, and card deltas", async () => {
    await startGateway(
      createMockLlmProvider(providerState, {
        delayMilliseconds: 0,
        deltas: [
          "Contact jane",
          "@example.com, SSN 123-",
          "45-6789, card 4111 1111 ",
          "1111 1111. Safe ending.",
        ],
      }),
      "provider-secret",
    );

    const rawRequest =
      '{"model":"mock","stream":true,"messages":[{"role":"user","content":"hello"}]}';
    const response = await post(rawRequest);
    const wire = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(streamedContent(wire)).toBe(
      `Contact ${REDACTION_MARKER}, SSN ${REDACTION_MARKER}, card ${REDACTION_MARKER}. Safe ending.`,
    );
    expect(wire).not.toContain("jane@example.com");
    expect(wire).not.toContain("123-45-6789");
    expect(wire).not.toContain("4111 1111 1111 1111");
    expect(wire).toContain("data: [DONE]");

    expect(providerState.requests).toHaveLength(1);
    expect(providerState.requests[0]?.rawBody).toBe(rawRequest);
    expect(providerState.requests[0]?.headers.authorization).toBe(
      "Bearer provider-secret",
    );
    expect(providerState.requests[0]?.headers["x-request-id"]).toBe(
      "trace-123",
    );
  });

  it("returns the first safe delta before the provider completes", async () => {
    let releaseProvider: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });

    const controlledProvider = createMockLlmProvider(providerState, {
      delayMilliseconds: 0,
      deltas: ["unused"],
    });
    controlledProvider.removeAllListeners("request");
    controlledProvider.on("request", (request, response) => {
      void (async () => {
        for await (const _chunk of request) {
          // Drain the request before returning provider headers.
        }

        response.writeHead(200, { "content-type": "text/event-stream" });
        response.flushHeaders();
        response.write(
          serializeSseData(
            JSON.stringify({
              choices: [
                {
                  index: 0,
                  delta: { content: "First safe token " },
                  finish_reason: null,
                },
              ],
            }),
          ),
        );

        await providerGate;
        response.end(serializeSseData("[DONE]"));
      })();
    });

    await startGateway(controlledProvider);
    const response = await post({ model: "mock", stream: true, messages: [] });
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    try {
      const firstRead = await Promise.race([
        reader?.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("First safe delta was buffered")),
            1_000,
          ),
        ),
      ]);

      const firstBytes = firstRead?.value;
      expect(firstBytes).toBeDefined();
      expect(new TextDecoder().decode(firstBytes)).toContain(
        "First safe token ",
      );
    } finally {
      releaseProvider?.();
      await reader?.cancel();
    }
  });

  it("fails closed when the provider emits malformed SSE JSON", async () => {
    const malformedProvider = createMockLlmProvider(providerState);
    malformedProvider.removeAllListeners("request");
    malformedProvider.on("request", (request, response) => {
      request.resume();
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end("data: {not-json}\n\n");
    });

    await startGateway(malformedProvider);
    const response = await post({ model: "mock", stream: true, messages: [] });
    const wire = await response.text();

    expect(response.status).toBe(200);
    expect(wire).toContain("event: error");
    expect(wire).toContain("INVALID_PROVIDER_STREAM");
    expect(wire).not.toContain("{not-json}");
  });

  it("rejects a non-streaming request without contacting the provider", async () => {
    await startGateway(createMockLlmProvider(providerState));

    const response = await post({ model: "mock", stream: false, messages: [] });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("STREAMING_REQUIRED");
    expect(providerState.requests).toHaveLength(0);
  });

  it("returns a sanitized error when the provider rejects the request", async () => {
    const rejectingProvider = createMockLlmProvider(providerState);
    rejectingProvider.removeAllListeners("request");
    rejectingProvider.on("request", (request, response) => {
      request.resume();
      response.writeHead(429, { "content-type": "application/json" });
      response.end('{"internal":"provider account details"}');
    });

    await startGateway(rejectingProvider);
    const response = await post({ model: "mock", stream: true, messages: [] });
    const rawBody = await response.text();

    expect(response.status).toBe(502);
    expect(rawBody).toContain("LLM provider returned HTTP 429");
    expect(rawBody).not.toContain("provider account details");
  });
});
