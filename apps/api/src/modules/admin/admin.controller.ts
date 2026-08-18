import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import { AdminService, type ModerationCaseDto, type QueueCaseDto } from "./admin.service";
import { EvidenceService, type EvidenceUrlDto } from "./evidence.service";
import { AppealsService, type AppealQueueItemDto } from "../moderation/appeals.service";
import { StaffGuard } from "./staff.guard";

const decideVerification = z.object({
  approve: z.boolean(),
  reason_code: z.string().max(60).optional(),
});

const decideAppeal = z.object({
  outcome: z.enum(["upheld", "overturned"]),
  note: z.string().trim().max(1000).optional(),
});

const decideModeration = z.object({
  kind: z.enum([
    "no_action", "remove_content", "restore_content",
    // `unban` has been in the action_kind enum from the start and was never
    // offered — so a suspension could be applied and never lifted.
    "warn", "mute", "suspend", "ban", "shadowban", "unban", "escalate_legal",
  ]),
  note: z.string().max(1000).optional(),
  /**
   * Hours, for mute and suspend. Omitted means the default (24h / 7d).
   * Capped at a year: a "temporary" sanction longer than that is a ban and
   * should be recorded as one, so the student is told which it is.
   */
  duration_hours: z.coerce.number().int().positive().max(24 * 365).optional(),
});

/**
 * Staff surfaces. Every route is behind {@link StaffGuard}, which looks
 * membership up per request rather than trusting a claim, so revoking a
 * moderator takes effect immediately.
 */
@Controller("admin")
@UseGuards(StaffGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly evidence: EvidenceService,
    private readonly appeals: AppealsService,
  ) {}

  @Get("verification/queue")
  verificationQueue(@Req() req: Request): Promise<QueueCaseDto[]> {
    // A campus-scoped moderator sees only their campus. A null scope is
    // platform-wide and is meant to be rare.
    return this.admin.verificationQueue(req.kiksuStaff?.universityScope ?? null);
  }

  @Post("verification/:id/decide")
  decideVerification(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ state: string; handle: string | null }> {
    const b = decideVerification.parse(body);
    return this.admin.decideVerification(id, req.kiksuStaff!.id, b.approve, b.reason_code);
  }

  /**
   * A short-lived link to one attempt's student card.
   *
   * Declared before the moderation routes purely for reading order; it belongs
   * with verification. Every call writes identity.access_log BEFORE minting —
   * see EvidenceService for why that order is not negotiable.
   */
  @Get("verification/:id/evidence")
  evidenceUrl(@Req() req: Request, @Param("id") id: string): Promise<EvidenceUrlDto> {
    return this.evidence.signedUrlFor(id, req.kiksuStaff!.id);
  }

  @Get("moderation/queue")
  moderationQueue(@Req() req: Request): Promise<ModerationCaseDto[]> {
    return this.admin.moderationQueue(req.kiksuStaff?.universityScope ?? null);
  }

  @Post("moderation/:id/decide")
  decideModeration(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ state: string; sanction_applied: boolean }> {
    const b = decideModeration.parse(body);
    return this.admin.decideModeration(id, req.kiksuStaff!.id, b.kind, b.note, b.duration_hours);
  }

  /**
   * Open appeals, oldest first. AD-03.
   *
   * No author here either, for the same reason as the moderation queue: T4(e).
   * The appeal body is the student's own words, which they chose to send to
   * staff — that is not the same as staff being handed their identity.
   */
  @Get("appeals")
  appealQueue(): Promise<AppealQueueItemDto[]> {
    return this.appeals.queue();
  }

  @Post("appeals/:id/decide")
  decideAppeal(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<{ state: string; content_restored: boolean }> {
    const b = decideAppeal.parse(body);
    return this.appeals.decide(id, req.kiksuStaff!.id, b.outcome, b.note);
  }
}
