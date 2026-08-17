import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { StaffGuard } from "../admin/staff.guard";
import { IngestService, type IngestResult } from "./ingest.service";

const vacancyRow = z.object({
  source_ref: z.string().min(1).max(200),
  external_url: z.string().url().max(2048),
  title: z.string().trim().min(3).max(300),
  employer_name: z.string().trim().max(200).optional(),
  description: z.string().trim().max(20_000).optional(),
  kind: z.enum(["internship", "part_time", "full_time", "volunteer", "thesis", "scholarship"]).optional(),
  work_mode: z.enum(["onsite", "hybrid", "remote"]).optional(),
  city: z.string().trim().max(120).optional(),
  is_paid: z.boolean().optional(),
  /** Minor units, like every price in the system. */
  stipend_minor: z.coerce.number().int().min(0).max(100_000_00).optional(),
  apply_deadline: z.string().datetime().optional(),
  required_skills: z.array(z.string().trim().max(60)).max(20).optional(),
});

const ingestBody = z.object({
  source: z.string().min(1).max(60),
  /** A page at a time. Bigger batches make a partial failure harder to reason about. */
  vacancies: z.array(vacancyRow).min(1).max(200),
  /**
   * Close vacancies from this source not seen in the given window. Send only
   * on the LAST page of a run — closing after page one would shut everything
   * the run has not reached yet.
   */
  close_missing_after_minutes: z.coerce.number().int().min(60).max(20_160).optional(),
});

/**
 * Staff-only ingestion for scraped vacancies.
 *
 * Behind StaffGuard rather than an API key, because a key that can write to the
 * vacancy feed is a key that can put arbitrary links in front of students, and
 * revoking staff already takes effect immediately.
 */
@Controller("admin/ingest")
@UseGuards(StaffGuard)
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Post("vacancies")
  async vacancies(@Body() body: unknown): Promise<IngestResult> {
    const b = ingestBody.parse(body);

    const result = await this.ingest.ingest(
      b.source,
      b.vacancies.map((v) => ({
        sourceRef: v.source_ref,
        externalUrl: v.external_url,
        title: v.title,
        employerName: v.employer_name,
        description: v.description,
        kind: v.kind,
        workMode: v.work_mode,
        city: v.city,
        isPaid: v.is_paid,
        stipendMinor: v.stipend_minor,
        applyDeadline: v.apply_deadline,
        requiredSkills: v.required_skills,
      })),
    );

    if (b.close_missing_after_minutes !== undefined) {
      result.closed = await this.ingest.closeMissing(b.source, b.close_missing_after_minutes);
    }
    return result;
  }
}
