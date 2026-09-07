import { describe, expect, it } from "vitest";

import {
  MAX_PENDING_CHARACTERS,
  REDACTION_MARKER,
  StreamingPiiRedactor,
} from "../../src/task3/redactor.js";

function redactDeltas(deltas: readonly string[]): {
  output: string;
  redactor: StreamingPiiRedactor;
} {
  const redactor = new StreamingPiiRedactor();
  let output = "";

  for (const delta of deltas) {
    output += redactor.push(delta);
  }

  output += redactor.finish();
  return { output, redactor };
}

describe("Task 3 streaming PII redactor", () => {
  it.each([
    "alex.smith+demo@example.co.uk",
    "123-45-6789",
    "123 45 6789",
    "123456789",
    "4111111111111111",
    "4111 1111 1111 1111",
    "4111-1111-1111-1111",
  ])("redacts %s across every possible two-chunk split", (pii) => {
    const complete = `Before ${pii} after.`;

    for (let split = 1; split < complete.length; split += 1) {
      expect(
        redactDeltas([complete.slice(0, split), complete.slice(split)]).output,
      ).toBe(`Before ${REDACTION_MARKER} after.`);
    }
  });

  it("redacts multiple PII types when the provider emits one character at a time", () => {
    const input =
      "Email jane@example.com, SSN 123-45-6789, card 4111 1111 1111 1111. Done.";
    const { output, redactor } = redactDeltas([...input]);

    expect(output).toBe(
      `Email ${REDACTION_MARKER}, SSN ${REDACTION_MARKER}, card ${REDACTION_MARKER}. Done.`,
    );
    expect(redactor.getStats().redactionCount).toBe(3);
  });

  it("does not redact incomplete lookalikes", () => {
    const input =
      "Keep user@example, 123-45-678, order 12345678, and version 4.11.1.";

    expect(redactDeltas([...input]).output).toBe(input);
  });

  it("releases safe completed text immediately", () => {
    const redactor = new StreamingPiiRedactor();

    expect(redactor.push("First safe token ")).toBe("First safe token ");
    expect(redactor.getStats().bufferedCharacters).toBe(0);
  });

  it("keeps retained state bounded for a pathological unbroken token", () => {
    const input = "a".repeat(10_000);
    const redactor = new StreamingPiiRedactor();
    const streamed = redactor.push(input);

    expect(redactor.getStats().bufferedCharacters).toBeLessThanOrEqual(
      MAX_PENDING_CHARACTERS,
    );
    expect(redactor.getStats().peakBufferedCharacters).toBeLessThanOrEqual(
      MAX_PENDING_CHARACTERS,
    );
    expect(streamed + redactor.finish()).toBe(input);
  });

  it("makes finish idempotent and rejects later writes", () => {
    const redactor = new StreamingPiiRedactor();
    redactor.push("safe");

    expect(redactor.finish()).toBe("safe");
    expect(redactor.finish()).toBe("");
    expect(() => redactor.push("later")).toThrow(
      "Cannot push text after the redactor has finished",
    );
  });
});
