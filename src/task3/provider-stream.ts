function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ProviderDelta {
  payload: Record<string, unknown>;
  content?: string;
  terminal: boolean;
}

export class InvalidProviderEventError extends Error {}

/** Parses the OpenAI-compatible SSE JSON shape used by the gateway. */
export function parseProviderDelta(data: string): ProviderDelta {
  let value: unknown;

  try {
    value = JSON.parse(data);
  } catch {
    throw new InvalidProviderEventError("Provider emitted malformed SSE JSON");
  }

  if (!isRecord(value)) {
    throw new InvalidProviderEventError(
      "Provider SSE data must be a JSON object",
    );
  }

  const choices = value.choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;

  if (!isRecord(firstChoice)) {
    return { payload: value, terminal: false };
  }

  const delta = firstChoice.delta;
  const content = isRecord(delta) ? delta.content : undefined;
  const terminal =
    firstChoice.finish_reason !== undefined &&
    firstChoice.finish_reason !== null;

  return {
    payload: value,
    ...(typeof content === "string" ? { content } : {}),
    terminal,
  };
}

export function replaceProviderContent(
  providerDelta: ProviderDelta,
  content: string,
): Record<string, unknown> {
  const choices = providerDelta.payload.choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;

  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
    throw new InvalidProviderEventError(
      "Cannot replace content in a provider event without a delta",
    );
  }

  firstChoice.delta.content = content;
  return providerDelta.payload;
}

export function syntheticContentDelta(content: string): object {
  return {
    object: "chat.completion.chunk",
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  };
}
