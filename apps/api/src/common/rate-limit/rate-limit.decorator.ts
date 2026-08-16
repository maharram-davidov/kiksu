import { SetMetadata } from "@nestjs/common";
import type { ScaledBucketName } from "./rate-limit.buckets";

export const RATE_LIMIT_KEY = "kiksu:rateLimitBucket";

/**
 * Applies a §5.2 tier/age-scaled bucket to a route:
 * `@RateLimit("forum.post.create")`. Only covers the "scaled" bucket shape — see
 * `rate-limit.buckets.ts` for why the onboarding buckets and `forum.alias_preview`
 * need bespoke composition of `RateLimiterService` instead of this decorator.
 *
 * Requires `RateLimitGuard` to be active on the route (registered per-controller or
 * globally by whoever wires up the real endpoints — not global in this scaffold,
 * since `bootstrap`/`health` need none of the buckets here).
 */
export const RateLimit = (bucketName: ScaledBucketName): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_KEY, bucketName);
