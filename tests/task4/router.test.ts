import { mkdtempSync, rmSync } from "node:fs";
import { type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createMockModelProviderServer,
  type MockModelProviderConfig,
  type MockModelState,
} from "../../src/task4/mock-provider.js";
import { SqliteSlidingWindowRateLimiter } from "../../src/task4/rate-limiter.js";
import { createModelRouterServer } from "../../src/task4/router.js";

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

describe("Task 4 rate-limiting model router", () => {
  let directory: string;
  let provider: HttpServer | undefined;
  let router: HttpServer | undefined;
  let limiter: SqliteSlidingWindowRateLimiter | undefined;
  let providerState: MockModelState;
  let routerUrl: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "qulr-router-"));
    providerState = { requests: [] };
  });

  afterEach(async () => {
    await close(router);
    await close(provider);
    limiter?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  async function start(
    providerConfig: MockModelProviderConfig,
    options: { timeoutMilliseconds?: number; tokenLimit?: number } = {},
  ): Promise<void> {
    provider = createMockModelProviderServer(providerState, providerConfig);
    const providerPort = await listen(provider);

    limiter = new SqliteSlidingWindowRateLimiter({
      databasePath: join(directory, "rate-limits.sqlite"),
      limitTokens: options.tokenLimit ?? 50_000,
    });

    router = createModelRouterServer({
      rateLimiter: limiter,
      primaryProvider: {
        url: new URL(`http://127.0.0.1:${providerPort}/primary/v1/completions`),
        apiKey: "primary-provider-secret",
      },
      secondaryProvider: {
        url: new URL(
          `http://127.0.0.1:${providerPort}/secondary/v1/completions`,
        ),
        apiKey: "secondary-provider-secret",
      },
      providerTimeoutMilliseconds: options.timeoutMilliseconds ?? 1_000,
    });
    const routerPort = await listen(router);
    routerUrl = `http://127.0.0.1:${routerPort}/v1/completions`;
  }

  function post(
    body: string | object,
    apiKey = "tenant-secret",
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-request-id": "request-123",
    };
    if (apiKey.length > 0) {
      headers["x-api-key"] = apiKey;
    }

    return fetch(routerUrl, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("uses the primary provider and does not call the backup on success", async () => {
    await start({
      primary: {
        status: 200,
        body: { provider: "primary", choices: [{ text: "ok" }] },
      },
    });
    const rawRequest =
      '{"prompt":"hello","max_tokens":100,"model":"primary-model"}';

    const response = await post(rawRequest);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-gateway-provider")).toBe("primary");
    expect(await response.json()).toMatchObject({ provider: "primary" });
    expect(providerState.requests.map(({ provider }) => provider)).toEqual([
      "primary",
    ]);
    expect(providerState.requests[0]?.rawBody).toBe(rawRequest);
    expect(providerState.requests[0]?.headers.authorization).toBe(
      "Bearer primary-provider-secret",
    );
    expect(providerState.requests[0]?.headers["x-api-key"]).toBeUndefined();
  });

  it("falls back exactly once when the primary returns 429", async () => {
    await start({
      primary: { status: 429, body: { internal: "primary quota details" } },
      secondary: {
        status: 200,
        body: { provider: "secondary", choices: [{ text: "backup" }] },
      },
    });

    const response = await post({ prompt: "hello", max_tokens: 100 });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-gateway-provider")).toBe("secondary");
    expect(await response.json()).toMatchObject({ provider: "secondary" });
    expect(providerState.requests.map(({ provider }) => provider)).toEqual([
      "primary",
      "secondary",
    ]);
  });

  it("aborts a timed-out primary and returns only the secondary result", async () => {
    await start(
      {
        primary: {
          status: 200,
          delayMilliseconds: 150,
          body: { provider: "late-primary" },
        },
        secondary: { status: 200, body: { provider: "secondary" } },
      },
      { timeoutMilliseconds: 25 },
    );

    const response = await post({ prompt: "hello", max_tokens: 100 });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-gateway-provider")).toBe("secondary");
    expect(await response.json()).toEqual({ provider: "secondary" });
    expect(providerState.requests.map(({ provider }) => provider)).toEqual([
      "primary",
      "secondary",
    ]);
  });

  it("does not fallback for an unconfigured primary failure type", async () => {
    await start({
      primary: {
        status: 500,
        body: { stack: "secret internal stack", host: "10.0.0.8" },
      },
    });

    const response = await post({ prompt: "hello", max_tokens: 100 });
    const rawBody = await response.text();

    expect(response.status).toBe(502);
    expect(rawBody).toContain("UPSTREAM_ERROR");
    expect(rawBody).not.toContain("secret internal stack");
    expect(rawBody).not.toContain("10.0.0.8");
    expect(providerState.requests.map(({ provider }) => provider)).toEqual([
      "primary",
    ]);
  });

  it("returns one standardized sanitized error when both providers fail", async () => {
    await start({
      primary: { status: 429, body: { raw: "primary secret" } },
      secondary: { status: 500, body: { raw: "secondary secret" } },
    });

    const response = await post({ prompt: "hello", max_tokens: 100 });
    const rawBody = await response.text();
    const body = JSON.parse(rawBody) as {
      error: { code: string; request_id: string };
    };

    expect(response.status).toBe(502);
    expect(body.error).toMatchObject({
      code: "UPSTREAM_ERROR",
      request_id: "request-123",
    });
    expect(rawBody).not.toContain("primary secret");
    expect(rawBody).not.toContain("secondary secret");
    expect(rawBody).not.toContain("stack");
  });

  it("atomically limits concurrent requests by tokens rather than count", async () => {
    await start({
      primary: { status: 200, body: { choices: [{ text: "ok" }] } },
    });

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        post(
          { prompt: `request-${index}`, max_tokens: 3_000 },
          "concurrent-tenant",
        ),
      ),
    );
    const successful = responses.filter(({ status }) => status === 200);
    const limited = responses.filter(({ status }) => status === 429);

    expect(successful).toHaveLength(16);
    expect(limited).toHaveLength(4);
    expect(providerState.requests).toHaveLength(16);

    const limitedBody = (await limited[0]?.json()) as {
      error: { code: string; limit_tokens: number; retry_after_ms: number };
    };
    expect(limitedBody.error).toMatchObject({
      code: "TENANT_TOKEN_RATE_LIMIT_EXCEEDED",
      limit_tokens: 50_000,
    });
    expect(limitedBody.error.retry_after_ms).toBeGreaterThan(0);

    const otherTenant = await post(
      { prompt: "independent", max_tokens: 3_000 },
      "other-tenant",
    );
    expect(otherTenant.status).toBe(200);
  });

  it("rejects missing credentials and malformed requests before routing", async () => {
    await start({
      primary: { status: 200, body: { choices: [] } },
    });

    const missingKey = await post({ prompt: "hello", max_tokens: 10 }, "");
    const malformed = await post("{not-json");

    expect(missingKey.status).toBe(401);
    expect(malformed.status).toBe(400);
    expect(providerState.requests).toHaveLength(0);
  });
});
