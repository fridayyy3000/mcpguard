import {
  createServer,
  type IncomingHttpHeaders,
  type Server as HttpServer,
} from "node:http";

import {
  JSON_RPC_INVALID_PARAMS,
  jsonRpcError,
  parseJsonRpcRequest,
  toolCallParamsSchema,
} from "./json-rpc.js";

export interface RecordedDownstreamRequest {
  headers: IncomingHttpHeaders;
  rawBody: string;
}

export interface MockDownstreamState {
  requests: RecordedDownstreamRequest[];
}

function rpcResult(id: string | number | undefined, result: unknown): object {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function createMockDownstreamServer(
  state: MockDownstreamState = { requests: [] },
): HttpServer {
  return createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/mcp") {
        response.writeHead(404).end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const rawBody = Buffer.concat(chunks);
      state.requests.push({
        headers: request.headers,
        rawBody: rawBody.toString("utf8"),
      });

      const parsed = parseJsonRpcRequest(rawBody);
      if (!parsed.success) {
        response
          .writeHead(parsed.httpStatus, { "content-type": "application/json" })
          .end(JSON.stringify(parsed.error));
        return;
      }

      const rpcRequest = parsed.request;
      let body: object;

      if (rpcRequest.method === "tools/list") {
        body = rpcResult(rpcRequest.id, {
          tools: [
            {
              name: "get_service_status",
              description: "Read the public service status.",
              inputSchema: { type: "object", properties: {} },
            },
            {
              name: "admin_reset_key",
              description: "Reset an administrative key.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        });
      } else if (rpcRequest.method === "tools/call") {
        const toolCall = toolCallParamsSchema.safeParse(rpcRequest.params);

        body = toolCall.success
          ? rpcResult(rpcRequest.id, {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ executed: toolCall.data.name }),
                },
              ],
            })
          : jsonRpcError(
              rpcRequest.id,
              JSON_RPC_INVALID_PARAMS,
              "Invalid tools/call parameters",
            );
      } else {
        body = rpcResult(rpcRequest.id, { forwardedMethod: rpcRequest.method });
      }

      const serialized = JSON.stringify(body);
      response.writeHead(200, {
        "content-length": Buffer.byteLength(serialized),
        "content-type": "application/json; charset=utf-8",
        "x-mock-downstream": "true",
      });
      response.end(serialized);
    })().catch(() => {
      if (!response.writableEnded) {
        response.writeHead(500).end();
      }
    });
  });
}
