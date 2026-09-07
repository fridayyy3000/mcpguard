import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";

import { logger } from "../shared/logger.js";
import {
  callModelProvider,
  DEFAULT_MAX_PROVIDER_RESPONSE_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS,
  type ModelProvider,
  type ProviderAttempt,
} from "./provider-client.js";
import { type SqliteSlidingWindowRateLimiter } from "./rate-limiter.js";
import {
  completionRequestSchema,
  ConservativeTokenEstimator,
  type TokenEstimator,
} from "./token-estimator.js";
import { fallbackReason } from "./routing-policy.js";

const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;

export interface ModelRouterConfig {
  rateLimiter: SqliteSlidingWindowRateLimiter;
  primaryProvider: ModelProvider;
  secondaryProvider: ModelProvider;
  tokenEstimator?: TokenEstimator;
  providerTimeoutMilliseconds?: number;
  maxRequestBytes?: number;
  maxProviderResponseBytes?: number;
  fetchImplementation?: typeof fetch;
}

interface GatewayErrorDetails {
  limit_tokens?: number;
  remaining_tokens?: number;
  requested_tokens?: number;
  retry_after_ms?: number;
}

class BodyTooLargeError extends Error {}

function isJsonContentType(contentType: string | undefined): boolean {
  return (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
  );
}

function requestIdFrom(request: IncomingMessage): string {
  const candidate = request.headers["x-request-id"];

  return typeof candidate === "string" &&
    /^[A-Za-z0-9._-]{1,128}$/.test(candidate)
    ? candidate
    : randomUUID();
}

function bearerToken(header: string | undefined): string | undefined {
  return /^Bearer[\t ]+([^\s,]+)$/i.exec(header?.trim() ?? "")?.[1];
}

function tenantApiKey(request: IncomingMessage): string | undefined {
  const directKey = request.headers["x-api-key"];
  const candidate =
    typeof directKey === "string"
      ? directKey.trim()
      : bearerToken(request.headers.authorization);

  return candidate && candidate.length <= 512 ? candidate : undefined;
}

async function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new BodyTooLargeError("Request body is too large");
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;

    if (totalBytes > maxBytes) {
      throw new BodyTooLargeError("Request body is too large");
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks);
}

function sendGatewayError(
  response: ServerResponse,
  httpStatus: number,
  code: string,
  message: string,
  requestId: string,
  details: GatewayErrorDetails = {},
  headers: Record<string, string> = {},
): void {
  const serialized = JSON.stringify({
    error: {
      code,
      message,
      request_id: requestId,
      ...details,
    },
  });

  response.writeHead(httpStatus, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(serialized),
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    ...headers,
  });
  response.end(serialized);
}

function sendProviderResponse(
  response: ServerResponse,
  attempt: Extract<ProviderAttempt, { kind: "success" }>,
  selectedProvider: "primary" | "secondary",
  requestId: string,
): void {
  response.writeHead(attempt.status, {
    "cache-control": "no-store",
    "content-length": attempt.body.length,
    "content-type": attempt.contentType,
    "x-gateway-provider": selectedProvider,
    "x-request-id": requestId,
  });
  response.end(attempt.body);
}

function primaryFailure(
  response: ServerResponse,
  attempt: ProviderAttempt,
  requestId: string,
): void {
  const code =
    attempt.kind === "timeout" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_ERROR";
  const status = attempt.kind === "timeout" ? 504 : 502;

  sendGatewayError(
    response,
    status,
    code,
    "Primary model provider failed",
    requestId,
  );
}

function finalProviderFailure(
  response: ServerResponse,
  attempt: ProviderAttempt,
  requestId: string,
): void {
  if (attempt.kind === "timeout") {
    sendGatewayError(
      response,
      504,
      "UPSTREAM_TIMEOUT",
      "No model provider completed before its deadline",
      requestId,
    );
    return;
  }

  if (attempt.kind === "http_error" && attempt.status === 429) {
    sendGatewayError(
      response,
      503,
      "ALL_PROVIDERS_RATE_LIMITED",
      "All model providers are temporarily rate limited",
      requestId,
    );
    return;
  }

  sendGatewayError(
    response,
    502,
    "UPSTREAM_ERROR",
    "No model provider could complete the request",
    requestId,
  );
}

export function createModelRouterServer(config: ModelRouterConfig): HttpServer {
  const tokenEstimator =
    config.tokenEstimator ?? new ConservativeTokenEstimator();
  const providerTimeoutMilliseconds =
    config.providerTimeoutMilliseconds ?? DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS;
  const maxRequestBytes = config.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxProviderResponseBytes =
    config.maxProviderResponseBytes ?? DEFAULT_MAX_PROVIDER_RESPONSE_BYTES;
  const fetchImplementation = config.fetchImplementation ?? fetch;

  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes <= 0) {
    throw new Error("maxRequestBytes must be a positive safe integer");
  }

  return createServer((request, response) => {
    const requestId = requestIdFrom(request);

    void (async () => {
      const requestUrl = new URL(request.url ?? "/", "http://router.local");

      if (request.method === "GET" && requestUrl.pathname === "/health") {
        const body = JSON.stringify({ status: "ok" });
        response.writeHead(200, {
          "content-length": Buffer.byteLength(body),
          "content-type": "application/json; charset=utf-8",
          "x-request-id": requestId,
        });
        response.end(body);
        return;
      }

      if (
        request.method !== "POST" ||
        !["/v1/completions", "/v1/chat/completions"].includes(
          requestUrl.pathname,
        )
      ) {
        sendGatewayError(response, 404, "NOT_FOUND", "Not Found", requestId);
        return;
      }

      const apiKey = tenantApiKey(request);
      if (!apiKey) {
        sendGatewayError(
          response,
          401,
          "AUTHENTICATION_REQUIRED",
          "A tenant API key is required",
          requestId,
          {},
          { "www-authenticate": "Bearer" },
        );
        return;
      }

      if (!isJsonContentType(request.headers["content-type"])) {
        sendGatewayError(
          response,
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Content-Type must be application/json",
          requestId,
        );
        return;
      }

      let rawBody: Buffer;
      try {
        rawBody = await readBody(request, maxRequestBytes);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          sendGatewayError(
            response,
            413,
            "REQUEST_TOO_LARGE",
            "Request body is too large",
            requestId,
          );
          return;
        }

        throw error;
      }

      let rawRequest: unknown;
      try {
        rawRequest = JSON.parse(rawBody.toString("utf8"));
      } catch {
        sendGatewayError(
          response,
          400,
          "INVALID_REQUEST",
          "Request body must be valid JSON",
          requestId,
        );
        return;
      }

      const parsedRequest = completionRequestSchema.safeParse(rawRequest);
      if (!parsedRequest.success) {
        sendGatewayError(
          response,
          400,
          "INVALID_REQUEST",
          "Invalid completion request",
          requestId,
        );
        return;
      }

      const requestedTokens = tokenEstimator.estimate(parsedRequest.data);
      if (!Number.isSafeInteger(requestedTokens) || requestedTokens <= 0) {
        throw new Error("Token estimator returned an invalid value");
      }

      let rateLimit;
      try {
        rateLimit = config.rateLimiter.tryConsume(apiKey, requestedTokens);
      } catch {
        sendGatewayError(
          response,
          503,
          "RATE_LIMITER_UNAVAILABLE",
          "Token rate limiter is temporarily unavailable",
          requestId,
        );
        return;
      }

      if (!rateLimit.allowed) {
        const retryAfterMilliseconds =
          rateLimit.retryAfterMilliseconds ?? 60_000;
        logger.info("Tenant token limit exceeded", {
          request_id: requestId,
          requested_tokens: requestedTokens,
          retry_after_ms: retryAfterMilliseconds,
        });
        sendGatewayError(
          response,
          429,
          "TENANT_TOKEN_RATE_LIMIT_EXCEEDED",
          "Tenant token rate limit exceeded",
          requestId,
          {
            limit_tokens: rateLimit.limitTokens,
            remaining_tokens: rateLimit.remainingTokens,
            requested_tokens: requestedTokens,
            retry_after_ms: retryAfterMilliseconds,
          },
          { "retry-after": String(Math.ceil(retryAfterMilliseconds / 1_000)) },
        );
        return;
      }

      const clientAbortController = new AbortController();
      const abortOnClientClose = (): void => {
        if (!response.writableEnded) {
          clientAbortController.abort();
        }
      };
      response.once("close", abortOnClientClose);

      const call = (provider: ModelProvider): Promise<ProviderAttempt> =>
        callModelProvider({
          provider,
          requestBody: rawBody,
          requestId,
          timeoutMilliseconds: providerTimeoutMilliseconds,
          maxResponseBytes: maxProviderResponseBytes,
          fetchImplementation,
          clientSignal: clientAbortController.signal,
        });

      try {
        const primaryAttempt = await call(config.primaryProvider);
        if (primaryAttempt.kind === "success") {
          sendProviderResponse(response, primaryAttempt, "primary", requestId);
          return;
        }

        if (primaryAttempt.kind === "cancelled") {
          return;
        }

        const reason = fallbackReason(primaryAttempt);

        if (!reason) {
          primaryFailure(response, primaryAttempt, requestId);
          return;
        }

        logger.info("Falling back to secondary model provider", {
          request_id: requestId,
          reason,
        });

        const secondaryAttempt = await call(config.secondaryProvider);
        if (secondaryAttempt.kind === "success") {
          sendProviderResponse(
            response,
            secondaryAttempt,
            "secondary",
            requestId,
          );
          return;
        }

        if (secondaryAttempt.kind === "cancelled") {
          return;
        }

        finalProviderFailure(response, secondaryAttempt, requestId);
      } finally {
        response.off("close", abortOnClientClose);
      }
    })().catch((error: unknown) => {
      logger.error("Model router request failed", {
        error_type:
          error instanceof Error ? error.constructor.name : "UnknownError",
      });

      if (!response.headersSent && !response.writableEnded) {
        sendGatewayError(
          response,
          500,
          "INTERNAL_ERROR",
          "Internal gateway error",
          requestId,
        );
      } else if (!response.writableEnded) {
        response.end();
      }
    });
  });
}
