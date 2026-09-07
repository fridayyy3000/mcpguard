#!/usr/bin/env node

import { logger } from "../shared/logger.js";
import { createMockDownstreamServer } from "./mock-downstream.js";

const port = Number(process.env.MOCK_MCP_PORT ?? 4_101);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("MOCK_MCP_PORT must be an integer between 1 and 65535");
}

const host = process.env.MOCK_MCP_HOST ?? "127.0.0.1";
const server = createMockDownstreamServer();

server.listen(port, host, () => {
  logger.info("Mock downstream MCP server ready", { host, port });
});

function shutdown(): void {
  server.close((error) => {
    if (error) {
      logger.error("Mock server shutdown failed", { error: error.message });
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
