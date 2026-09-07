import type { ProviderAttempt } from "./provider-client.js";

export type FallbackReason = "timeout" | "rate_limited";

/** Returns the only failures that are safe to retry on the secondary model. */
export function fallbackReason(
  attempt: ProviderAttempt,
): FallbackReason | undefined {
  if (attempt.kind === "timeout") {
    return "timeout";
  }

  if (attempt.kind === "http_error" && attempt.status === 429) {
    return "rate_limited";
  }

  return undefined;
}
