import { Injectable } from "@nestjs/common";

export interface RateLimitConsumeResult {
  count: number;
  resetAt: number; // epoch ms
}

/**
 * Storage seam for the fixed-window counters. `InMemoryRateLimitStore` is the scaffold
 * default: correct for a single process, dev, and tests — and WRONG for a
 * multi-instance production deployment, where each instance would enforce the limit
 * independently and the effective limit becomes `configured × instance_count`. Swap
 * for a Redis-backed implementation (`INCR` + `EXPIRE`, or a Lua script for atomicity)
 * before shipping — see `RATE_LIMIT_STORE` in `.env.example`.
 */
export abstract class RateLimitStore {
  /** Atomically increments the counter for `key` within a fixed window, creating it if absent or expired. */
  abstract increment(key: string, windowSeconds: number): Promise<RateLimitConsumeResult>;
}

@Injectable()
export class InMemoryRateLimitStore extends RateLimitStore {
  private readonly counters = new Map<string, RateLimitConsumeResult>();

  async increment(key: string, windowSeconds: number): Promise<RateLimitConsumeResult> {
    const now = Date.now();
    const existing = this.counters.get(key);

    if (!existing || existing.resetAt <= now) {
      const fresh: RateLimitConsumeResult = { count: 1, resetAt: now + windowSeconds * 1000 };
      this.counters.set(key, fresh);
      return fresh;
    }

    existing.count += 1;
    return existing;
  }
}
