#!/usr/bin/env node

import { logger } from "../shared/logger.js";
import { createTokenVerifierFromEnvironment } from "./auth.js";
import { createGatewayServer } from "./gateway.js";

function readPort(value: string | undefined, fallback: number): number {
  const port = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

const port = readPort(process.env.PORT, 4_100);
const host = process.env.HOST ?? "127.0.0.1";
const downstreamUrl = new URL(
  process.env.DOWNSTREAM_MCP_URL ?? "http://127.0.0.1:4101/mcp",
);

const server = createGatewayServer({
  downstreamUrl,
  tokenVerifier: createTokenVerifierFromEnvironment(),
});

server.listen(port, host, () => {
  logger.info("MCP security gateway ready", {
    host,
    port,
    downstream_origin: downstreamUrl.origin,
  });
});

function shutdown(signal: string): void {
  logger.info("Stopping MCP security gateway", { signal });
  server.close((error) => {
    if (error) {
      logger.error("Gateway shutdown failed", { error: error.message });
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
