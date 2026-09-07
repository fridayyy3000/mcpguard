import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodType } from "zod";

import { getCustomerRecord, triggerRefund } from "./customer-service.js";
import { logger } from "./logger.js";
import {
  getCustomerRecordInputSchema,
  triggerRefundInputSchema,
} from "./schemas.js";

const GET_CUSTOMER_RECORD = "get_customer_record";
const TRIGGER_REFUND = "trigger_refund";

function toMcpInputSchema(schema: z.ZodObject): Tool["inputSchema"] {
  const jsonSchema = z.toJSONSchema(schema);

  if (jsonSchema.type !== "object") {
    throw new Error("MCP tool input schemas must be JSON Schema objects");
  }

  return jsonSchema as Tool["inputSchema"];
}

const tools: Tool[] = [
  {
    name: GET_CUSTOMER_RECORD,
    title: "Get Customer Record",
    description: "Retrieve a customer record by its customer ID.",
    inputSchema: toMcpInputSchema(getCustomerRecordInputSchema),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: TRIGGER_REFUND,
    title: "Trigger Refund",
    description: "Trigger a refund for a customer with a documented reason.",
    inputSchema: toMcpInputSchema(triggerRefundInputSchema),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

function invalidParamsMessage(toolName: string, error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "arguments";
    return `${path}: ${issue.message}`;
  });

  return `Invalid parameters for ${toolName}: ${issues.join("; ")}`;
}

function parseArguments<T>(
  toolName: string,
  schema: ZodType<T>,
  input: unknown,
): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new McpError(
      ErrorCode.InvalidParams,
      invalidParamsMessage(toolName, result.error),
    );
  }

  return result.data;
}

function textResult(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    ...(isError ? { isError: true } : {}),
  };
}

export function createTask1Server(): Server {
  const server = new Server(
    { name: "qulr-customer-tools", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: input } = request.params;
    const requestId = String(extra.requestId);

    switch (name) {
      case GET_CUSTOMER_RECORD: {
        const arguments_ = parseArguments(
          name,
          getCustomerRecordInputSchema,
          input,
        );
        const customer = getCustomerRecord(arguments_);

        logger.info("Tool called", { tool: name, request_id: requestId });

        if (!customer) {
          return textResult(
            {
              code: "CUSTOMER_NOT_FOUND",
              message: `No customer found for ${arguments_.customer_id}`,
            },
            true,
          );
        }

        return textResult(customer);
      }

      case TRIGGER_REFUND: {
        const arguments_ = parseArguments(
          name,
          triggerRefundInputSchema,
          input,
        );
        const receipt = triggerRefund(arguments_);

        logger.info("Tool called", { tool: name, request_id: requestId });
        return textResult(receipt);
      }

      default:
        throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
  });

  return server;
}
