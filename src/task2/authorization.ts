import type { Role } from "./auth.js";

export type AuthorizationReason = "allowed" | "admin_role_required";

export interface ToolAuthorizationDecision {
  allowed: boolean;
  reason: AuthorizationReason;
}

/**
 * Keep the gateway's tool policy available as a pure function so operator
 * interfaces and tests can explain the exact decision the proxy enforces.
 */
export function authorizeToolCall(
  role: Role,
  toolName: string,
): ToolAuthorizationDecision {
  if (toolName.startsWith("admin_") && role !== "admin") {
    return { allowed: false, reason: "admin_role_required" };
  }

  return { allowed: true, reason: "allowed" };
}
