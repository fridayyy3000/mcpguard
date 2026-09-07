import { timingSafeEqual } from "node:crypto";

export type Role = "admin" | "viewer";

export interface AuthContext {
  role: Role;
}

export interface TokenVerifier {
  verify(token: string): AuthContext | undefined;
}

interface TokenEntry {
  token: string;
  role: Role;
}

function tokensEqual(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);

  if (candidateBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(candidateBytes, expectedBytes);
}

/**
 * Deterministic token verification for the assessment's mock authentication
 * environment. A production deployment would replace this implementation
 * with a verified JWT/OIDC adapter without changing gateway authorization.
 */
export class StaticTokenVerifier implements TokenVerifier {
  public constructor(private readonly entries: readonly TokenEntry[]) {
    if (entries.length === 0) {
      throw new Error("At least one gateway token must be configured");
    }

    if (new Set(entries.map(({ token }) => token)).size !== entries.length) {
      throw new Error("Gateway tokens must be unique");
    }
  }

  public verify(token: string): AuthContext | undefined {
    const entry = this.entries.find((candidate) =>
      tokensEqual(token, candidate.token),
    );

    return entry ? { role: entry.role } : undefined;
  }
}

export function extractBearerToken(
  authorizationHeader: string | undefined,
): string | undefined {
  if (!authorizationHeader) {
    return undefined;
  }

  const match = /^Bearer[\t ]+([^\s,]+)$/i.exec(authorizationHeader.trim());
  return match?.[1];
}

export function createTokenVerifierFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): StaticTokenVerifier {
  const adminToken = environment.GATEWAY_ADMIN_TOKEN ?? "dev-admin-token";
  const viewerToken = environment.GATEWAY_VIEWER_TOKEN ?? "dev-viewer-token";

  return new StaticTokenVerifier([
    { token: adminToken, role: "admin" },
    { token: viewerToken, role: "viewer" },
  ]);
}
