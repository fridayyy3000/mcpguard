import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ShieldX, Timer } from "lucide-react";

import type { RunOutcome, StepStatus } from "../types";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
      <span className="h-px w-5 bg-[var(--accent)]" />
      {children}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  accent = "neutral",
}: {
  label: string;
  value: string | number;
  detail: string;
  accent?: "neutral" | "lime" | "cyan" | "red";
}) {
  const accentClasses = {
    neutral: "bg-[var(--line-strong)]",
    lime: "bg-[var(--accent)]",
    cyan: "bg-[var(--cyan)]",
    red: "bg-[var(--danger)]",
  };

  return (
    <div className="relative overflow-hidden border border-[var(--line)] bg-[var(--panel)] p-5">
      <span
        className={`absolute inset-y-0 left-0 w-1 ${accentClasses[accent]}`}
      />
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-3 font-mono text-3xl font-semibold tracking-[-0.04em] text-white">
        {value}
      </p>
      <p className="mt-2 text-sm text-[var(--muted-2)]">{detail}</p>
    </div>
  );
}

export function OutcomeBadge({ outcome }: { outcome: RunOutcome }) {
  const styles = {
    allowed:
      "border-[color:rgba(184,243,76,.28)] bg-[color:rgba(184,243,76,.08)] text-[var(--accent)]",
    blocked:
      "border-[color:rgba(255,107,120,.32)] bg-[color:rgba(255,107,120,.09)] text-[var(--danger)]",
    rate_limited:
      "border-[color:rgba(255,184,107,.3)] bg-[color:rgba(255,184,107,.08)] text-[var(--warning)]",
  };

  return (
    <span
      className={`inline-flex items-center border px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-[0.08em] ${styles[outcome]}`}
    >
      {outcome.replace("_", " ")}
    </span>
  );
}

export function StepIcon({ status }: { status: StepStatus }) {
  if (status === "blocked") {
    return <ShieldX aria-hidden="true" className="h-4 w-4" />;
  }
  if (status === "fallback") {
    return <AlertTriangle aria-hidden="true" className="h-4 w-4" />;
  }
  if (status === "skipped") {
    return <Timer aria-hidden="true" className="h-4 w-4" />;
  }
  return <CheckCircle2 aria-hidden="true" className="h-4 w-4" />;
}

export function EmptyPanel({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center border border-dashed border-[var(--line-strong)] px-8 text-center">
      <div className="mb-4 h-2 w-2 bg-[var(--accent)] shadow-[0_0_18px_var(--accent)]" />
      <p className="font-medium text-white">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--muted)]">
        {detail}
      </p>
    </div>
  );
}
