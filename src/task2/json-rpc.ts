import { z } from "zod";

export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;
export const AUTHENTICATION_REQUIRED = -32002;
export const UNAUTHORIZED_TOOL_CALL = -32001;

const jsonRpcIdSchema = z.union([z.string(), z.number().finite()]);

export const jsonRpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: jsonRpcIdSchema.optional(),
    method: z.string().min(1),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const toolCallParamsSchema = z
  .object({
    name: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type JsonRpcRequest = z.infer<typeof jsonRpcRequestSchema>;
export type JsonRpcId = z.infer<typeof jsonRpcIdSchema>;

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
  };
}

export type JsonRpcParseResult =
  | { success: true; request: JsonRpcRequest }
  | {
      success: false;
      error: JsonRpcErrorResponse;
      httpStatus: number;
    };

export function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): JsonRpcErrorResponse {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

export function parseJsonRpcRequest(rawBody: Buffer): JsonRpcParseResult {
  let value: unknown;

  try {
    value = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return {
      success: false,
      httpStatus: 400,
      error: jsonRpcError(undefined, JSON_RPC_PARSE_ERROR, "Parse error"),
    };
  }

  const parsed = jsonRpcRequestSchema.safeParse(value);
  if (!parsed.success) {
    return {
      success: false,
      httpStatus: 400,
      error: jsonRpcError(
        undefined,
        JSON_RPC_INVALID_REQUEST,
        "Invalid Request",
      ),
    };
  }

  return { success: true, request: parsed.data };
}
