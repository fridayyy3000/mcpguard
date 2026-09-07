import {
  createServer,
  type IncomingHttpHeaders,
  type Server as HttpServer,
} from "node:http";

import { serializeSseData } from "./sse.js";

export interface MockProviderRequest {
  headers: IncomingHttpHeaders;
  rawBody: string;
}

export interface MockProviderState {
  requests: MockProviderRequest[];
}

export interface MockProviderConfig {
  deltas?: readonly string[];
  delayMilliseconds?: number;
}

function completionDelta(content: string): object {
  return {
    id: "mock-completion",
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  };
}

function finishDelta(): object {
  return {
    id: "mock-completion",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
}

async function delay(milliseconds: number): Promise<void> {
  if (milliseconds > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  }
}

export function createMockLlmProvider(
  state: MockProviderState = { requests: [] },
  config: MockProviderConfig = {},
): HttpServer {
  const deltas = config.deltas ?? [
    "You can email jane",
    "@example.com or use card 4111 1111 ",
    "1111 1111 for this example. ",
    "Both values must stay private.",
  ];
  const delayMilliseconds = config.delayMilliseconds ?? 10;

  return createServer((request, response) => {
    void (async () => {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404).end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      state.requests.push({
        headers: request.headers,
        rawBody: Buffer.concat(chunks).toString("utf8"),
      });

      response.writeHead(200, {
        "cache-control": "no-cache",
        "content-type": "text/event-stream; charset=utf-8",
      });
      response.flushHeaders();

      for (const delta of deltas) {
        response.write(
          serializeSseData(JSON.stringify(completionDelta(delta))),
        );
        await delay(delayMilliseconds);
      }

      response.write(serializeSseData(JSON.stringify(finishDelta())));
      response.end(serializeSseData("[DONE]"));
    })().catch(() => {
      if (!response.writableEnded) {
        response.destroy();
      }
    });
  });
}
