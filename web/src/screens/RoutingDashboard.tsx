import type { CSSProperties } from "react";
import {
  Activity,
  ArrowRight,
  CircleGauge,
  Database,
  Gauge,
  RefreshCcwDot,
  Route,
  Server,
  Zap,
} from "lucide-react";

import { Eyebrow, MetricCard, OutcomeBadge } from "../components/Primitives";
import type { DashboardSnapshot } from "../types";

export function RoutingDashboard({
  snapshot,
}: {
  snapshot: DashboardSnapshot;
}) {
  const maximumUsage = Math.max(
    1,
    ...snapshot.usage.map(({ tokens }) => tokens),
  );
  const routedTraces = snapshot.traces.filter(
    ({ routing }) => routing.selected !== null,
  );

  return (
    <section>
      <div className="mb-8 flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div>
          <Eyebrow>Spend and resilience at a glance</Eyebrow>
          <h1 className="text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">
            Model usage &amp; routing
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--muted)]">
            Inspect token admission, provider health, and every controlled
            fallback without exposing tenant credentials or prompts.
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-[var(--muted)]">
          <Database aria-hidden="true" className="h-4 w-4 text-[var(--cyan)]" />
          SQLITE SLIDING WINDOW · 60 SEC
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Token budget used"
          value={`${snapshot.token_budget.utilization_percent}%`}
          detail={`${snapshot.token_budget.used.toLocaleString()} of ${snapshot.token_budget.limit.toLocaleString()} reserved`}
          accent="lime"
        />
        <MetricCard
          label="Controlled fallbacks"
          value={snapshot.metrics.fallbacks}
          detail="Only on timeout or HTTP 429"
          accent="cyan"
        />
        <MetricCard
          label="Provider requests"
          value={routedTraces.length}
          detail="Credentials isolated per provider"
        />
        <MetricCard
          label="Mean route latency"
          value={`${snapshot.metrics.average_latency_ms} ms`}
          detail="Policy, provider, and guardrail"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(360px,.75fr)_minmax(0,1.25fr)]">
        <div className="border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-6">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <CircleGauge
                aria-hidden="true"
                className="h-5 w-5 text-[var(--accent)]"
              />
              <h2 className="font-medium text-white">Tenant budget</h2>
            </div>
            <span className="font-mono text-xs text-[var(--muted-2)]">
              PORTFOLIO-DEMO
            </span>
          </div>

          <div className="flex flex-col items-center gap-7 sm:flex-row sm:items-center xl:flex-col 2xl:flex-row">
            <div
              className="radial-meter grid h-44 w-44 shrink-0 place-items-center rounded-full"
              style={
                {
                  "--usage": snapshot.token_budget.utilization_percent,
                } as CSSProperties
              }
            >
              <div className="grid h-[138px] w-[138px] place-items-center rounded-full bg-[var(--panel)] text-center">
                <div>
                  <p className="font-mono text-3xl font-semibold text-white">
                    {snapshot.token_budget.utilization_percent}%
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">reserved</p>
                </div>
              </div>
            </div>

            <div className="w-full flex-1 space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-[var(--muted)]">Consumed</span>
                  <span className="font-mono text-white">
                    {snapshot.token_budget.used.toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--line)]">
                  <div
                    className="h-full bg-[var(--accent)]"
                    style={{
                      width: `${snapshot.token_budget.utilization_percent}%`,
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-[var(--line)] pt-4 text-sm">
                <span className="text-[var(--muted)]">Remaining</span>
                <span className="font-mono text-white">
                  {snapshot.token_budget.remaining.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs leading-5 text-[var(--muted-2)]">
                <RefreshCcwDot
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0"
                />
                Reservations expire on their exact rolling-window boundary.
              </div>
            </div>
          </div>
        </div>

        <div className="border border-[var(--line)] bg-[var(--panel)] p-5 sm:p-6">
          <div className="mb-8 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Activity
                aria-hidden="true"
                className="h-5 w-5 text-[var(--cyan)]"
              />
              <h2 className="font-medium text-white">Reservation history</h2>
            </div>
            <span className="font-mono text-xs text-[var(--muted-2)]">
              ESTIMATED TOKENS
            </span>
          </div>

          <div className="flex h-56 items-end gap-3 border-b border-l border-[var(--line-strong)] px-3 pt-3 sm:gap-5 sm:px-5">
            {snapshot.usage.map((point, index) => (
              <div
                key={`${point.label}-${index}`}
                className="group flex h-full min-w-0 flex-1 flex-col justify-end"
              >
                <div className="mb-2 text-center font-mono text-[10px] text-[var(--muted-2)] opacity-0 transition group-hover:opacity-100">
                  {point.tokens}
                </div>
                <div
                  className="min-h-2 bg-[linear-gradient(180deg,var(--cyan),rgba(66,214,199,.22))] transition group-hover:brightness-125"
                  style={{
                    height: `${Math.max(8, (point.tokens / maximumUsage) * 100)}%`,
                  }}
                />
                <span className="mt-2 truncate text-center font-mono text-[10px] text-[var(--muted-2)]">
                  {point.label}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
            Each reservation includes estimated input plus the maximum possible
            output, preventing concurrent requests from oversubscribing a
            tenant.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <div className="border border-[var(--line)] bg-[var(--panel)]">
          <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4 sm:px-6">
            <Server
              aria-hidden="true"
              className="h-5 w-5 text-[var(--accent)]"
            />
            <h2 className="font-medium text-white">Provider health</h2>
          </div>
          <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2">
            {snapshot.providers.map((provider) => (
              <div key={provider.id} className="bg-[var(--panel)] p-5 sm:p-6">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-[var(--muted)] capitalize">
                      {provider.id} provider
                    </p>
                    <p className="mt-1 font-medium text-white">
                      {provider.name}
                    </p>
                  </div>
                  <span
                    className={`flex items-center gap-2 font-mono text-xs uppercase ${provider.status === "healthy" ? "text-[var(--accent)]" : "text-[var(--warning)]"}`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${provider.status === "healthy" ? "bg-[var(--accent)]" : "bg-[var(--warning)]"}`}
                    />
                    {provider.status}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 border-t border-[var(--line)] pt-4">
                  <div>
                    <p className="font-mono text-lg text-white">
                      {provider.requests}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted-2)]">
                      requests
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-lg text-white">
                      {provider.selected}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted-2)]">
                      selected
                    </p>
                  </div>
                  <div>
                    <p className="font-mono text-lg text-white">
                      {provider.average_latency_ms}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted-2)]">avg ms</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-[var(--line)] bg-[var(--panel)]">
          <div className="flex items-center gap-3 border-b border-[var(--line)] px-5 py-4 sm:px-6">
            <Route aria-hidden="true" className="h-5 w-5 text-[var(--cyan)]" />
            <h2 className="font-medium text-white">Recent routes</h2>
          </div>
          <div>
            {routedTraces.slice(0, 5).map((trace) => (
              <div
                key={trace.id}
                className="flex flex-col gap-3 border-b border-[var(--line)] px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={`grid h-8 w-8 shrink-0 place-items-center border ${trace.routing.fallback_reason ? "border-[color:rgba(255,184,107,.32)] bg-[color:rgba(255,184,107,.08)] text-[var(--warning)]" : "border-[color:rgba(184,243,76,.28)] bg-[color:rgba(184,243,76,.07)] text-[var(--accent)]"}`}
                  >
                    {trace.routing.fallback_reason ? (
                      <Zap aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <Gauge aria-hidden="true" className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-white">
                      {trace.id}
                    </p>
                    <p className="mt-1 truncate text-xs text-[var(--muted)]">
                      {trace.routing.primary}
                      {trace.routing.fallback_reason && (
                        <>
                          <ArrowRight
                            aria-hidden="true"
                            className="mx-1 inline h-3 w-3"
                          />
                          {trace.routing.selected}
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-[var(--muted)]">
                    {trace.tokens.requested} tok
                  </span>
                  <OutcomeBadge outcome={trace.outcome} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
