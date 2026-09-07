import {
  createServer,
  type IncomingHttpHeaders,
  type Server as HttpServer,
} from "node:http";

export type ProviderSlot = "primary" | "secondary";

export interface MockModelRequest {
  provider: ProviderSlot;
  headers: IncomingHttpHeaders;
  rawBody: string;
}

export interface MockModelState {
  requests: MockModelRequest[];
}

export interface MockModelBehavior {
  status: number;
  delayMilliseconds?: number;
  body?: unknown;
  contentType?: string;
}

export interface MockModelProviderConfig {
  primary?: MockModelBehavior;
  secondary?: MockModelBehavior;
}

function defaultBehavior(provider: ProviderSlot): MockModelBehavior {
  if (provider === "primary") {
    return {
      status: 429,
      body: { error: "mock primary quota exhausted" },
    };
  }

  return {
    status: 200,
    body: {
      id: "mock-secondary-completion",
      choices: [{ text: "Response from the backup model." }],
    },
  };
}

function serializeBody(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body ?? {});
}

export function createMockModelProviderServer(
  state: MockModelState = { requests: [] },
  config: MockModelProviderConfig = {},
): HttpServer {
  return createServer((request, response) => {
    void (async () => {
      const provider: ProviderSlot | undefined =
        request.url === "/primary/v1/completions"
          ? "primary"
          : request.url === "/secondary/v1/completions"
            ? "secondary"
            : undefined;

      if (request.method !== "POST" || !provider) {
        response.writeHead(404).end();
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      state.requests.push({
        provider,
        headers: request.headers,
        rawBody: Buffer.concat(chunks).toString("utf8"),
      });

      const behavior = config[provider] ?? defaultBehavior(provider);
      const delayMilliseconds = behavior.delayMilliseconds ?? 0;
      if (delayMilliseconds > 0) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, delayMilliseconds),
        );
      }

      if (response.destroyed) {
        return;
      }

      const body = serializeBody(behavior.body);
      response.writeHead(behavior.status, {
        "content-length": Buffer.byteLength(body),
        "content-type":
          behavior.contentType ?? "application/json; charset=utf-8",
      });
      response.end(body);
    })().catch(() => {
      if (!response.writableEnded) {
        response.destroy();
      }
    });
  });
}
