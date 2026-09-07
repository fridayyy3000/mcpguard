import { useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  Braces,
  KeyRound,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRound,
  Workflow,
} from "lucide-react";

import {
  EmptyPanel,
  Eyebrow,
  OutcomeBadge,
  StepIcon,
} from "../components/Primitives";
import type {
  DashboardSnapshot,
  DemoRunRequest,
  DemoRunResult,
  DemoScenario,
} from "../types";

const scenarioCopy: Record<
  DemoScenario,
  { label: string; detail: string; prompt: string }
> = {
  customer_lookup: {
    label: "Customer lookup",
    detail: "Validated read-only MCP call",
    prompt: "Look up CUST-12345 and draft a safe account summary.",
  },
  refund_request: {
    label: "Refund workflow",
    detail: "Validated destructive tool call",
    prompt: "Issue the approved duplicate-charge refund for CUST-A1B2C.",
  },
  blocked_admin: {
    label: "Blocked admin tool",
    detail: "Role policy stops execution",
    prompt: "Reset the protected service key.",
  },
  provider_fallback: {
    label: "Provider fallback",
    detail: "Primary 429 routes once",
    prompt: "Recover this request if the primary model is throttled.",
  },
};

const scenarioIcons = {
  customer_lookup: UserRound,
  refund_request: Braces,
  blocked_admin: KeyRound,
  provider_fallback: Workflow,
};

export function Playground({
  snapshot,
  latest,
  running,
  onRun,
}: {
  snapshot: DashboardSnapshot;
  latest: DemoRunResult | null;
  running: boolean;
  onRun: (request: DemoRunRequest) => Promise<void>;
}) {
  const [scenario, setScenario] = useState<DemoScenario>("customer_lookup");
  const [role, setRole] = useState<"admin" | "viewer">("viewer");
  const [prompt, setPrompt] = useState(scenarioCopy.customer_lookup.prompt);
  const result = latest ?? snapshot.traces[0] ?? null;
  const scenarios = useMemo(
    () =>
      Object.entries(scenarioCopy) as Array<
        [DemoScenario, (typeof scenarioCopy)[DemoScenario]]
      >,
    [],
  );

  const selectScenario = (next: DemoScenario) => {
    setScenario(next);
    setPrompt(scenarioCopy[next].prompt);
    if (next === "blocked_admin") {
      setRole("viewer");
    }
    if (next === "refund_request") {
      setRole("admin");
    }
  };

  return (
    <section>
      <div className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <Eyebrow>Run the complete path</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Agent playground
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
            Send one request through authentication, MCP authorization, tool
            validation, token admission, model routing, and streaming redaction.
          </p>
        </div>
        <div className="flex items-center gap-2 border border-[var(--line)] bg-[var(--panel)] px-3 py-2 font-mono text-xs text-[var(--muted)]">
          <span className="h-2 w-2 rounded-full bg-[var(--accent)]" />
          MOCK PROVIDERS · REAL CONTROL LOGIC
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(420px,4fr)]">
        <div className="space-y-6">
          <div className="border border-[var(--line)] bg-[var(--panel)]">
            <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <Bot
                  aria-hidden="true"
                  className="h-5 w-5 text-[var(--accent)]"
                />
                <h2 className="font-medium text-white">Request composer</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setScenario("customer_lookup");
                  setRole("viewer");
                  setPrompt(scenarioCopy.customer_lookup.prompt);
                }}
                className="flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-white"
              >
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
                Reset
              </button>
            </div>

            <div className="space-y-6 p-5 sm:p-6">
              <fieldset>
                <legend className="mb-3 text-sm font-medium text-[var(--muted)]">
                  Demo scenario
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {scenarios.map(([id, copy]) => {
                    const Icon = scenarioIcons[id];
                    const selected = scenario === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => selectScenario(id)}
                        className={`flex items-start gap-3 border p-3.5 text-left transition ${
                          selected
                            ? "border-[color:rgba(184,243,76,.38)] bg-[color:rgba(184,243,76,.07)]"
                            : "border-[var(--line)] bg-[var(--panel-deep)] hover:border-[var(--line-strong)]"
                        }`}
                      >
                        <Icon
                          aria-hidden="true"
                          className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? "text-[var(--accent)]" : "text-[var(--muted-2)]"}`}
                        />
                        <span>
                          <span className="block text-sm font-medium text-white">
                            {copy.label}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                            {copy.detail}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-[var(--muted)]">
                  Agent request
                </span>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={4}
                  className="w-full resize-none border border-[var(--line)] bg-[var(--input)] px-4 py-3 text-base leading-6 text-white outline-none transition placeholder:text-[var(--muted-2)] focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
                />
              </label>

              <div className="flex flex-col justify-between gap-4 border-t border-[var(--line)] pt-5 sm:flex-row sm:items-center">
                <fieldset>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">
                    Gateway role
                  </legend>
                  <div className="flex border border-[var(--line)] bg-[var(--input)] p-1">
                    {(["viewer", "admin"] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setRole(item)}
                        className={`px-4 py-2 text-sm font-medium capitalize transition ${
                          role === item
                            ? "bg-[var(--line-strong)] text-white"
                            : "text-[var(--muted)] hover:text-white"
                        }`}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <button
                  type="button"
                  disabled={running || prompt.trim().length < 3}
                  onClick={() => onRun({ prompt, role, scenario })}
                  className="inline-flex min-h-12 items-center justify-center gap-2 bg-[var(--accent)] px-6 font-semibold text-[var(--ink)] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {running ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-4 w-4 animate-spin"
                    />
                  ) : (
                    <Play aria-hidden="true" className="h-4 w-4 fill-current" />
                  )}
                  {running ? "Executing" : "Run agent"}
                  {!running && (
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Sparkles
                  aria-hidden="true"
                  className="h-5 w-5 text-[var(--cyan)]"
                />
                <h2 className="font-medium text-white">Safe response</h2>
              </div>
              {result && <OutcomeBadge outcome={result.outcome} />}
            </div>
            {result ? (
              <div className="border-l-2 border-[var(--cyan)] bg-[var(--panel-deep)] p-4 text-[15px] leading-7 text-[var(--text)]">
                {result.safe_response}
              </div>
            ) : (
              <EmptyPanel
                title="No execution yet"
                detail="Choose a scenario and run the agent to inspect its safe output."
              />
            )}
            {result && (
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 font-mono text-xs text-[var(--muted)]">
                <span>{result.id}</span>
                <span>{result.latency_ms} ms</span>
                <span>{result.pii_redactions} PII redacted</span>
              </div>
            )}
          </div>
        </div>

        <div className="border border-[var(--line)] bg-[var(--panel)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <Workflow
                aria-hidden="true"
                className="h-5 w-5 text-[var(--accent)]"
              />
              <h2 className="font-medium text-white">Execution trace</h2>
            </div>
            <span className="font-mono text-xs text-[var(--muted-2)]">
              {result?.steps.length ?? 0} STEPS
            </span>
          </div>

          {running ? (
            <div className="space-y-5 p-6">
              {[0, 1, 2, 3, 4].map((item) => (
                <div key={item} className="flex animate-pulse gap-4">
                  <div className="h-8 w-8 shrink-0 bg-[var(--line)]" />
                  <div className="flex-1">
                    <div className="h-4 w-40 bg-[var(--line)]" />
                    <div className="mt-3 h-3 w-full bg-[var(--line)]" />
                  </div>
                </div>
              ))}
            </div>
          ) : result ? (
            <div className="p-5 sm:p-6">
              <ol>
                {result.steps.map((item, index) => {
                  const tone =
                    item.status === "blocked"
                      ? "text-[var(--danger)] border-[color:rgba(255,107,120,.35)] bg-[color:rgba(255,107,120,.08)]"
                      : item.status === "fallback"
                        ? "text-[var(--warning)] border-[color:rgba(255,184,107,.35)] bg-[color:rgba(255,184,107,.08)]"
                        : item.status === "skipped"
                          ? "text-[var(--muted-2)] border-[var(--line)] bg-[var(--panel-deep)]"
                          : "text-[var(--accent)] border-[color:rgba(184,243,76,.28)] bg-[color:rgba(184,243,76,.07)]";
                  return (
                    <li
                      key={item.id}
                      className="relative flex gap-4 pb-6 last:pb-0"
                    >
                      {index < result.steps.length - 1 && (
                        <span className="absolute bottom-0 left-4 top-8 w-px bg-[var(--line-strong)]" />
                      )}
                      <span
                        className={`relative z-10 grid h-8 w-8 shrink-0 place-items-center border ${tone}`}
                      >
                        <StepIcon status={item.status} />
                      </span>
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium text-white">
                            {item.label}
                          </p>
                          <span className="shrink-0 font-mono text-xs text-[var(--muted-2)]">
                            {item.duration_ms} ms
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">
                          {item.detail}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="mt-7 grid gap-px border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
                <div className="bg-[var(--panel-deep)] p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-[var(--muted-2)]">
                    <ShieldCheck aria-hidden="true" className="h-4 w-4" />
                    Security
                  </div>
                  <p className="text-sm font-medium text-white">
                    {result.security.allowed ? "Tool allowed" : "Tool blocked"}
                  </p>
                  <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                    {result.security.role} · {result.security.tool}
                  </p>
                </div>
                <div className="bg-[var(--panel-deep)] p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs uppercase tracking-[0.1em] text-[var(--muted-2)]">
                    <Workflow aria-hidden="true" className="h-4 w-4" />
                    Provider
                  </div>
                  <p className="text-sm font-medium text-white">
                    {result.routing.selected ?? "Not contacted"}
                  </p>
                  <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                    {result.routing.fallback_reason
                      ? `fallback · ${result.routing.fallback_reason}`
                      : "direct route"}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6">
              <EmptyPanel
                title="Trace awaiting request"
                detail="The complete policy and execution path will appear here."
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
