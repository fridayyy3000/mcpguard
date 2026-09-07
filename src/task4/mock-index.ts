#!/usr/bin/env node

import { logger } from "../shared/logger.js";
import { createMockModelProviderServer } from "./mock-provider.js";

const port = Number(process.env.MOCK_MODEL_PORT ?? 4_401);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("MOCK_MODEL_PORT must be an integer between 1 and 65535");
}

const host = process.env.MOCK_MODEL_HOST ?? "127.0.0.1";
const server = createMockModelProviderServer();

server.listen(port, host, () => {
  logger.info("Mock primary and secondary model providers ready", {
    host,
    port,
  });
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
