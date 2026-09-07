export const REDACTION_MARKER = "[REDACTED]";

// These patterns intentionally favor conservative redaction over perfect
// semantic classification. A gateway must not depend on a card passing a Luhn
// check before treating a card-shaped value as sensitive.
const EMAIL_PATTERN =
  /(?<![A-Z0-9._%+-])[A-Z0-9._%+-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,63}(?![A-Z0-9-])/gi;
const SSN_PATTERN =
  /(?<!\d)(?<!\d[ -])\d{3}(?:[ -]?\d{2})(?:[ -]?\d{4})(?![ -]?\d)/g;
const CREDIT_CARD_PATTERN =
  /(?<!\d)(?<!\d[ -])(?:\d[ -]?){12,18}\d(?![ -]?\d)/g;

const EMAIL_TOKEN_CHARACTER = /[A-Z0-9.!#$%&'*+/=?^_`{|}~@-]/i;
const NUMERIC_SEQUENCE_CHARACTER = /[0-9 -]/;

/**
 * Longer than the practical PII forms supported above, while still keeping
 * retained memory constant for a provider that emits a pathological unbroken
 * token.
 */
export const MAX_PENDING_CHARACTERS = 320;

export interface RedactionStats {
  bufferedCharacters: number;
  peakBufferedCharacters: number;
  redactionCount: number;
}

interface RedactionResult {
  text: string;
  count: number;
}

function replaceAndCount(text: string, pattern: RegExp): RedactionResult {
  let count = 0;
  const redacted = text.replace(pattern, () => {
    count += 1;
    return REDACTION_MARKER;
  });

  return { text: redacted, count };
}

export function redactPii(text: string): RedactionResult {
  let current = text;
  let count = 0;

  for (const pattern of [EMAIL_PATTERN, SSN_PATTERN, CREDIT_CARD_PATTERN]) {
    const result = replaceAndCount(current, pattern);
    current = result.text;
    count += result.count;
  }

  return { text: current, count };
}

function trailingRunStart(
  text: string,
  isCandidateCharacter: (character: string) => boolean,
): number | undefined {
  let index = text.length;

  while (index > 0 && isCandidateCharacter(text[index - 1] ?? "")) {
    index -= 1;
  }

  return index === text.length ? undefined : index;
}

function unresolvedCandidateStart(text: string): number {
  let safePrefixEnd = text.length;

  // Any unfinished ASCII token may become an email when a later delta adds
  // "@domain.tld", so retain only that token until a delimiter arrives.
  const emailStart = trailingRunStart(text, (character) =>
    EMAIL_TOKEN_CHARACTER.test(character),
  );
  if (emailStart !== undefined) {
    safePrefixEnd = Math.min(safePrefixEnd, emailStart);

    // A trailing token such as "1111." can be the final group of a card whose
    // earlier groups are separated by spaces. Do not cut between those groups
    // merely because punctuation ended the numeric run.
    const emailCandidate = text.slice(emailStart);
    if (/\d/.test(emailCandidate) && /^[0-9.-]+$/.test(emailCandidate)) {
      let numericContextStart = emailStart;
      while (
        numericContextStart > 0 &&
        NUMERIC_SEQUENCE_CHARACTER.test(text[numericContextStart - 1] ?? "")
      ) {
        numericContextStart -= 1;
      }

      const numericContext = text.slice(numericContextStart, emailStart);
      const firstDigitOffset = numericContext.search(/\d/);
      if (firstDigitOffset >= 0) {
        safePrefixEnd = Math.min(
          safePrefixEnd,
          numericContextStart + firstDigitOffset,
        );
      }
    }
  }

  // Cards and SSNs can contain spaces or hyphens, so retain a trailing
  // digit/separator sequence independently from the email token.
  const numericRunStart = trailingRunStart(text, (character) =>
    NUMERIC_SEQUENCE_CHARACTER.test(character),
  );
  if (numericRunStart !== undefined) {
    const run = text.slice(numericRunStart);
    const firstDigitOffset = run.search(/\d/);

    if (firstDigitOffset >= 0) {
      safePrefixEnd = Math.min(
        safePrefixEnd,
        numericRunStart + firstDigitOffset,
      );
    }
  }

  // Valid supported PII is shorter than this bound. If an upstream emits an
  // enormous unresolved token, release its old prefix instead of growing
  // memory with the response length.
  return Math.max(safePrefixEnd, text.length - MAX_PENDING_CHARACTERS);
}

/**
 * Incrementally redacts PII while retaining only the suffix that could still
 * become a match when the next provider delta arrives.
 */
export class StreamingPiiRedactor {
  private pending = "";
  private peakBufferedCharacters = 0;
  private redactionCount = 0;
  private finished = false;

  public push(delta: string): string {
    if (this.finished) {
      throw new Error("Cannot push text after the redactor has finished");
    }

    if (delta.length === 0) {
      return "";
    }

    this.pending += delta;
    const safePrefixEnd = unresolvedCandidateStart(this.pending);
    const safePrefix = this.pending.slice(0, safePrefixEnd);
    this.pending = this.pending.slice(safePrefixEnd);
    this.peakBufferedCharacters = Math.max(
      this.peakBufferedCharacters,
      this.pending.length,
    );

    const result = redactPii(safePrefix);
    this.redactionCount += result.count;
    return result.text;
  }

  public finish(): string {
    if (this.finished) {
      return "";
    }

    this.finished = true;
    const result = redactPii(this.pending);
    this.pending = "";
    this.redactionCount += result.count;
    return result.text;
  }

  public getStats(): RedactionStats {
    return {
      bufferedCharacters: this.pending.length,
      peakBufferedCharacters: this.peakBufferedCharacters,
      redactionCount: this.redactionCount,
    };
  }
}
