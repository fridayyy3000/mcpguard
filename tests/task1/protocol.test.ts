import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolResultSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTask1Server } from "../../src/task1/server.js";

describe("Task 1 MCP protocol", () => {
  let client: Client;
  let server: ReturnType<typeof createTask1Server>;

  beforeEach(async () => {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    server = createTask1Server();
    client = new Client({ name: "task1-test-client", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("lists exactly the two required tools with strict JSON schemas", async () => {
    const response = await client.listTools();

    expect(response.tools.map(({ name }) => name)).toEqual([
      "get_customer_record",
      "trigger_refund",
    ]);
    expect(response.tools).toHaveLength(2);

    for (const tool of response.tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("executes get_customer_record through MCP", async () => {
    const response = await client.callTool(
      {
        name: "get_customer_record",
        arguments: { customer_id: "CUST-12345" },
      },
      CallToolResultSchema,
    );

    const result = CallToolResultSchema.parse(response);
    expect(result.isError).not.toBe(true);
    const firstContent = result.content[0];
    expect(firstContent?.type).toBe("text");

    if (firstContent?.type !== "text") {
      throw new Error("Expected text content");
    }

    expect(JSON.parse(firstContent.text)).toMatchObject({
      customer_id: "CUST-12345",
      account_status: "active",
    });
  });

  it("executes trigger_refund through MCP", async () => {
    const response = await client.callTool(
      {
        name: "trigger_refund",
        arguments: {
          customer_id: "CUST-12345",
          amount: 25.75,
          reason: "Duplicate transaction",
        },
      },
      CallToolResultSchema,
    );

    const result = CallToolResultSchema.parse(response);
    expect(result.isError).not.toBe(true);
    const firstContent = result.content[0];

    if (firstContent?.type !== "text") {
      throw new Error("Expected text content");
    }

    expect(JSON.parse(firstContent.text)).toMatchObject({
      customer_id: "CUST-12345",
      amount: 25.75,
      reason: "Duplicate transaction",
      status: "accepted",
    });
  });

  it.each([
    {
      name: "get_customer_record",
      arguments: { customer_id: "12345" },
    },
    {
      name: "trigger_refund",
      arguments: {
        customer_id: "CUST-12345",
        amount: 0,
        reason: "Duplicate transaction",
      },
    },
    {
      name: "trigger_refund",
      arguments: {
        customer_id: "CUST-12345",
        amount: 10,
        reason: "short",
      },
    },
    {
      name: "trigger_refund",
      arguments: {
        customer_id: "CUST-12345",
        amount: 10,
        reason: "Duplicate transaction",
        extra: "rejected",
      },
    },
    {
      name: "trigger_refund",
    },
    {
      name: "not_a_real_tool",
      arguments: {},
    },
  ])("maps malformed tool arguments to JSON-RPC -32602", async (request) => {
    await expect(
      client.callTool(
        request as Parameters<Client["callTool"]>[0],
        CallToolResultSchema,
      ),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof McpError && error.code === ErrorCode.InvalidParams,
    );
  });

  it("returns a tool-level business error for a well-formed unknown customer", async () => {
    const response = await client.callTool(
      {
        name: "get_customer_record",
        arguments: { customer_id: "CUST-99999" },
      },
      CallToolResultSchema,
    );

    expect(CallToolResultSchema.parse(response).isError).toBe(true);
  });
});
