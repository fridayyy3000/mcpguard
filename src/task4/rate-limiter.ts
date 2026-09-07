import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type StatementSync } from "node:sqlite";

export const DEFAULT_TOKEN_LIMIT = 50_000;
export const DEFAULT_WINDOW_MILLISECONDS = 60_000;

export interface Clock {
  nowMilliseconds(): number;
}

const systemClock: Clock = {
  nowMilliseconds: () => Date.now(),
};

export interface SlidingWindowRateLimiterConfig {
  databasePath: string;
  limitTokens?: number;
  windowMilliseconds?: number;
  clock?: Clock;
}

export interface RateLimitDecision {
  allowed: boolean;
  limitTokens: number;
  remainingTokens: number;
  requestedTokens: number;
  usedTokens: number;
  retryAfterMilliseconds?: number;
}

interface UsageTotalRow {
  used_tokens: number | null;
}

interface UsageEventRow {
  occurred_at_ms: number;
  tokens: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }

  return value;
}

function tenantKeyHash(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

/**
 * Persistent token-aware sliding-window limiter.
 *
 * BEGIN IMMEDIATE makes eviction, summation, admission, and insertion one
 * atomic decision even when several gateway processes share the database.
 */
export class SqliteSlidingWindowRateLimiter {
  private readonly database: DatabaseSync;
  private readonly deleteExpiredStatement: StatementSync;
  private readonly usageTotalStatement: StatementSync;
  private readonly usageEventsStatement: StatementSync;
  private readonly insertUsageStatement: StatementSync;
  private readonly limitTokens: number;
  private readonly windowMilliseconds: number;
  private readonly clock: Clock;
  private closed = false;

  public constructor(config: SlidingWindowRateLimiterConfig) {
    if (config.databasePath.length === 0) {
      throw new Error("databasePath must not be empty");
    }

    this.limitTokens = positiveInteger(
      config.limitTokens ?? DEFAULT_TOKEN_LIMIT,
      "limitTokens",
    );
    this.windowMilliseconds = positiveInteger(
      config.windowMilliseconds ?? DEFAULT_WINDOW_MILLISECONDS,
      "windowMilliseconds",
    );
    this.clock = config.clock ?? systemClock;

    if (config.databasePath !== ":memory:") {
      mkdirSync(dirname(resolve(config.databasePath)), { recursive: true });
    }

    this.database = new DatabaseSync(config.databasePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS token_usage_events (
        id INTEGER PRIMARY KEY,
        tenant_key_hash TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        tokens INTEGER NOT NULL CHECK (tokens > 0)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS idx_token_usage_tenant_time
        ON token_usage_events (tenant_key_hash, occurred_at_ms);

      PRAGMA user_version = 1;
    `);

    this.deleteExpiredStatement = this.database.prepare(
      "DELETE FROM token_usage_events WHERE occurred_at_ms <= ?",
    );
    this.usageTotalStatement = this.database.prepare(`
      SELECT COALESCE(SUM(tokens), 0) AS used_tokens
      FROM token_usage_events
      WHERE tenant_key_hash = ? AND occurred_at_ms > ?
    `);
    this.usageEventsStatement = this.database.prepare(`
      SELECT occurred_at_ms, tokens
      FROM token_usage_events
      WHERE tenant_key_hash = ? AND occurred_at_ms > ?
      ORDER BY occurred_at_ms ASC, id ASC
    `);
    this.insertUsageStatement = this.database.prepare(`
      INSERT INTO token_usage_events (tenant_key_hash, occurred_at_ms, tokens)
      VALUES (?, ?, ?)
    `);
  }

  public tryConsume(
    apiKey: string,
    requestedTokens: number,
  ): RateLimitDecision {
    if (this.closed) {
      throw new Error("Rate limiter is closed");
    }

    if (apiKey.length === 0) {
      throw new Error("apiKey must not be empty");
    }

    positiveInteger(requestedTokens, "requestedTokens");
    const now = Math.floor(this.clock.nowMilliseconds());
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error("Clock returned an invalid timestamp");
    }

    const cutoff = now - this.windowMilliseconds;
    const keyHash = tenantKeyHash(apiKey);
    let transactionOpen = false;

    try {
      this.database.exec("BEGIN IMMEDIATE");
      transactionOpen = true;

      // Global eviction keeps disk use bounded rather than cleaning only the
      // tenant making the current request.
      this.deleteExpiredStatement.run(cutoff);

      const totalRow = this.usageTotalStatement.get(
        keyHash,
        cutoff,
      ) as unknown as UsageTotalRow;
      const usedTokens = totalRow.used_tokens ?? 0;
      const proposedTotal = usedTokens + requestedTokens;

      if (proposedTotal > this.limitTokens) {
        const retryAfterMilliseconds = this.calculateRetryAfter(
          keyHash,
          cutoff,
          now,
          proposedTotal - this.limitTokens,
        );

        this.database.exec("COMMIT");
        transactionOpen = false;
        return {
          allowed: false,
          limitTokens: this.limitTokens,
          remainingTokens: Math.max(0, this.limitTokens - usedTokens),
          requestedTokens,
          usedTokens,
          retryAfterMilliseconds,
        };
      }

      this.insertUsageStatement.run(keyHash, now, requestedTokens);
      this.database.exec("COMMIT");
      transactionOpen = false;

      return {
        allowed: true,
        limitTokens: this.limitTokens,
        remainingTokens: this.limitTokens - proposedTotal,
        requestedTokens,
        usedTokens: proposedTotal,
      };
    } catch (error) {
      if (transactionOpen) {
        try {
          this.database.exec("ROLLBACK");
        } catch {
          // Preserve the original database error.
        }
      }

      throw error;
    }
  }

  private calculateRetryAfter(
    keyHash: string,
    cutoff: number,
    now: number,
    tokensThatMustExpire: number,
  ): number {
    const events = this.usageEventsStatement.all(
      keyHash,
      cutoff,
    ) as unknown as UsageEventRow[];
    let expiringTokens = 0;

    for (const event of events) {
      expiringTokens += event.tokens;
      if (expiringTokens >= tokensThatMustExpire) {
        return Math.max(
          1,
          event.occurred_at_ms + this.windowMilliseconds - now,
        );
      }
    }

    // A single request larger than the entire limit cannot fit even after all
    // current events expire, but a bounded Retry-After is still useful.
    return this.windowMilliseconds;
  }

  public close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }
}
