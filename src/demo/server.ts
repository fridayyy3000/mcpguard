import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";

import { z } from "zod";

import { demoRunRequestSchema } from "./contracts.js";
import type { DemoRuntime } from "./runtime.js";

const MAX_BODY_BYTES = 1_048_576;

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

class BodyTooLargeError extends Error {}

function writeJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "access-control-allow-origin": "http://localhost:5173",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new BodyTooLargeError("Request body is too large");
    }
    chunks.push(bytes);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function serveStatic(
  pathname: string,
  response: ServerResponse,
  staticDirectory: string,
): boolean {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const candidate = resolve(staticDirectory, `.${requested}`);
  const safeRoot = `${resolve(staticDirectory)}${sep}`;
  const safeCandidate = candidate.startsWith(safeRoot)
    ? candidate
    : resolve(staticDirectory, "index.html");
  const filePath =
    existsSync(safeCandidate) && statSync(safeCandidate).isFile()
      ? safeCandidate
      : resolve(staticDirectory, "index.html");

  if (!existsSync(filePath)) {
    return false;
  }

  const type = contentTypes[extname(filePath)] ?? "application/octet-stream";
  response.writeHead(200, {
    "cache-control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
    "content-type": type,
  });
  createReadStream(filePath).pipe(response);
  return true;
}

export function createDemoServer(
  runtime: DemoRuntime,
  staticDirectory = resolve(process.cwd(), "web/dist"),
): HttpServer {
  return createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://demo.local");

      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-origin": "http://localhost:5173",
        });
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/health") {
        writeJson(response, 200, { status: "ok", mode: "deterministic_demo" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        writeJson(response, 200, runtime.snapshot());
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/runs") {
        try {
          const parsed = demoRunRequestSchema.parse(await readJson(request));
          writeJson(response, 201, await runtime.run(parsed));
        } catch (error) {
          if (error instanceof BodyTooLargeError) {
            writeJson(response, 413, { error: "Request body is too large" });
            return;
          }
          if (error instanceof SyntaxError || error instanceof z.ZodError) {
            writeJson(response, 400, { error: "Invalid demo request" });
            return;
          }
          throw error;
        }
        return;
      }

      if (
        request.method === "GET" &&
        !url.pathname.startsWith("/api/") &&
        serveStatic(url.pathname, response, staticDirectory)
      ) {
        return;
      }

      writeJson(response, 404, { error: "Not Found" });
    })().catch(() => {
      if (!response.writableEnded) {
        writeJson(response, 500, { error: "Internal demo server error" });
      }
    });
  });
}
