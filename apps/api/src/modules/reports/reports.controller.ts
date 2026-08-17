import { Body, Controller, Get, HttpCode, Post, Query } from "@nestjs/common";
import { z } from "zod";
import { CurrentUser } from "../../common/auth/current-user.decorator";
import type { KiksuRequestContext } from "../../common/auth/request-context";
import { ReportsService, type ReportReasonDto } from "./reports.service";

const targetType = z.enum(["post", "comment", "review", "listing"]);

const reportBody = z.object({
  target_type: targetType,
  target_id: z.string().uuid(),
  reason_key: z.string().max(40),
  details: z.string().trim().max(1000).optional(),
});

@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("reasons")
  reasons(@Query("target_type") t: string): Promise<ReportReasonDto[]> {
    return this.reports.reasonsFor(targetType.parse(t));
  }

  /**
   * Always 202, with no body.
   *
   * The response does not vary on duplicate, unknown target, or already-hidden
   * content — a varying response would let a reporter probe for whether a
   * piece of content exists and whether anyone else has flagged it.
   */
  @Post()
  @HttpCode(202)
  async file(@CurrentUser() user: KiksuRequestContext, @Body() body: unknown): Promise<void> {
    const b = reportBody.parse(body);
    await this.reports.fileReport(user, {
      targetType: b.target_type,
      targetId: b.target_id,
      reasonKey: b.reason_key,
      details: b.details,
    });
  }
}
