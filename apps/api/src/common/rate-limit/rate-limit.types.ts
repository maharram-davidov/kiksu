/** The three tiers rate limits are scaled by (§5.2). `graduate`/`expired` callers are treated as `email` for limiting purposes — flagged in the README, the doc's table doesn't cover them explicitly. */
export type RateLimitTier = "provisional" | "email" | "card";

/**
 * A "product surface" bucket: one limit, one window, scaled by tier and account age
 * per the formula in §5.2 (`effective = floor(base(tier, bucket) × age_multiplier)`,
 * minimum 1). Most of the §5.2 table fits this shape.
 */
export interface ScaledBucketConfig {
  readonly name: string;
  readonly kind: "scaled";
  readonly base: Record<RateLimitTier, number>;
  readonly windowSeconds: number;
  /**
   * `profile.handle_lookup` is the one product-surface bucket that must NOT scale —
   * "Enumeration resistance must not improve with tier or age; a card-verified
   * 3rd-year is exactly the attacker the spec models." When false, `base[tier]` is
   * used as-is regardless of account age.
   */
  readonly scalesWithAge: boolean;
}

/**
 * An onboarding bucket: fixed regardless of tier/age (§5.2: "Onboarding — fixed, not
 * tier-scaled"). Several of these are genuinely multi-window or distinct-value-based
 * (e.g. `auth.otp.send`'s "5 distinct addresses/device/day") and can't be reduced to
 * one `(limit, windowSeconds)` pair — those are documented here for the numbers but
 * are NOT wired into the generic `RateLimitGuard`; see the module doc comment.
 */
export interface FixedBucketConfig {
  readonly name: string;
  readonly kind: "fixed";
  readonly limit: number;
  readonly windowSeconds: number;
  readonly note: string;
}

export type BucketConfig = ScaledBucketConfig | FixedBucketConfig;

export interface RateLimitDecision {
  allowed: boolean;
  /** The limit that applied (post tier/age scaling for a `scaled` bucket). */
  limit: number;
  remaining: number;
  /** Seconds until the bucket resets — a delta, never an absolute time (§5.1). */
  resetSeconds: number;
  /** Named policy for the `RateLimit-Policy` header, e.g. `"forum-write";q=15;w=86400`. */
  policyHeader: string;
}
