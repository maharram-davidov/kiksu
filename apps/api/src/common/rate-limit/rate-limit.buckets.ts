import type { BucketConfig } from "./rate-limit.types";

/**
 * The bucket table, verbatim from `05-api-conventions.md` §5.2.
 *
 * "The numeric values above are tunable through `ref.app_setting` without a deploy.
 * The *shape* — which buckets exist, that they scale by tier and age, that onboarding
 * buckets do not — is contract." This module is therefore the contractual shape;
 * `ref.app_setting` (not yet wired — that's a DB dependency out of this scaffold's
 * scope) should override the numeric fields at runtime without changing which keys
 * exist here.
 */
export const AGE_MULTIPLIER_BRACKETS: ReadonlyArray<{ readonly maxAgeMs: number; readonly multiplier: number }> = [
  { maxAgeMs: 24 * 60 * 60 * 1000, multiplier: 0.25 }, // < 24h
  { maxAgeMs: 7 * 24 * 60 * 60 * 1000, multiplier: 0.5 }, // 24h - 7d
  { maxAgeMs: 30 * 24 * 60 * 60 * 1000, multiplier: 0.75 }, // 7d - 30d
  { maxAgeMs: Number.POSITIVE_INFINITY, multiplier: 1.0 }, // >= 30d
];

/** `age_multiplier(account_age)` per §5.2's table. */
export function ageMultiplier(accountAgeMs: number): number {
  for (const bracket of AGE_MULTIPLIER_BRACKETS) {
    if (accountAgeMs < bracket.maxAgeMs) return bracket.multiplier;
  }
  return 1.0;
}

/** `effective = floor(base(tier, bucket) × age_multiplier(account_age))`, minimum 1 — unless base is 0 (permission, not throttling; see §5.2's note on `provisional` zeros). */
export function effectiveLimit(base: number, accountAgeMs: number, scalesWithAge: boolean): number {
  if (base === 0) return 0;
  if (!scalesWithAge) return base;
  return Math.max(1, Math.floor(base * ageMultiplier(accountAgeMs)));
}

/**
 * "Product surfaces" — single limit, single window, tier+age scaled. This is the
 * subset of §5.2 the generic `RateLimitGuard`/`@RateLimit()` decorator drives directly.
 */
export const SCALED_BUCKETS = {
  "forum.post.create": {
    name: "forum.post.create",
    kind: "scaled",
    base: { provisional: 3, email: 15, card: 25 },
    windowSeconds: 86_400,
    scalesWithAge: true,
  },
  "forum.comment.create": {
    name: "forum.comment.create",
    kind: "scaled",
    base: { provisional: 10, email: 100, card: 150 },
    windowSeconds: 86_400,
    scalesWithAge: true,
  },
  "forum.vote": {
    name: "forum.vote",
    kind: "scaled",
    // provisional: 0 is permission, not throttling (§5.2) — a provisional account
    // voting gets 403 verification_required from the endpoint, never a 429 from here.
    base: { provisional: 0, email: 300, card: 400 },
    windowSeconds: 3_600,
    scalesWithAge: true,
  },
  "reviews.create": {
    name: "reviews.create",
    kind: "scaled",
    base: { provisional: 0, email: 5, card: 5 },
    windowSeconds: 86_400,
    scalesWithAge: true,
  },
  "reports.create": {
    name: "reports.create",
    kind: "scaled",
    base: { provisional: 5, email: 20, card: 20 },
    windowSeconds: 86_400,
    scalesWithAge: true,
  },
  "profile.handle_lookup": {
    name: "profile.handle_lookup",
    kind: "scaled",
    base: { provisional: 10, email: 10, card: 10 },
    windowSeconds: 3_600,
    // Deliberately does NOT scale — see the doc comment on `scalesWithAge` in rate-limit.types.ts.
    scalesWithAge: false,
  },
  "profile.handle_change": {
    name: "profile.handle_change",
    kind: "scaled",
    base: { provisional: 0, email: 1, card: 1 },
    windowSeconds: 14 * 24 * 60 * 60, // "also a hard server rule" — enforce handle_changed_at server-side too, not only here.
    scalesWithAge: true,
  },
  "search.query": {
    name: "search.query",
    kind: "scaled",
    base: { provisional: 30, email: 120, card: 120 },
    windowSeconds: 3_600,
    scalesWithAge: true,
  },
  "timetable.freebusy": {
    name: "timetable.freebusy",
    kind: "scaled",
    base: { provisional: 0, email: 20, card: 20 },
    windowSeconds: 86_400,
    scalesWithAge: true,
  },
} as const satisfies Record<string, BucketConfig>;

export type ScaledBucketName = keyof typeof SCALED_BUCKETS;

/**
 * Onboarding buckets — fixed, not tier-scaled. Several are multi-window or
 * distinct-value-counted (noted individually) and are NOT drivable by the generic
 * single-window `RateLimitGuard`. An endpoint implementer building the verification
 * routes should call `RateLimiterService.consume()` directly, once per constraint,
 * and/or maintain a distinct-value set for the "N distinct X per device per day" shape
 * — that bookkeeping doesn't exist in this scaffold.
 */
export const FIXED_BUCKETS = {
  "auth.otp.send.cooldown": {
    name: "auth.otp.send.cooldown",
    kind: "fixed",
    limit: 1,
    windowSeconds: 60,
    note: "60 s resend cooldown per address.",
  },
  "auth.otp.send.hourly": {
    name: "auth.otp.send.hourly",
    kind: "fixed",
    limit: 3,
    windowSeconds: 3_600,
    note: "3 sends per address per hour.",
  },
  "auth.otp.send.daily": {
    name: "auth.otp.send.daily",
    kind: "fixed",
    limit: 10,
    windowSeconds: 86_400,
    note: "10 sends per address per day.",
  },
  "auth.otp.send.device_daily_addresses": {
    name: "auth.otp.send.device_daily_addresses",
    kind: "fixed",
    limit: 5,
    windowSeconds: 86_400,
    note: "5 DISTINCT addresses per device per day — a set-cardinality limit, not a counter. Needs bespoke storage.",
  },
  "moderation.appeal.daily": {
    name: "moderation.appeal.daily",
    kind: "fixed",
    limit: 5,
    windowSeconds: 86_400,
    note: "5 appeals per person per day. An unlimited appeal endpoint is a way to generate staff workload at no cost, and the queue is a promise about response time.",
  },
  "auth.otp.verify": {
    name: "auth.otp.verify",
    kind: "fixed",
    limit: 5,
    windowSeconds: 3_600, // "then burned; 60 min lockout" — the 5 is per-challenge, not per-window; model as an attempt counter on the challenge row instead.
    note: "5 attempts per challenge, then burned; 60 min lockout. Per-challenge, not a generic time window.",
  },
  "auth.invite.redeem.device": {
    name: "auth.invite.redeem.device",
    kind: "fixed",
    limit: 5,
    windowSeconds: 3_600,
    note: "5 per device per hour.",
  },
  "auth.invite.redeem.ip": {
    name: "auth.invite.redeem.ip",
    kind: "fixed",
    limit: 10,
    windowSeconds: 3_600,
    note: "10 per IP per hour. Device lockout after 10 failures in 24h is a separate mechanism.",
  },
  "auth.card.submit": {
    name: "auth.card.submit",
    kind: "fixed",
    limit: 3,
    windowSeconds: 30 * 24 * 60 * 60,
    note: "3 per 30 days, then appeal only.",
  },
} as const satisfies Record<string, BucketConfig>;

export type FixedBucketName = keyof typeof FIXED_BUCKETS;

/**
 * `forum.alias_preview` is intentionally listed separately: "1 per thread per 3 s, 30
 * total per 1 min", i.e. two simultaneous windows keyed by `(caller, thread)` AND by
 * `(caller)` alone. Same story as the onboarding buckets — bespoke composition of two
 * `RateLimiterService.consume()` calls, not a single generic bucket.
 */
export const ALIAS_PREVIEW_LIMITS = {
  perThreadWindowSeconds: 3,
  perThreadLimit: 1,
  totalWindowSeconds: 60,
  totalLimit: 30,
} as const;
