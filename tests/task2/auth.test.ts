import { describe, expect, it } from "vitest";

import {
  StaticTokenVerifier,
  extractBearerToken,
} from "../../src/task2/auth.js";

describe("Task 2 authentication", () => {
  const verifier = new StaticTokenVerifier([
    { token: "admin-secret", role: "admin" },
    { token: "viewer-secret", role: "viewer" },
  ]);

  it.each([
    ["Bearer admin-secret", "admin-secret"],
    ["bearer viewer-secret", "viewer-secret"],
    ["  BEARER   viewer-secret  ", "viewer-secret"],
  ])("extracts a valid bearer token", (header, expected) => {
    expect(extractBearerToken(header)).toBe(expected);
  });

  it.each([
    undefined,
    "",
    "Basic abc",
    "Bearer",
    "Bearer token with-spaces",
    "Bearer first,Bearer second",
  ])("rejects a missing or malformed authorization header: %j", (header) => {
    expect(extractBearerToken(header)).toBeUndefined();
  });

  it("maps configured opaque tokens to roles", () => {
    expect(verifier.verify("admin-secret")).toEqual({ role: "admin" });
    expect(verifier.verify("viewer-secret")).toEqual({ role: "viewer" });
    expect(verifier.verify("unknown")).toBeUndefined();
  });

  it("rejects an ambiguous token configuration", () => {
    expect(
      () =>
        new StaticTokenVerifier([
          { token: "same", role: "admin" },
          { token: "same", role: "viewer" },
        ]),
    ).toThrow("Gateway tokens must be unique");
  });
});
