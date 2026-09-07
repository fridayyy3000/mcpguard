import { describe, expect, it } from "vitest";

import {
  InvalidProviderEventError,
  parseProviderDelta,
  replaceProviderContent,
} from "../../src/task3/provider-stream.js";
import {
  serializeSseData,
  SseEventTooLargeError,
  SseParser,
} from "../../src/task3/sse.js";

describe("Task 3 SSE framing", () => {
  it("parses events across every possible network-chunk boundary", () => {
    const wire =
      'data: {"delta":"one"}\n\ndata: {"delta":"two"}\n\ndata: [DONE]\n\n';

    for (let split = 1; split < wire.length; split += 1) {
      const parser = new SseParser();
      const events = [
        ...parser.push(wire.slice(0, split)),
        ...parser.push(wire.slice(split)),
        ...parser.finish(),
      ];

      expect(events.map(({ data }) => data)).toEqual([
        '{"delta":"one"}',
        '{"delta":"two"}',
        "[DONE]",
      ]);
    }
  });

  it("supports CRLF, comments, event names, and multiline data", () => {
    const parser = new SseParser();
    const events = parser.push(
      ": heartbeat\r\nevent: message\r\ndata: first\r\ndata: second\r\n\r\n",
    );

    expect(events).toEqual([{ event: "message", data: "first\nsecond" }]);
  });

  it("processes a final event even without a blank-line terminator", () => {
    const parser = new SseParser();

    expect(parser.push("data: final")).toEqual([]);
    expect(parser.finish()).toEqual([{ data: "final" }]);
  });

  it("serializes multiline data without breaking SSE framing", () => {
    expect(serializeSseData("first\nsecond", "message")).toBe(
      "event: message\ndata: first\ndata: second\n\n",
    );
  });

  it("bounds an unterminated provider event", () => {
    const parser = new SseParser(16);

    expect(() => parser.push("data: " + "x".repeat(20))).toThrow(
      SseEventTooLargeError,
    );
  });
});

describe("Task 3 provider delta parsing", () => {
  it("extracts and replaces OpenAI-compatible content deltas", () => {
    const parsed = parseProviderDelta(
      JSON.stringify({
        id: "chunk-1",
        choices: [
          { index: 0, delta: { content: "secret" }, finish_reason: null },
        ],
      }),
    );

    expect(parsed.content).toBe("secret");
    expect(replaceProviderContent(parsed, "[REDACTED]").choices).toMatchObject([
      { index: 0, delta: { content: "[REDACTED]" } },
    ]);
  });

  it("recognizes terminal metadata events", () => {
    const parsed = parseProviderDelta(
      JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      }),
    );

    expect(parsed).toMatchObject({ terminal: true });
    expect(parsed.content).toBeUndefined();
  });

  it.each(["not-json", "[]", "null"])(
    "fails closed for malformed provider data: %s",
    (data) => {
      expect(() => parseProviderDelta(data)).toThrow(InvalidProviderEventError);
    },
  );
});
