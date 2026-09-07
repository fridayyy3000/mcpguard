import { z } from "zod";

const contentPartSchema = z.record(z.string(), z.unknown());
const messageSchema = z
  .object({
    role: z.string().min(1),
    content: z.union([z.string(), z.array(contentPartSchema)]),
  })
  .passthrough();

export const completionRequestSchema = z
  .object({
    prompt: z.union([z.string(), z.array(z.string())]).optional(),
    messages: z.array(messageSchema).min(1).optional(),
    max_tokens: z.number().int().positive().max(1_000_000).optional(),
    max_completion_tokens: z
      .number()
      .int()
      .positive()
      .max(1_000_000)
      .optional(),
  })
  .passthrough()
  .superRefine((request, context) => {
    if (request.prompt === undefined && request.messages === undefined) {
      context.addIssue({
        code: "custom",
        message: "prompt or messages is required",
      });
    }

    if (
      request.max_tokens !== undefined &&
      request.max_completion_tokens !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Specify only one output-token limit",
      });
    }
  });

export type CompletionRequest = z.infer<typeof completionRequestSchema>;

export interface TokenEstimator {
  estimate(request: CompletionRequest): number;
}

function textFromContentParts(
  parts: readonly Record<string, unknown>[],
): string {
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

function inputText(request: CompletionRequest): string {
  const prompt = Array.isArray(request.prompt)
    ? request.prompt.join("\n")
    : (request.prompt ?? "");
  const messages = (request.messages ?? [])
    .map(({ content }) =>
      typeof content === "string" ? content : textFromContentParts(content),
    )
    .join("\n");

  return [prompt, messages].filter((value) => value.length > 0).join("\n");
}

/**
 * Provider-neutral conservative estimate. Production deployments can inject a
 * model-specific tokenizer through the TokenEstimator interface.
 */
export class ConservativeTokenEstimator implements TokenEstimator {
  public estimate(request: CompletionRequest): number {
    const textBytes = Buffer.byteLength(inputText(request), "utf8");
    const inputTokens = Math.max(1, Math.ceil(textBytes / 4));
    const messageOverhead = (request.messages?.length ?? 0) * 4 + 2;
    const outputReservation =
      request.max_completion_tokens ?? request.max_tokens ?? 1_024;

    return inputTokens + messageOverhead + outputReservation;
  }
}
