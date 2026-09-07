import { type Server as HttpServer } from "node:http";
import { type AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StaticTokenVerifier } from "../../src/task2/auth.js";
import { createGatewayServer } from "../../src/task2/gateway.js";
import {
  AUTHENTICATION_REQUIRED,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_PARSE_ERROR,
  UNAUTHORIZED_TOOL_CALL,
} from "../../src/task2/json-rpc.js";
import {
  createMockDownstreamServer,
  type MockDownstreamState,
} from "../../src/task2/mock-downstream.js";

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

describe("Task 2 MCP security gateway", () => {
  let downstream: HttpServer;
  let gateway: HttpServer;
  let gatewayUrl: string;
  let downstreamState: MockDownstreamState;

  beforeEach(async () => {
    downstreamState = { requests: [] };
    downstream = createMockDownstreamServer(downstreamState);
    const downstreamPort = await listen(downstream);

    gateway = createGatewayServer({
      downstreamUrl: new URL(`http://127.0.0.1:${downstreamPort}/mcp`),
      tokenVerifier: new StaticTokenVerifier([
        { token: "admin-token", role: "admin" },
        { token: "viewer-token", role: "viewer" },
      ]),
      downstreamTimeoutMs: 1_000,
    });
    const gatewayPort = await listen(gateway);
    gatewayUrl = `http://127.0.0.1:${gatewayPort}/mcp`;
  });

  afterEach(async () => {
    await close(gateway);
    await close(downstream);
  });

  function post(
    body: string | object,
    token?: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...extraHeaders,
    };

    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    return fetch(gatewayUrl, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("forwards tools/list transparently for a viewer", async () => {
    const rawRequest =
      '{ "jsonrpc": "2.0", "id": "list-1", "method": "tools/list", "params": {} }';
    const response = await post(rawRequest, "viewer-token", {
      "x-trace-id": "trace-123",
    });
    const body = (await response.json()) as {
      id: string;
      result: { tools: { name: string }[] };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("x-mock-downstream")).toBe("true");
    expect(body.id).toBe("list-1");
    expect(body.result.tools.map(({ name }) => name)).toEqual([
      "get_service_status",
      "admin_reset_key",
    ]);
    expect(downstreamState.requests).toHaveLength(1);
    expect(downstreamState.requests[0]?.rawBody).toBe(rawRequest);
    expect(downstreamState.requests[0]?.headers["x-trace-id"]).toBe(
      "trace-123",
    );
    expect(downstreamState.requests[0]?.headers.authorization).toBeUndefined();
  });

  it("forwards a regular tool call for a viewer", async () => {
    const response = await post(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "get_service_status", arguments: {} },
      },
      "viewer-token",
    );
    const body = (await response.json()) as {
      result: { content: { text: string }[] };
    };

    expect(response.status).toBe(200);
    expect(JSON.parse(body.result.content[0]?.text ?? "{}")).toEqual({
      executed: "get_service_status",
    });
    expect(downstreamState.requests).toHaveLength(1);
  });

  it("forwards an admin tool call for an admin", async () => {
    const response = await post(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "admin_reset_key", arguments: {} },
      },
      "admin-token",
    );

    expect(response.status).toBe(200);
    expect(downstreamState.requests).toHaveLength(1);
  });

  it("blocks a viewer admin call locally and preserves its JSON-RPC ID", async () => {
    const response = await post(
      {
        jsonrpc: "2.0",
        id: "blocked-44",
        method: "tools/call",
        params: { name: "admin_reset_key", arguments: {} },
      },
      "viewer-token",
    );
    const body = (await response.json()) as {
      id: string;
      error: { code: number; message: string };
    };

    expect(response.status).toBe(200);
    expect(body).toEqual({
      jsonrpc: "2.0",
      id: "blocked-44",
      error: {
        code: UNAUTHORIZED_TOOL_CALL,
        message: "Unauthorized Tool Call",
      },
    });
    expect(downstreamState.requests).toHaveLength(0);
  });

  it.each([undefined, "unknown-token"])(
    "returns 401 for a missing or unknown token without forwarding",
    async (token) => {
      const response = await post(
        { jsonrpc: "2.0", id: 5, method: "tools/list", params: {} },
        token,
      );
      const body = (await response.json()) as { error: { code: number } };

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe("Bearer");
      expect(body.error.code).toBe(AUTHENTICATION_REQUIRED);
      expect(downstreamState.requests).toHaveLength(0);
    },
  );

  it("rejects malformed JSON without forwarding", async () => {
    const response = await post("{not-json", "viewer-token");
    const body = (await response.json()) as { error: { code: number } };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe(JSON_RPC_PARSE_ERROR);
    expect(downstreamState.requests).toHaveLength(0);
  });

  it("rejects malformed tools/call params without forwarding", async () => {
    const response = await post(
      {
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { arguments: {} },
      },
      "admin-token",
    );
    const body = (await response.json()) as { error: { code: number } };

    expect(response.status).toBe(200);
    expect(body.error.code).toBe(JSON_RPC_INVALID_PARAMS);
    expect(downstreamState.requests).toHaveLength(0);
  });

  it("forwards other MCP methods instead of breaking the protocol", async () => {
    const response = await post(
      {
        jsonrpc: "2.0",
        id: 8,
        method: "initialize",
        params: {},
      },
      "viewer-token",
    );
    const body = (await response.json()) as {
      result: { forwardedMethod: string };
    };

    expect(body.result.forwardedMethod).toBe("initialize");
    expect(downstreamState.requests).toHaveLength(1);
  });

  it("sanitizes downstream connection failures", async () => {
    await close(downstream);

    const response = await post(
      { jsonrpc: "2.0", id: 9, method: "tools/list", params: {} },
      "viewer-token",
    );
    const rawBody = await response.text();
    const body = JSON.parse(rawBody) as {
      id: number;
      error: { code: number; message: string };
    };

    expect(response.status).toBe(502);
    expect(body.id).toBe(9);
    expect(body.error).toEqual({
      code: JSON_RPC_INTERNAL_ERROR,
      message: "Downstream MCP server unavailable",
    });
    expect(rawBody).not.toContain("ECONNREFUSED");
    expect(rawBody).not.toContain("127.0.0.1");
  });
});
