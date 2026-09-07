import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DemoRuntime } from "../../src/demo/runtime.js";

describe("MCPGuard integrated demo runtime", () => {
  let runtime: DemoRuntime;

  beforeEach(async () => {
    runtime = new DemoRuntime({ seed: false });
    await runtime.initialize();
  });

  afterEach(async () => {
    await runtime.close();
  });

  it("runs a customer lookup through MCP and redacts streamed PII", async () => {
    const result = await runtime.run({
      prompt: "Look up CUST-12345 and produce a safe summary.",
      role: "viewer",
      scenario: "customer_lookup",
    });

    expect(result.outcome).toBe("allowed");
    expect(result.security.tool).toBe("get_customer_record");
    expect(result.safe_response).toContain("[REDACTED]");
    expect(result.safe_response).not.toContain("@example.com");
    expect(result.pii_redactions).toBe(1);
  });

  it("blocks a viewer before an administrative tool is executed", async () => {
    const result = await runtime.run({
      prompt: "Reset the protected service key.",
      role: "viewer",
      scenario: "blocked_admin",
    });

    expect(result.outcome).toBe("blocked");
    expect(result.security.allowed).toBe(false);
    expect(result.routing.selected).toBeNull();
    expect(result.steps.at(-1)?.status).toBe("skipped");
  });

  it("allows an administrator to execute the protected tool", async () => {
    const result = await runtime.run({
      prompt: "Reset the protected service key.",
      role: "admin",
      scenario: "blocked_admin",
    });

    expect(result.outcome).toBe("allowed");
    expect(result.security.allowed).toBe(true);
    expect(result.security.tool).toBe("admin_reset_key");
  });

  it("selects the secondary model only for an allowed fallback reason", async () => {
    const result = await runtime.run({
      prompt: "Recover this request when the primary provider is throttled.",
      role: "viewer",
      scenario: "provider_fallback",
    });

    expect(result.routing.primary_status).toBe("rate_limited");
    expect(result.routing.fallback_reason).toBe("rate_limited");
    expect(result.routing.selected).toBe("Nimbus Fast");
    expect(result.steps.some(({ status }) => status === "fallback")).toBe(true);
  });
});
