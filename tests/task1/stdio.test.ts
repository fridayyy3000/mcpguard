import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

describe("Task 1 stdio isolation", () => {
  let child: ChildProcessWithoutNullStreams | undefined;

  afterEach(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  });

  it("keeps stdout as pure JSON-RPC and sends logs to stderr", async () => {
    child = spawn(process.execPath, ["dist/task1/index.js"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const stdoutLines: string[] = [];
    let stderr = "";
    const lineReader = createInterface({ input: child.stdout });

    lineReader.on("line", (line) => stdoutLines.push(line));
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const send = (message: object): void => {
      child?.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const waitForResponse = (id: number): Promise<JsonRpcMessage> =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error(`Timed out waiting for JSON-RPC id ${id}`)),
          3_000,
        );

        const onLine = (line: string): void => {
          try {
            const message = JSON.parse(line) as JsonRpcMessage;
            if (message.id === id) {
              clearTimeout(timeout);
              lineReader.off("line", onLine);
              resolve(message);
            }
          } catch {
            // The final assertion reports any non-JSON stdout line clearly.
          }
        };

        lineReader.on("line", onLine);
      });

    const initialization = waitForResponse(1);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "stdio-test", version: "1.0.0" },
      },
    });
    expect((await initialization).result).toBeDefined();

    send({ jsonrpc: "2.0", method: "notifications/initialized" });

    const toolList = waitForResponse(2);
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect((await toolList).result).toBeDefined();

    const invalidCall = waitForResponse(3);
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "trigger_refund",
        arguments: {
          customer_id: "CUST-12345",
          amount: -5,
          reason: "Duplicate transaction",
        },
      },
    });
    expect((await invalidCall).error?.code).toBe(-32602);

    const validCall = waitForResponse(4);
    send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "get_customer_record",
        arguments: { customer_id: "CUST-12345" },
      },
    });
    expect((await validCall).result).toBeDefined();

    expect(stdoutLines.length).toBeGreaterThanOrEqual(4);
    expect(() => stdoutLines.map((line) => JSON.parse(line))).not.toThrow();
    expect(stdoutLines.some((line) => line.includes("MCP server ready"))).toBe(
      false,
    );
    expect(stderr).toContain("MCP server ready");
    expect(stderr).toContain('"transport":"stdio"');
  });
});
