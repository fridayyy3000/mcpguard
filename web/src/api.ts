import type { DashboardSnapshot, DemoRunRequest, DemoRunResult } from "./types";

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function fetchDashboard(): Promise<DashboardSnapshot> {
  return readResponse<DashboardSnapshot>(
    await fetch("/api/dashboard", { cache: "no-store" }),
  );
}

export async function runAgent(
  request: DemoRunRequest,
): Promise<DemoRunResult> {
  return readResponse<DemoRunResult>(
    await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    }),
  );
}
