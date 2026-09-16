import { sql } from "drizzle-orm";
import type { RateLimiter, RateLimitDecision } from "@seopilot/security";
import { getDb } from "./client";

/**
 * Fixed-window rate limiter backed by PostgreSQL (multi-instance safe, no Redis).
 * Uses a single UPSERT with RETURNING so the check-and-increment is atomic.
 */
export class PgRateLimiter implements RateLimiter {
  constructor(private readonly limit: number, private readonly windowSec: number) {}

  async consume(key: string, cost = 1): Promise<RateLimitDecision> {
    const windowMs = this.windowSec * 1000;
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
    const res = await getDb().execute<{ count: number }>(sql`
      INSERT INTO rate_limit_counters (key, window_start, count)
      VALUES (${key}, ${windowStart}, ${cost})
      ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit_counters.count + ${cost}
      RETURNING count
    `);
    const count = Number(res.rows[0]?.count ?? cost);
    const allowed = count <= this.limit;
    const resetIn = Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000);
    return { allowed, limit: this.limit, remaining: Math.max(0, this.limit - count), retryAfterSec: allowed ? 0 : resetIn };
  }

  /** Remove windows older than two periods. Called by the worker's housekeeping job. */
  static async prune(windowSec: number): Promise<void> {
    await getDb().execute(sql`DELETE FROM rate_limit_counters WHERE window_start < now() - make_interval(secs => ${windowSec * 2})`);
  }
}
