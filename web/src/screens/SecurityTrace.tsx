import { useMemo, useState } from "react";
import {
  ChevronRight,
  CircleCheckBig,
  EyeOff,
  Fingerprint,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import {
  Eyebrow,
  MetricCard,
  OutcomeBadge,
  StepIcon,
} from "../components/Primitives";
import type { DashboardSnapshot, DemoRunResult, RunOutcome } from "../types";

type Filter = "all" | RunOutcome;

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

export function SecurityTrace({ snapshot }: { snapshot: DashboardSnapshot }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState(snapshot.traces[0]?.id ?? "");
  const traces = useMemo(
    () =>
      filter === "all"
        ? snapshot.traces
        : snapshot.traces.filter(({ outcome }) => outcome === filter),
    [filter, snapshot.traces],
  );
  const selected: DemoRunResult | undefined =
    traces.find(({ id }) => id === selectedId) ?? traces[0];

  return (
    <section>
      <div className="mb-8">
        <Eyebrow>Every decision is inspectable</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
          Security &amp; tool-call trace
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
          Review who called each MCP tool, which policy ran, what was blocked,
          and whether sensitive output was removed.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Observed requests"
          value={snapshot.metrics.total_runs}
          detail="Complete execution records"
          accent="cyan"
        />
        <MetricCard
          label="Blocked tool calls"
          value={snapshot.metrics.blocked_calls}
          detail="Stopped before downstream"
          accent="red"
        />
        <MetricCard
          label="PII redactions"
          value={snapshot.metrics.pii_redactions}
          detail="Never returned to the browser"
          accent="lime"
        />
        <MetricCard
          label="Average latency"
          value={`${snapshot.metrics.average_latency_ms} ms`}
          detail="Across policy and tool stages"
        />
      </div>

      <div className="mt-6 grid gap-6 2xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,.65fr)]">
        <div className="min-w-0 border border-[var(--line)] bg-[var(--panel)]">
          <div className="flex flex-col justify-between gap-4 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-center sm:px-6">
            <div className="flex items-center gap-3">
              <Fingerprint
                aria-hidden="true"
                className="h-5 w-5 text-[var(--accent)]"
              />
              <h2 className="font-medium text-white">Audit stream</h2>
            </div>
            <div className="flex flex-wrap gap-1 border border-[var(--line)] bg-[var(--input)] p-1">
              {(["all", "allowed", "blocked", "rate_limited"] as const).map(
                (item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setFilter(item)}
                    className={`px-3 py-1.5 text-xs font-medium capitalize transition ${
                      filter === item
                        ? "bg-[var(--line-strong)] text-white"
                        : "text-[var(--muted)] hover:text-white"
                    }`}
                  >
                    {item.replace("_", " ")}
                  </button>
                ),
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-[var(--line)] font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--muted-2)]">
                  <th className="px-5 py-3.5 font-medium sm:px-6">Request</th>
                  <th className="px-4 py-3.5 font-medium">Identity</th>
                  <th className="px-4 py-3.5 font-medium">MCP tool</th>
                  <th className="px-4 py-3.5 font-medium">PII</th>
                  <th className="px-4 py-3.5 font-medium">Decision</th>
                  <th className="w-10 px-4 py-3.5" />
                </tr>
              </thead>
              <tbody>
                {traces.map((trace) => (
                  <tr
                    key={trace.id}
                    onClick={() => setSelectedId(trace.id)}
                    className={`cursor-pointer border-b border-[var(--line)] transition last:border-b-0 hover:bg-[var(--panel-hover)] ${
                      selected?.id === trace.id ? "bg-[var(--panel-hover)]" : ""
                    }`}
                  >
                    <td className="px-5 py-4 sm:px-6">
                      <p className="font-mono text-xs text-white">{trace.id}</p>
                      <p className="mt-1 text-xs text-[var(--muted-2)]">
                        {timeLabel(trace.created_at)} · {trace.latency_ms} ms
                      </p>
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-2 text-sm capitalize text-[var(--text)]">
                        <span
                          className={`h-2 w-2 rounded-full ${trace.security.role === "admin" ? "bg-[var(--cyan)]" : "bg-[var(--muted-2)]"}`}
                        />
                        {trace.security.role}
                      </span>
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-[var(--text)]">
                      {trace.security.tool}
                    </td>
                    <td className="px-4 py-4">
                      <span className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
                        <EyeOff
                          aria-hidden="true"
                          className="h-4 w-4 text-[var(--muted-2)]"
                        />
                        {trace.pii_redactions}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <OutcomeBadge outcome={trace.outcome} />
                    </td>
                    <td className="px-4 py-4">
                      <ChevronRight
                        aria-hidden="true"
                        className="h-4 w-4 text-[var(--muted-2)]"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="border border-[var(--line)] bg-[var(--panel)]">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <div className="flex items-center gap-3">
              <LockKeyhole
                aria-hidden="true"
                className="h-5 w-5 text-[var(--accent)]"
              />
              <h2 className="font-medium text-white">Decision detail</h2>
            </div>
          </div>
          {selected ? (
            <div className="p-5">
              <div className="mb-5 flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-[var(--muted)]">
                  {selected.id}
                </span>
                <OutcomeBadge outcome={selected.outcome} />
              </div>

              <div className="space-y-px border border-[var(--line)] bg-[var(--line)]">
                {[
                  [
                    "Authenticated",
                    selected.security.authenticated ? "Yes" : "No",
                  ],
                  ["Resolved role", selected.security.role],
                  ["Requested tool", selected.security.tool],
                  [
                    "Policy result",
                    selected.security.allowed ? "Allow" : "Deny",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-4 bg-[var(--panel-deep)] px-4 py-3"
                  >
                    <span className="text-sm text-[var(--muted)]">{label}</span>
                    <span className="font-mono text-xs capitalize text-white">
                      {value}
                    </span>
                  </div>
                ))}
              </div>

              <div
                className={`mt-5 border-l-2 p-4 ${
                  selected.security.allowed
                    ? "border-[var(--accent)] bg-[color:rgba(184,243,76,.06)]"
                    : "border-[var(--danger)] bg-[color:rgba(255,107,120,.07)]"
                }`}
              >
                <div className="flex items-start gap-3">
                  {selected.security.allowed ? (
                    <CircleCheckBig
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]"
                    />
                  ) : (
                    <ShieldAlert
                      aria-hidden="true"
                      className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]"
                    />
                  )}
                  <p className="text-sm leading-6 text-[var(--text)]">
                    {selected.security.reason}
                  </p>
                </div>
              </div>

              <h3 className="mb-3 mt-6 font-mono text-xs font-semibold uppercase tracking-[0.12em] text-[var(--muted-2)]">
                Policy checkpoints
              </h3>
              <ol className="space-y-3">
                {selected.steps.slice(0, 3).map((item) => (
                  <li key={item.id} className="flex gap-3">
                    <span
                      className={`mt-0.5 ${item.status === "blocked" ? "text-[var(--danger)]" : item.status === "skipped" ? "text-[var(--muted-2)]" : "text-[var(--accent)]"}`}
                    >
                      <StepIcon status={item.status} />
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">
                        {item.label}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
                        {item.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="p-6 text-sm text-[var(--muted)]">
              No trace selected.
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
