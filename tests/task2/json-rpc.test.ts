import { describe, expect, it } from "vitest";

import {
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_PARSE_ERROR,
  jsonRpcError,
  parseJsonRpcRequest,
} from "../../src/task2/json-rpc.js";

describe("Task 2 JSON-RPC parsing", () => {
  it("parses a JSON-RPC 2.0 request and preserves its ID", () => {
    const result = parseJsonRpcRequest(
      Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "request-42",
          method: "tools/list",
          params: {},
        }),
      ),
    );

    expect(result).toEqual({
      success: true,
      request: {
        jsonrpc: "2.0",
        id: "request-42",
        method: "tools/list",
        params: {},
      },
    });
  });

  it("maps malformed JSON to the standard parse-error code", () => {
    const result = parseJsonRpcRequest(Buffer.from("{not-json"));

    expect(result).toMatchObject({
      success: false,
      httpStatus: 400,
      error: { id: null, error: { code: JSON_RPC_PARSE_ERROR } },
    });
  });

  it.each([
    {},
    { jsonrpc: "1.0", id: 1, method: "tools/list" },
    { jsonrpc: "2.0", id: 1 },
    { jsonrpc: "2.0", id: null, method: "tools/list" },
  ])("maps an invalid JSON-RPC envelope to -32600", (body) => {
    const result = parseJsonRpcRequest(Buffer.from(JSON.stringify(body)));

    expect(result).toMatchObject({
      success: false,
      error: { error: { code: JSON_RPC_INVALID_REQUEST } },
    });
  });

  it("creates an error response with the original request ID", () => {
    expect(jsonRpcError(27, -32001, "Unauthorized Tool Call")).toEqual({
      jsonrpc: "2.0",
      id: 27,
      error: { code: -32001, message: "Unauthorized Tool Call" },
    });
  });
});
