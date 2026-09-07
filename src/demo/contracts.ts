import { z } from "zod";

export const demoScenarioSchema = z.enum([
  "customer_lookup",
  "refund_request",
  "blocked_admin",
  "provider_fallback",
]);

export const demoRunRequestSchema = z
  .object({
    prompt: z.string().trim().min(3).max(4_000),
    role: z.enum(["admin", "viewer"]),
    scenario: demoScenarioSchema,
  })
  .strict();

export type DemoScenario = z.infer<typeof demoScenarioSchema>;
export type DemoRunRequest = z.infer<typeof demoRunRequestSchema>;

export type RunOutcome = "allowed" | "blocked" | "rate_limited";
export type StepStatus = "complete" | "blocked" | "fallback" | "skipped";

export interface PipelineStep {
  id: string;
  label: string;
  detail: string;
  duration_ms: number;
  status: StepStatus;
}

export interface SecurityDecision {
  authenticated: boolean;
  role: "admin" | "viewer";
  tool: string;
  allowed: boolean;
  reason: string;
}

export interface RoutingDecision {
  primary: string;
  secondary: string;
  selected: string | null;
  fallback_reason: "timeout" | "rate_limited" | null;
  primary_status: "healthy" | "rate_limited" | "not_called";
}

export interface TokenDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  requested: number;
  used: number;
}

export interface DemoRunResult {
  id: string;
  created_at: string;
  scenario: DemoScenario;
  prompt: string;
  outcome: RunOutcome;
  safe_response: string;
  pii_redactions: number;
  latency_ms: number;
  security: SecurityDecision;
  routing: RoutingDecision;
  tokens: TokenDecision;
  steps: PipelineStep[];
}

export interface ProviderSummary {
  id: "primary" | "secondary";
  name: string;
  status: "healthy" | "degraded";
  requests: number;
  selected: number;
  average_latency_ms: number;
}

export interface UsagePoint {
  label: string;
  tokens: number;
}

export interface DashboardSnapshot {
  generated_at: string;
  mode: "deterministic_demo";
  metrics: {
    total_runs: number;
    blocked_calls: number;
    pii_redactions: number;
    fallbacks: number;
    average_latency_ms: number;
  };
  token_budget: {
    limit: number;
    used: number;
    remaining: number;
    utilization_percent: number;
  };
  providers: ProviderSummary[];
  usage: UsagePoint[];
  traces: DemoRunResult[];
}
