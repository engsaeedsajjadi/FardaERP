/**
 * Rate limiting primitives. Two implementations share one interface:
 *  - MemoryRateLimiter: token bucket per key in-process (single-node / tests)
 *  - PgRateLimiter (in @seopilot/db): fixed-window counters in PostgreSQL for
 *    multi-instance deployments without Redis (spec §66: Redis only if needed).
 */
export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets / a token is available. */
  retryAfterSec: number;
}

export interface RateLimiter {
  consume(key: string, cost?: number): Promise<RateLimitDecision>;
}

export interface TokenBucketOptions {
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
}

export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { tokens: number; updatedAt: number }>();
  constructor(private readonly opts: TokenBucketOptions) {}

  async consume(key: string, cost = 1): Promise<RateLimitDecision> {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.opts.capacity, updatedAt: now };
    const elapsed = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(this.opts.capacity, b.tokens + elapsed * this.opts.refillPerSec);
    b.updatedAt = now;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      this.buckets.set(key, b);
      return { allowed: true, limit: this.opts.capacity, remaining: Math.floor(b.tokens), retryAfterSec: 0 };
    }
    this.buckets.set(key, b);
    const deficit = cost - b.tokens;
    return { allowed: false, limit: this.opts.capacity, remaining: 0, retryAfterSec: Math.ceil(deficit / this.opts.refillPerSec) };
  }

  /** Periodic cleanup to keep memory bounded. */
  prune(maxAgeMs = 10 * 60_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [k, b] of this.buckets) if (b.updatedAt < cutoff) this.buckets.delete(k);
  }
}

/** Serialise concurrent access per key with a bounded concurrency semaphore (provider concurrency limits). */
export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active++;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    return () => this.release();
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  get inflight(): number {
    return this.active;
  }
}
