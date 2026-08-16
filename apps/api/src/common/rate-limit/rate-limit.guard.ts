import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { AppError } from "../errors/app-error";
import { AccountAgeService } from "./account-age.service";
import { SCALED_BUCKETS } from "./rate-limit.buckets";
import { RATE_LIMIT_KEY } from "./rate-limit.decorator";
import { RateLimiterService } from "./rate-limit.service";
import type { RateLimitTier } from "./rate-limit.types";

/**
 * Enforces the bucket named by `@RateLimit()` on a route. A route with no
 * `@RateLimit()` metadata passes through untouched — this guard is opt-in per route,
 * not a global default, because not every endpoint needs one (bootstrap and health,
 * this scaffold's only two routes, need neither).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
    private readonly accountAge: AccountAgeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bucketName = this.reflector.getAllAndOverride<keyof typeof SCALED_BUCKETS | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!bucketName) return true;

    const config = SCALED_BUCKETS[bucketName];
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const tier = toRateLimitTier(req.kiksu?.tier);
    // Preference order per §5.2: app_user_id (signed in) > device attestation id
    // (onboarding) > IP (anonymous). This guard only runs on authenticated,
    // tier/age-scaled buckets, so app_user_id is always available here — the device-id
    // and IP fallbacks matter for the onboarding buckets, which don't go through this
    // guard (see rate-limit.buckets.ts). Never keyed by handle (§5.2).
    const principalKey = req.kiksu?.appUserId ?? req.ip ?? "unknown";
    const accountAgeMs = req.kiksu ? await this.accountAge.getAccountAgeMs(req.kiksu.appUserId) : 0;

    const decision = await this.limiter.check({
      bucketName: config.name,
      policyName: config.name.replace(/\./g, "-"),
      principalKey,
      base: config.base,
      tier,
      accountAgeMs,
      windowSeconds: config.windowSeconds,
      scalesWithAge: config.scalesWithAge,
    });

    // Headers on every rate-limited response, success or failure (§5.1). Never an
    // app_user_id, handle, device id or IP in any header value — only the policy name.
    res.setHeader("RateLimit-Policy", decision.policyHeader);
    res.setHeader("RateLimit-Limit", String(decision.limit));
    res.setHeader("RateLimit-Remaining", String(decision.remaining));
    res.setHeader("RateLimit-Reset", String(decision.resetSeconds));

    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.resetSeconds));
      throw new AppError("rate_limited");
    }

    return true;
  }
}

/**
 * `graduate` and `expired` aren't in §5.2's tier columns (only `provisional` / `email`
 * / `card`). Mapped to `email`'s limits here as the closest defined tier rather than
 * inventing a number — flagged as an open question in the README; this is a scaffold
 * default, not a product decision.
 */
function toRateLimitTier(tier: string | undefined): RateLimitTier {
  if (tier === "provisional" || tier === "email" || tier === "card") return tier;
  return "email";
}
