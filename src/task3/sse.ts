export interface SseEvent {
  data: string;
  event?: string;
}

export const DEFAULT_MAX_SSE_EVENT_CHARACTERS = 262_144;

export class SseEventTooLargeError extends Error {}

function parseEventBlock(block: string): SseEvent | undefined {
  const dataLines: string[] = [];
  let eventName: string | undefined;

  for (const line of block.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }

    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    let value = separator === -1 ? "" : line.slice(separator + 1);

    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "data") {
      dataLines.push(value);
    } else if (field === "event") {
      eventName = value;
    }
  }

  if (dataLines.length === 0) {
    return undefined;
  }

  return {
    data: dataLines.join("\n"),
    ...(eventName === undefined ? {} : { event: eventName }),
  };
}

/** Incremental SSE parser whose input may end in the middle of any line. */
export class SseParser {
  private pending = "";

  public constructor(
    private readonly maxEventCharacters = DEFAULT_MAX_SSE_EVENT_CHARACTERS,
  ) {
    if (!Number.isInteger(maxEventCharacters) || maxEventCharacters <= 0) {
      throw new Error("maxEventCharacters must be a positive integer");
    }
  }

  public push(chunk: string): SseEvent[] {
    this.pending += chunk;
    const events: SseEvent[] = [];

    while (true) {
      const separator = /\r?\n\r?\n/.exec(this.pending);
      if (!separator || separator.index === undefined) {
        break;
      }

      if (separator.index > this.maxEventCharacters) {
        throw new SseEventTooLargeError("Provider SSE event is too large");
      }

      const block = this.pending.slice(0, separator.index);
      this.pending = this.pending.slice(separator.index + separator[0].length);

      const event = parseEventBlock(block);
      if (event) {
        events.push(event);
      }
    }

    if (this.pending.length > this.maxEventCharacters) {
      throw new SseEventTooLargeError("Provider SSE event is too large");
    }

    return events;
  }

  public finish(): SseEvent[] {
    if (this.pending.length === 0) {
      return [];
    }

    const finalBlock = this.pending;
    this.pending = "";

    if (finalBlock.length > this.maxEventCharacters) {
      throw new SseEventTooLargeError("Provider SSE event is too large");
    }

    const event = parseEventBlock(finalBlock);
    return event ? [event] : [];
  }
}

export function serializeSseData(data: string, event?: string): string {
  const eventLine = event ? `event: ${event}\n` : "";
  const dataLines = data
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");

  return `${eventLine}${dataLines}\n\n`;
}
