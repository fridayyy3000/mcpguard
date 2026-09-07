export const DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS = 3_000;
export const DEFAULT_MAX_PROVIDER_RESPONSE_BYTES = 2_097_152;

export interface ModelProvider {
  url: URL;
  apiKey?: string;
}

export type ProviderAttempt =
  | {
      kind: "success";
      body: Buffer;
      contentType: string;
      status: number;
    }
  | { kind: "http_error"; status: number }
  | { kind: "timeout" }
  | { kind: "network_error" }
  | { kind: "invalid_response" }
  | { kind: "cancelled" };

export interface ProviderCallOptions {
  provider: ModelProvider;
  requestBody: Buffer;
  requestId: string;
  timeoutMilliseconds?: number;
  maxResponseBytes?: number;
  fetchImplementation?: typeof fetch;
  clientSignal?: AbortSignal;
}

class ProviderBodyTooLargeError extends Error {}

function isJsonContentType(contentType: string | null): boolean {
  const mediaType = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
}

function requestHeaders(provider: ModelProvider, requestId: string): Headers {
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
    "x-request-id": requestId,
  });

  if (provider.apiKey) {
    headers.set("authorization", `Bearer ${provider.apiKey}`);
  }

  return headers;
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    throw new ProviderBodyTooLargeError("Provider response is too large");
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    totalBytes += bytes.length;

    if (totalBytes > maxResponseBytes) {
      throw new ProviderBodyTooLargeError("Provider response is too large");
    }

    chunks.push(bytes);
  }

  return Buffer.concat(chunks);
}

/** Executes one complete non-streaming model request under a hard deadline. */
export async function callModelProvider(
  options: ProviderCallOptions,
): Promise<ProviderAttempt> {
  const timeoutMilliseconds =
    options.timeoutMilliseconds ?? DEFAULT_PROVIDER_TIMEOUT_MILLISECONDS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_PROVIDER_RESPONSE_BYTES;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds <= 0) {
    throw new Error("timeoutMilliseconds must be positive and finite");
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new Error("maxResponseBytes must be a positive safe integer");
  }

  const abortController = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMilliseconds);
  timeout.unref();

  const abortForClient = (): void => abortController.abort();
  options.clientSignal?.addEventListener("abort", abortForClient, {
    once: true,
  });

  try {
    const response = await fetchImplementation(options.provider.url, {
      method: "POST",
      headers: requestHeaders(options.provider, options.requestId),
      body: new Uint8Array(options.requestBody),
      signal: abortController.signal,
    });

    if (!response.ok) {
      await response.body?.cancel();
      return { kind: "http_error", status: response.status };
    }

    if (!isJsonContentType(response.headers.get("content-type"))) {
      await response.body?.cancel();
      return { kind: "invalid_response" };
    }

    const body = await readBoundedBody(response, maxResponseBytes);
    try {
      JSON.parse(body.toString("utf8"));
    } catch {
      return { kind: "invalid_response" };
    }

    return {
      kind: "success",
      body,
      contentType:
        response.headers.get("content-type") ??
        "application/json; charset=utf-8",
      status: response.status,
    };
  } catch (error) {
    if (options.clientSignal?.aborted) {
      return { kind: "cancelled" };
    }

    if (timedOut) {
      return { kind: "timeout" };
    }

    if (error instanceof ProviderBodyTooLargeError) {
      abortController.abort();
      return { kind: "invalid_response" };
    }

    return { kind: "network_error" };
  } finally {
    clearTimeout(timeout);
    options.clientSignal?.removeEventListener("abort", abortForClient);
  }
}
