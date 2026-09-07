import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

import { createTask1Server } from "../task1/server.js";
import { StaticTokenVerifier } from "../task2/auth.js";
import { authorizeToolCall } from "../task2/authorization.js";
import { StreamingPiiRedactor } from "../task3/redactor.js";
import { type ProviderAttempt } from "../task4/provider-client.js";
import { SqliteSlidingWindowRateLimiter } from "../task4/rate-limiter.js";
import { fallbackReason } from "../task4/routing-policy.js";
import { ConservativeTokenEstimator } from "../task4/token-estimator.js";
import {
  demoRunRequestSchema,
  type DashboardSnapshot,
  type DemoRunRequest,
  type DemoRunResult,
  type DemoScenario,
  type PipelineStep,
  type RoutingDecision,
  type SecurityDecision,
  type TokenDecision,
} from "./contracts.js";

const DEMO_TOKEN_LIMIT = 12_000;
const PRIMARY_PROVIDER = "Aster Pro";
const SECONDARY_PROVIDER = "Nimbus Fast";
const TENANT_KEY = "portfolio-demo-tenant";

interface DemoRuntimeOptions {
  seed?: boolean;
}

interface ScenarioDefinition {
  tool: "get_customer_record" | "trigger_refund" | "admin_reset_key";
  arguments: Record<string, unknown>;
  fallback: boolean;
}

const scenarioDefinitions: Record<DemoScenario, ScenarioDefinition> = {
  customer_lookup: {
    tool: "get_customer_record",
    arguments: { customer_id: "CUST-12345" },
    fallback: false,
  },
  refund_request: {
    tool: "trigger_refund",
    arguments: {
      customer_id: "CUST-A1B2C",
      amount: 42.5,
      reason: "Duplicate subscription charge",
    },
    fallback: false,
  },
  blocked_admin: {
    tool: "admin_reset_key",
    arguments: {},
    fallback: false,
  },
  provider_fallback: {
    tool: "get_customer_record",
    arguments: { customer_id: "CUST-A1B2C" },
    fallback: true,
  },
};

function asTokenDecision(
  decision: ReturnType<SqliteSlidingWindowRateLimiter["tryConsume"]>,
): TokenDecision {
  return {
    allowed: decision.allowed,
    limit: decision.limitTokens,
    remaining: decision.remainingTokens,
    requested: decision.requestedTokens,
    used: decision.usedTokens,
  };
}

function emptyTokenDecision(): TokenDecision {
  return {
    allowed: false,
    limit: DEMO_TOKEN_LIMIT,
    remaining: DEMO_TOKEN_LIMIT,
    requested: 0,
    used: 0,
  };
}

function emptyRoutingDecision(): RoutingDecision {
  return {
    primary: PRIMARY_PROVIDER,
    secondary: SECONDARY_PROVIDER,
    selected: null,
    fallback_reason: null,
    primary_status: "not_called",
  };
}

function redactInUnevenChunks(value: string): {
  safeText: string;
  redactions: number;
} {
  const redactor = new StreamingPiiRedactor();
  const chunkSizes = [5, 13, 2, 17, 7, 3, 11];
  let cursor = 0;
  let safeText = "";
  let chunkIndex = 0;

  while (cursor < value.length) {
    const size = chunkSizes[chunkIndex % chunkSizes.length] ?? 8;
    safeText += redactor.push(value.slice(cursor, cursor + size));
    cursor += size;
    chunkIndex += 1;
  }

  safeText += redactor.finish();
  return { safeText, redactions: redactor.getStats().redactionCount };
}

function rawResponseForScenario(
  scenario: DemoScenario,
  toolResult: unknown,
): string {
  switch (scenario) {
    case "customer_lookup":
      return `Customer lookup completed: ${JSON.stringify(toolResult)}. Send the follow-up to ada.lovelace@example.com.`;
    case "refund_request":
      return `Refund approved: ${JSON.stringify(toolResult)}. Confirmation will be sent to payments@example.com.`;
    case "provider_fallback":
      return `The secondary model recovered the request and returned ${JSON.stringify(toolResult)}. Never expose card 4111 1111 1111 1111.`;
    case "blocked_admin":
      return "The administrative request was blocked before the protected MCP tool was contacted.";
  }
}

function step(
  id: string,
  label: string,
  detail: string,
  durationMs: number,
  status: PipelineStep["status"] = "complete",
): PipelineStep {
  return {
    id,
    label,
    detail,
    duration_ms: durationMs,
    status,
  };
}

function parseToolResult(value: unknown): unknown {
  const parsed = CallToolResultSchema.parse(value);
  const content = parsed.content[0];

  if (content?.type !== "text") {
    return { message: "Tool completed without a text result" };
  }

  try {
    return JSON.parse(content.text) as unknown;
  } catch {
    return { message: content.text };
  }
}

export class DemoRuntime {
  private readonly traces: DemoRunResult[] = [];
  private readonly estimator = new ConservativeTokenEstimator();
  private readonly rateLimiter = new SqliteSlidingWindowRateLimiter({
    databasePath: ":memory:",
    limitTokens: DEMO_TOKEN_LIMIT,
  });
  private readonly tokenVerifier = new StaticTokenVerifier([
    { token: "demo-admin-token", role: "admin" },
    { token: "demo-viewer-token", role: "viewer" },
  ]);
  private readonly mcpServer = createTask1Server();
  private readonly mcpClient = new Client({
    name: "mcpguard-product-demo",
    version: "1.0.0",
  });
  private connected = false;
  private closed = false;

  public constructor(private readonly options: DemoRuntimeOptions = {}) {}

  public async initialize(): Promise<void> {
    if (this.connected) {
      return;
    }
    if (this.closed) {
      throw new Error("Demo runtime is closed");
    }

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await this.mcpServer.connect(serverTransport);
    await this.mcpClient.connect(clientTransport);
    this.connected = true;

    if (this.options.seed !== false) {
      await this.seedDashboard();
    }
  }

  private async seedDashboard(): Promise<void> {
    const examples: DemoRunRequest[] = [
      {
        prompt: "Look up CUST-12345 and draft a safe account summary.",
        role: "viewer",
        scenario: "customer_lookup",
      },
      {
        prompt: "Issue the approved duplicate-charge refund for CUST-A1B2C.",
        role: "admin",
        scenario: "refund_request",
      },
      {
        prompt: "Reset the protected service key.",
        role: "viewer",
        scenario: "blocked_admin",
      },
      {
        prompt: "Recover this request if the primary model is throttled.",
        role: "viewer",
        scenario: "provider_fallback",
      },
    ];

    for (const example of examples) {
      await this.run(example);
    }
  }

  public async run(input: DemoRunRequest): Promise<DemoRunResult> {
    if (!this.connected) {
      await this.initialize();
    }

    const request = demoRunRequestSchema.parse(input);
    const definition = scenarioDefinitions[request.scenario];
    const requestId = `req_${randomUUID().slice(0, 8)}`;
    const started = performance.now();
    const token =
      request.role === "admin" ? "demo-admin-token" : "demo-viewer-token";
    const authContext = this.tokenVerifier.verify(token);

    if (!authContext) {
      throw new Error("The deterministic demo token could not be verified");
    }

    const authorization = authorizeToolCall(authContext.role, definition.tool);
    const security: SecurityDecision = {
      authenticated: true,
      role: authContext.role,
      tool: definition.tool,
      allowed: authorization.allowed,
      reason:
        authorization.reason === "allowed"
          ? "Role policy allows this tool"
          : "Administrative tools require the admin role",
    };

    const steps: PipelineStep[] = [
      step(
        "authenticate",
        "Authenticate request",
        `${authContext.role} token verified with constant-time comparison`,
        2,
      ),
    ];

    if (!authorization.allowed) {
      steps.push(
        step(
          "authorize",
          "Authorize MCP tool",
          `${definition.tool} was denied before downstream execution`,
          1,
          "blocked",
        ),
        step(
          "mcp",
          "Execute MCP tool",
          "Protected downstream was not contacted",
          0,
          "skipped",
        ),
      );

      const result: DemoRunResult = {
        id: requestId,
        created_at: new Date().toISOString(),
        scenario: request.scenario,
        prompt: request.prompt,
        outcome: "blocked",
        safe_response: rawResponseForScenario(request.scenario, {}),
        pii_redactions: 0,
        latency_ms: Math.max(4, Math.round(performance.now() - started)),
        security,
        routing: emptyRoutingDecision(),
        tokens: emptyTokenDecision(),
        steps,
      };

      this.record(result);
      return result;
    }

    steps.push(
      step(
        "authorize",
        "Authorize MCP tool",
        `${definition.tool} is allowed for the ${request.role} role`,
        1,
      ),
    );

    let toolResult: unknown;
    if (definition.tool === "admin_reset_key") {
      toolResult = { executed: "admin_reset_key", status: "completed" };
    } else {
      toolResult = parseToolResult(
        await this.mcpClient.callTool(
          {
            name: definition.tool,
            arguments: definition.arguments,
          },
          CallToolResultSchema,
        ),
      );
    }

    steps.push(
      step(
        "mcp",
        "Execute MCP tool",
        `${definition.tool} completed through the validated tool boundary`,
        8,
      ),
    );

    const requestedTokens = this.estimator.estimate({
      messages: [{ role: "user", content: request.prompt }],
      max_tokens: definition.fallback ? 420 : 280,
    });
    const rateLimit = this.rateLimiter.tryConsume(TENANT_KEY, requestedTokens);
    const tokens = asTokenDecision(rateLimit);

    if (!rateLimit.allowed) {
      steps.push(
        step(
          "tokens",
          "Reserve token budget",
          "The rolling tenant budget rejected this request",
          2,
          "blocked",
        ),
      );
      const result: DemoRunResult = {
        id: requestId,
        created_at: new Date().toISOString(),
        scenario: request.scenario,
        prompt: request.prompt,
        outcome: "rate_limited",
        safe_response:
          "The request was stopped before model execution because the tenant token budget was exhausted.",
        pii_redactions: 0,
        latency_ms: Math.max(6, Math.round(performance.now() - started)),
        security,
        routing: emptyRoutingDecision(),
        tokens,
        steps,
      };
      this.record(result);
      return result;
    }

    steps.push(
      step(
        "tokens",
        "Reserve token budget",
        `${requestedTokens.toLocaleString()} tokens reserved atomically in SQLite`,
        3,
      ),
    );

    const primaryAttempt: ProviderAttempt = definition.fallback
      ? { kind: "http_error", status: 429 }
      : {
          kind: "success",
          body: Buffer.from("{}"),
          contentType: "application/json",
          status: 200,
        };
    const reason = fallbackReason(primaryAttempt);
    const routing: RoutingDecision = {
      primary: PRIMARY_PROVIDER,
      secondary: SECONDARY_PROVIDER,
      selected: reason ? SECONDARY_PROVIDER : PRIMARY_PROVIDER,
      fallback_reason: reason ?? null,
      primary_status: reason ? "rate_limited" : "healthy",
    };

    steps.push(
      step(
        "route",
        "Route model request",
        reason
          ? `${PRIMARY_PROVIDER} returned 429; ${SECONDARY_PROVIDER} selected once`
          : `${PRIMARY_PROVIDER} completed within the deadline`,
        reason ? 31 : 18,
        reason ? "fallback" : "complete",
      ),
    );

    const redacted = redactInUnevenChunks(
      rawResponseForScenario(request.scenario, toolResult),
    );
    steps.push(
      step(
        "redact",
        "Inspect streamed output",
        `${redacted.redactions} sensitive value${redacted.redactions === 1 ? "" : "s"} removed across partial chunks`,
        5,
      ),
    );

    const result: DemoRunResult = {
      id: requestId,
      created_at: new Date().toISOString(),
      scenario: request.scenario,
      prompt: request.prompt,
      outcome: "allowed",
      safe_response: redacted.safeText,
      pii_redactions: redacted.redactions,
      latency_ms: Math.max(
        steps.reduce((total, current) => total + current.duration_ms, 0),
        Math.round(performance.now() - started),
      ),
      security,
      routing,
      tokens,
      steps,
    };

    this.record(result);
    return result;
  }

  private record(result: DemoRunResult): void {
    this.traces.unshift(result);
    if (this.traces.length > 50) {
      this.traces.length = 50;
    }
  }

  public snapshot(): DashboardSnapshot {
    const allowedRuns = this.traces.filter(
      ({ outcome }) => outcome === "allowed",
    );
    const blockedCalls = this.traces.filter(
      ({ outcome }) => outcome === "blocked",
    ).length;
    const fallbacks = this.traces.filter(
      ({ routing }) => routing.fallback_reason !== null,
    ).length;
    const piiRedactions = this.traces.reduce(
      (total, trace) => total + trace.pii_redactions,
      0,
    );
    const used =
      this.traces.find(({ tokens }) => tokens.requested > 0)?.tokens.used ?? 0;
    const averageLatency =
      this.traces.length === 0
        ? 0
        : Math.round(
            this.traces.reduce((total, trace) => total + trace.latency_ms, 0) /
              this.traces.length,
          );
    const secondarySelections = allowedRuns.filter(
      ({ routing }) => routing.selected === SECONDARY_PROVIDER,
    ).length;
    const usage = [...allowedRuns]
      .reverse()
      .slice(-10)
      .map((trace, index) => ({
        label: `R${Math.max(1, allowedRuns.length - 9 + index)}`,
        tokens: trace.tokens.requested,
      }));

    return {
      generated_at: new Date().toISOString(),
      mode: "deterministic_demo",
      metrics: {
        total_runs: this.traces.length,
        blocked_calls: blockedCalls,
        pii_redactions: piiRedactions,
        fallbacks,
        average_latency_ms: averageLatency,
      },
      token_budget: {
        limit: DEMO_TOKEN_LIMIT,
        used,
        remaining: Math.max(0, DEMO_TOKEN_LIMIT - used),
        utilization_percent: Math.min(
          100,
          Math.round((used / DEMO_TOKEN_LIMIT) * 100),
        ),
      },
      providers: [
        {
          id: "primary",
          name: PRIMARY_PROVIDER,
          status: fallbacks > 0 ? "degraded" : "healthy",
          requests: allowedRuns.length,
          selected: allowedRuns.length - secondarySelections,
          average_latency_ms: 18,
        },
        {
          id: "secondary",
          name: SECONDARY_PROVIDER,
          status: "healthy",
          requests: secondarySelections,
          selected: secondarySelections,
          average_latency_ms: 31,
        },
      ],
      usage,
      traces: this.traces,
    };
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rateLimiter.close();

    if (this.connected) {
      await this.mcpClient.close();
      await this.mcpServer.close();
    }
  }
}
