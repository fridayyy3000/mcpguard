import {
  Bot,
  GitBranch,
  Route,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import type { ScreenId } from "../types";

const items: Array<{ id: ScreenId; label: string; icon: LucideIcon }> = [
  { id: "playground", label: "Agent playground", icon: Bot },
  { id: "security", label: "Security traces", icon: ShieldCheck },
  { id: "routing", label: "Model routing", icon: Route },
];

export function Sidebar({
  active,
  onChange,
}: {
  active: ScreenId;
  onChange: (screen: ScreenId) => void;
}) {
  return (
    <aside className="border-b border-[var(--line)] bg-[var(--sidebar)] lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:w-64 lg:border-b-0 lg:border-r">
      <div className="flex h-full flex-col">
        <div className="flex h-[76px] items-center gap-3 border-b border-[var(--line)] px-5 lg:px-6">
          <div className="grid h-9 w-9 place-items-center bg-[var(--accent)] text-[var(--ink)] shadow-[0_0_24px_rgba(184,243,76,.16)]">
            <ShieldCheck aria-hidden="true" className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[15px] font-semibold tracking-[-0.02em] text-white">
              MCPGuard
            </p>
            <p className="font-mono text-[11px] uppercase tracking-[0.13em] text-[var(--muted)]">
              Control plane
            </p>
          </div>
        </div>

        <nav
          aria-label="Product screens"
          className="flex gap-2 overflow-x-auto p-3 lg:flex-1 lg:flex-col lg:gap-1 lg:p-4"
        >
          {items.map(({ id, label, icon: Icon }) => {
            const selected = id === active;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChange(id)}
                aria-current={selected ? "page" : undefined}
                className={`group flex min-w-fit items-center gap-3 border px-3 py-3 text-left text-sm transition lg:w-full ${
                  selected
                    ? "border-[color:rgba(184,243,76,.28)] bg-[color:rgba(184,243,76,.08)] text-white"
                    : "border-transparent text-[var(--muted)] hover:border-[var(--line)] hover:bg-[var(--panel)] hover:text-white"
                }`}
              >
                <Icon
                  aria-hidden="true"
                  className={`h-[18px] w-[18px] ${selected ? "text-[var(--accent)]" : "text-[var(--muted-2)] group-hover:text-white"}`}
                />
                {label}
              </button>
            );
          })}
        </nav>

        <div className="hidden border-t border-[var(--line)] p-5 lg:block">
          <div className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--accent)]" />
            Deterministic services online
          </div>
          <a
            href="https://github.com/fridayyy3000/quilr-fde-assessment"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-[var(--muted)] transition hover:text-white"
          >
            <GitBranch aria-hidden="true" className="h-4 w-4" />
            View source
          </a>
        </div>
      </div>
    </aside>
  );
}
