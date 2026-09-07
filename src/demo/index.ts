#!/usr/bin/env node

import { logger } from "../shared/logger.js";
import { DemoRuntime } from "./runtime.js";
import { createDemoServer } from "./server.js";

function readPort(value: string | undefined, fallback: number): number {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

const runtime = new DemoRuntime();
await runtime.initialize();

const port = readPort(process.env.PORT, 4_500);
const host = process.env.HOST ?? "127.0.0.1";
const server = createDemoServer(runtime);

server.listen(port, host, () => {
  logger.info("MCPGuard product demo ready", { host, port });
});

function shutdown(signal: string): void {
  logger.info("Stopping MCPGuard product demo", { signal });
  server.close(() => {
    void runtime.close();
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
