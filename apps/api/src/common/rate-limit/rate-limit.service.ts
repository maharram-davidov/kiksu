import { Injectable } from "@nestjs/common";
import { effectiveLimit } from "./rate-limit.buckets";
import { RateLimitStore } from "./rate-limit.store";
import type { RateLimitDecision, RateLimitTier } from "./rate-limit.types";

/**
 * The reusable rate-limiting primitive. `check()` drives the tier/age-scaled "product
 * surface" buckets; `consumeFixed()` is the lower-level call an endpoint implementer
 * uses directly for the onboarding buckets that don't fit the generic shape (see
 * `rate-limit.buckets.ts`'s module doc).
 *
 * Headers are computed here (not just the allow/deny decision) because §5.1 requires
 * them on every rate-limited response, success or failure, and because "when several
 * buckets apply, the headers describe the scarcest remaining one" — a caller enforcing
 * more than one bucket for a single request should keep the decision with the lowest
 * `remaining` and use only that one's headers.
 */
@Injectable()
export class RateLimiterService {
  constructor(private readonly store: RateLimitStore) {}

  async check(params: {
    bucketName: string;
    policyName: string;
    principalKey: string;
    base: Record<RateLimitTier, number>;
    tier: RateLimitTier;
    accountAgeMs: number;
    windowSeconds: number;
    scalesWithAge: boolean;
  }): Promise<RateLimitDecision> {
    const limit = effectiveLimit(params.base[params.tier], params.accountAgeMs, params.scalesWithAge);

    // A 0 limit is permission, not throttling (§5.2: "provisional zeros are
    // permission... gets 403 verification_required, not 429"). The caller (a guard or
    // an endpoint) is responsible for turning a 0-limit bucket into the right 403
    // BEFORE calling here; `check` still reports it faithfully rather than guessing.
    if (limit === 0) {
      return {
        allowed: false,
        limit: 0,
        remaining: 0,
        resetSeconds: params.windowSeconds,
        policyHeader: formatPolicy(params.policyName, 0, params.windowSeconds),
      };
    }

    const key = `${params.bucketName}:${params.principalKey}`;
    const { count, resetAt } = await this.store.increment(key, params.windowSeconds);
    const remaining = Math.max(0, limit - count);
    const resetSeconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));

    return {
      allowed: count <= limit,
      limit,
      remaining,
      resetSeconds,
      policyHeader: formatPolicy(params.policyName, limit, params.windowSeconds),
    };
  }

  /** Fixed-limit variant for onboarding buckets: no tier/age scaling, caller supplies the key directly. */
  async consumeFixed(params: {
    bucketName: string;
    policyName: string;
    principalKey: string;
    limit: number;
    windowSeconds: number;
  }): Promise<RateLimitDecision> {
    const key = `${params.bucketName}:${params.principalKey}`;
    const { count, resetAt } = await this.store.increment(key, params.windowSeconds);
    const remaining = Math.max(0, params.limit - count);
    const resetSeconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));

    return {
      allowed: count <= params.limit,
      limit: params.limit,
      remaining,
      resetSeconds,
      policyHeader: formatPolicy(params.policyName, params.limit, params.windowSeconds),
    };
  }
}

/** `"forum-write";q=15;w=86400` — names the bucket, never the principal (§5.1). */
function formatPolicy(policyName: string, limit: number, windowSeconds: number): string {
  return `"${policyName}";q=${limit};w=${windowSeconds}`;
}
