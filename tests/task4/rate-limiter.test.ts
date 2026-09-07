import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type Clock,
  SqliteSlidingWindowRateLimiter,
} from "../../src/task4/rate-limiter.js";
import {
  completionRequestSchema,
  ConservativeTokenEstimator,
} from "../../src/task4/token-estimator.js";

describe("Task 4 SQLite sliding-window rate limiter", () => {
  let directory: string;
  let databasePath: string;
  let now: number;
  let clock: Clock;
  const limiters: SqliteSlidingWindowRateLimiter[] = [];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "qulr-task4-"));
    databasePath = join(directory, "rate-limits.sqlite");
    now = 1_000_000;
    clock = { nowMilliseconds: () => now };
  });

  afterEach(() => {
    for (const limiter of limiters.splice(0)) {
      limiter.close();
    }
    rmSync(directory, { recursive: true, force: true });
  });

  function createLimiter(limitTokens = 50_000): SqliteSlidingWindowRateLimiter {
    const limiter = new SqliteSlidingWindowRateLimiter({
      databasePath,
      limitTokens,
      windowMilliseconds: 60_000,
      clock,
    });
    limiters.push(limiter);
    return limiter;
  }

  it("allows exactly the limit and does not record a rejected reservation", () => {
    const limiter = createLimiter();

    expect(limiter.tryConsume("tenant-a", 30_000)).toMatchObject({
      allowed: true,
      usedTokens: 30_000,
      remainingTokens: 20_000,
    });
    expect(limiter.tryConsume("tenant-a", 20_000)).toMatchObject({
      allowed: true,
      usedTokens: 50_000,
      remainingTokens: 0,
    });
    expect(limiter.tryConsume("tenant-a", 1)).toMatchObject({
      allowed: false,
      usedTokens: 50_000,
      remainingTokens: 0,
      retryAfterMilliseconds: 60_000,
    });
    expect(limiter.tryConsume("tenant-a", 1)).toMatchObject({
      allowed: false,
      usedTokens: 50_000,
    });
  });

  it("evicts events precisely at the sliding-window boundary", () => {
    const limiter = createLimiter();

    limiter.tryConsume("tenant-a", 30_000);
    now += 30_000;
    limiter.tryConsume("tenant-a", 20_000);

    now = 1_060_000;
    expect(limiter.tryConsume("tenant-a", 30_000)).toMatchObject({
      allowed: true,
      usedTokens: 50_000,
      remainingTokens: 0,
    });
  });

  it("calculates when enough tokens—not merely the oldest event—expire", () => {
    const limiter = createLimiter();

    limiter.tryConsume("tenant-a", 3_000);
    now += 10_000;
    limiter.tryConsume("tenant-a", 4_000);
    now += 10_000;
    limiter.tryConsume("tenant-a", 40_000);

    expect(limiter.tryConsume("tenant-a", 10_000)).toMatchObject({
      allowed: false,
      retryAfterMilliseconds: 50_000,
    });
  });

  it("isolates usage by tenant API key", () => {
    const limiter = createLimiter(10_000);

    expect(limiter.tryConsume("tenant-a", 10_000).allowed).toBe(true);
    expect(limiter.tryConsume("tenant-a", 1).allowed).toBe(false);
    expect(limiter.tryConsume("tenant-b", 10_000).allowed).toBe(true);
  });

  it("persists usage after the limiter is closed and reopened", () => {
    const first = createLimiter(10_000);
    first.tryConsume("tenant-a", 8_000);
    first.close();
    limiters.splice(limiters.indexOf(first), 1);

    expect(existsSync(databasePath)).toBe(true);
    const reopened = createLimiter(10_000);
    expect(reopened.tryConsume("tenant-a", 3_000)).toMatchObject({
      allowed: false,
      usedTokens: 8_000,
    });
  });

  it("prevents oversubscription across two SQLite connections", async () => {
    const first = createLimiter();
    const second = createLimiter();

    const decisions = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        Promise.resolve(
          (index % 2 === 0 ? first : second).tryConsume("tenant-a", 3_000),
        ),
      ),
    );

    expect(decisions.filter(({ allowed }) => allowed)).toHaveLength(16);
    expect(decisions.filter(({ allowed }) => !allowed)).toHaveLength(4);
  });
});

describe("Task 4 completion token estimation", () => {
  const estimator = new ConservativeTokenEstimator();

  it("reserves both estimated input and maximum output tokens", () => {
    const request = completionRequestSchema.parse({
      prompt: "12345678",
      max_tokens: 100,
    });

    expect(estimator.estimate(request)).toBe(104);
  });

  it("supports chat messages and text content parts", () => {
    const request = completionRequestSchema.parse({
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      max_completion_tokens: 20,
    });

    expect(estimator.estimate(request)).toBeGreaterThan(20);
  });

  it.each([
    {},
    { prompt: "hello", max_tokens: 0 },
    { prompt: "hello", max_tokens: 10, max_completion_tokens: 10 },
  ])("rejects an invalid completion request: %j", (request) => {
    expect(completionRequestSchema.safeParse(request).success).toBe(false);
  });
});
