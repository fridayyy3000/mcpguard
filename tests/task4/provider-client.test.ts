import { createServer, type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  callModelProvider,
  DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS,
} from "../../src/task4/provider-client.js";

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
    throw new Error("Expected an IPv4 address");
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

describe("Task 4 provider deadline handling", () => {
  let server: HttpServer | undefined;

  afterEach(async () => close(server));

  it("uses the required 3000ms default deadline", () => {
    expect(DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS).toBe(3_000);
  });

  it("times out while waiting for the response body, not only headers", async () => {
    server = createServer((request, response) => {
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.flushHeaders();
      setTimeout(() => {
        if (!response.destroyed) {
          response.end('{"choices":[]}');
        }
      }, 150);
    });
    const port = await listen(server);

    const result = await callModelProvider({
      provider: { url: new URL(`http://127.0.0.1:${port}/completions`) },
      requestBody: Buffer.from('{"prompt":"hello"}'),
      requestId: "timeout-test",
      timeoutMilliseconds: 25,
    });

    expect(result).toEqual({ kind: "timeout" });
  });

  it("rejects oversized or malformed successful responses", async () => {
    server = createServer((request, response) => {
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end("not-valid-json-and-too-long");
    });
    const port = await listen(server);

    const result = await callModelProvider({
      provider: { url: new URL(`http://127.0.0.1:${port}/completions`) },
      requestBody: Buffer.from('{"prompt":"hello"}'),
      requestId: "invalid-test",
      maxResponseBytes: 10,
    });

    expect(result).toEqual({ kind: "invalid_response" });
  });
});
