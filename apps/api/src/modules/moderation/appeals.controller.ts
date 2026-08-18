import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { AppError } from "../../common/errors/app-error";
import { FIXED_BUCKETS } from "../../common/rate-limit/rate-limit.buckets";
import { RateLimiterService } from "../../common/rate-limit/rate-limit.service";
import { AppealsService, type MyModerationActionDto } from "./appeals.service";

const createAppeal = z.object({
  action_id: z.string().uuid(),
  /**
   * Long enough to explain, short enough to read. A moderator working a queue
   * cannot act on an essay, and a box with no ceiling invites one.
   */
  body: z.string().trim().min(10).max(1000),
});

/**
 * The student's side of moderation.
 *
 * Mounted under `/me` rather than `/moderation` because everything here is
 * about the caller's own content and their own appeals — the same reason
 * `/me` already owns the profile and privacy surfaces. There is no route here
 * for reading anyone else's anything.
 */
@Controller("me")
export class AppealsController {
  constructor(
    private readonly appeals: AppealsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  /** What has been done to my content, and whether I can still contest it. */
  @Get("moderation")
  mine(@CurrentUser() user: KiksuRequestContext): Promise<MyModerationActionDto[]> {
    return this.appeals.listMine(user);
  }

  @Post("appeals")
  @HttpCode(201)
  async create(@CurrentUser() user: KiksuRequestContext, @Body() body: unknown) {
    const b = createAppeal.parse(body);

    // Keyed on the app_user, which is the right principal here: the limit is
    // on how much staff work one person can generate, and that is a property
    // of the person, not the action.
    const bucket = FIXED_BUCKETS["moderation.appeal.daily"];
    const decision = await this.rateLimiter.consumeFixed({
      bucketName: bucket.name,
      policyName: bucket.name,
      principalKey: user.appUserId,
      limit: bucket.limit,
      windowSeconds: bucket.windowSeconds,
    });
    if (!decision.allowed) {
      throw new AppError("rate_limited", {
        details: { retry_after_seconds: decision.resetSeconds },
      });
    }

    return this.appeals.create(user, { actionId: b.action_id, body: b.body });
  }
}
