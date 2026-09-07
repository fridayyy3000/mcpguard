#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { logger } from "./logger.js";
import { createTask1Server } from "./server.js";

async function main(): Promise<void> {
  const server = createTask1Server();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  logger.info("MCP server ready", { transport: "stdio" });
}

main().catch((error: unknown) => {
  logger.error("Fatal server error", {
    error: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
