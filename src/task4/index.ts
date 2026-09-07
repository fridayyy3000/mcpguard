#!/usr/bin/env node

import { logger } from "../shared/logger.js";
import {
  DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS,
  type ModelProvider,
} from "./provider-client.js";
import {
  DEFAULT_TOKEN_LIMIT,
  DEFAULT_WINDOW_MILLISECONDS,
  SqliteSlidingWindowRateLimiter,
} from "./rate-limiter.js";
import { createModelRouterServer } from "./router.js";

function readPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  return parsed;
}

function providerFromEnvironment(
  url: string,
  apiKey: string | undefined,
): ModelProvider {
  return {
    url: new URL(url),
    ...(apiKey ? { apiKey } : {}),
  };
}

const port = readPositiveInteger(process.env.PORT, 4_400, "PORT");
if (port > 65_535) {
  throw new Error("PORT must not exceed 65535");
}

const host = process.env.HOST ?? "127.0.0.1";
const rateLimiter = new SqliteSlidingWindowRateLimiter({
  databasePath:
    process.env.RATE_LIMIT_DB_PATH ?? "./data/task4-rate-limits.sqlite",
  limitTokens: readPositiveInteger(
    process.env.TOKEN_LIMIT_PER_MINUTE,
    DEFAULT_TOKEN_LIMIT,
    "TOKEN_LIMIT_PER_MINUTE",
  ),
  windowMilliseconds: readPositiveInteger(
    process.env.RATE_LIMIT_WINDOW_MS,
    DEFAULT_WINDOW_MILLISECONDS,
    "RATE_LIMIT_WINDOW_MS",
  ),
});

const primaryProvider = providerFromEnvironment(
  process.env.PRIMARY_MODEL_URL ??
    "http://127.0.0.1:4401/primary/v1/completions",
  process.env.PRIMARY_MODEL_API_KEY,
);
const secondaryProvider = providerFromEnvironment(
  process.env.SECONDARY_MODEL_URL ??
    "http://127.0.0.1:4401/secondary/v1/completions",
  process.env.SECONDARY_MODEL_API_KEY,
);

const server = createModelRouterServer({
  rateLimiter,
  primaryProvider,
  secondaryProvider,
  providerTimeoutMilliseconds: readPositiveInteger(
    process.env.PROVIDER_TIMEOUT_MS,
    DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS,
    "PROVIDER_TIMEOUT_MS",
  ),
});

server.listen(port, host, () => {
  logger.info("Rate-limiting model router ready", {
    host,
    port,
    token_limit: process.env.TOKEN_LIMIT_PER_MINUTE ?? DEFAULT_TOKEN_LIMIT,
  });
});

function shutdown(signal: string): void {
  logger.info("Stopping rate-limiting model router", { signal });
  server.close((error) => {
    rateLimiter.close();

    if (error) {
      logger.error("Router shutdown failed", { error: error.message });
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
