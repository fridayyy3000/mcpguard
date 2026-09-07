#!/usr/bin/env node

import { logger } from "../shared/logger.js";
import { createLlmGatewayServer } from "./gateway.js";

function readPort(value: string | undefined, fallback: number): number {
  const port = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

const port = readPort(process.env.PORT, 4_200);
const host = process.env.HOST ?? "127.0.0.1";
const providerUrl = new URL(
  process.env.LLM_PROVIDER_URL ?? "http://127.0.0.1:4201/v1/chat/completions",
);

const server = createLlmGatewayServer({
  providerUrl,
  ...(process.env.LLM_PROVIDER_API_KEY
    ? { providerApiKey: process.env.LLM_PROVIDER_API_KEY }
    : {}),
});

server.listen(port, host, () => {
  logger.info("LLM streaming guardrail ready", {
    host,
    port,
    provider_origin: providerUrl.origin,
  });
});

function shutdown(signal: string): void {
  logger.info("Stopping LLM streaming guardrail", { signal });
  server.close((error) => {
    if (error) {
      logger.error("Gateway shutdown failed", { error: error.message });
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
