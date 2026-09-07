import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import { fetchDashboard, runAgent } from "./api";
import { Sidebar } from "./components/Sidebar";
import { Playground } from "./screens/Playground";
import { RoutingDashboard } from "./screens/RoutingDashboard";
import { SecurityTrace } from "./screens/SecurityTrace";
import type {
  DashboardSnapshot,
  DemoRunRequest,
  DemoRunResult,
  ScreenId,
} from "./types";

export default function App() {
  const [active, setActive] = useState<ScreenId>("playground");
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [latest, setLatest] = useState<DemoRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      setError(null);
      setSnapshot(await fetchDashboard());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to load the demo",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const execute = async (request: DemoRunRequest) => {
    try {
      setRunning(true);
      setError(null);
      const result = await runAgent(request);
      setLatest(result);
      setSnapshot(await fetchDashboard());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The run failed");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <Sidebar active={active} onChange={setActive} />

      <main className="min-w-0 lg:pl-64">
        <header className="hidden h-[76px] items-center justify-between border-b border-[var(--line)] bg-[color:rgba(7,16,15,.82)] px-8 backdrop-blur xl:flex">
          <div className="flex items-center gap-3 font-mono text-xs uppercase tracking-[0.14em] text-[var(--muted-2)]">
            <span>Workspace</span>
            <span className="text-[var(--line-strong)]">/</span>
            <span className="text-[var(--muted)]">Enterprise sandbox</span>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs text-[var(--muted)]">
            <span>112 TESTS PASSING</span>
            <span className="h-4 w-px bg-[var(--line-strong)]" />
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--accent)]" />
              Control plane online
            </span>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1640px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          {error && (
            <div className="mb-6 flex flex-col justify-between gap-4 border border-[color:rgba(255,107,120,.35)] bg-[color:rgba(255,107,120,.08)] p-4 sm:flex-row sm:items-center">
              <div className="flex items-start gap-3 text-sm text-[var(--text)]">
                <AlertCircle
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger)]"
                />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadDashboard()}
                className="inline-flex items-center gap-2 text-sm font-medium text-white"
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Retry
              </button>
            </div>
          )}

          {loading || !snapshot ? (
            <div className="grid min-h-[65vh] place-items-center">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin border-2 border-[var(--line-strong)] border-t-[var(--accent)]" />
                <p className="mt-4 font-mono text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                  Connecting control plane
                </p>
              </div>
            </div>
          ) : active === "playground" ? (
            <Playground
              snapshot={snapshot}
              latest={latest}
              running={running}
              onRun={execute}
            />
          ) : active === "security" ? (
            <SecurityTrace snapshot={snapshot} />
          ) : (
            <RoutingDashboard snapshot={snapshot} />
          )}
        </div>
      </main>
    </div>
  );
}
