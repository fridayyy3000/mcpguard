#!/usr/bin/env node

import { logger } from "../shared/logger.js";
import { createMockLlmProvider } from "./mock-provider.js";

const port = Number(process.env.MOCK_LLM_PORT ?? 4_201);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("MOCK_LLM_PORT must be an integer between 1 and 65535");
}

const host = process.env.MOCK_LLM_HOST ?? "127.0.0.1";
const server = createMockLlmProvider();

server.listen(port, host, () => {
  logger.info("Mock streaming LLM provider ready", { host, port });
});

function shutdown(): void {
  server.close((error) => {
    if (error) {
      logger.error("Mock provider shutdown failed", { error: error.message });
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
