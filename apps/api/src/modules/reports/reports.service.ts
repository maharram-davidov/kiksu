import { BadRequestException, Injectable } from "@nestjs/common";
import { SqlProvider } from "../../common/db/sql.provider";
import type { KiksuRequestContext } from "../../common/auth/request-context";

export interface ReportReasonDto {
  key: string;
  label: string;
  severity: number;
}

/**
 * Reports: the thing that fills the moderation queue.
 *
 * Until this existed the queue could only be filled by hand, so the forum was
 * effectively unmoderated no matter how good the staff tooling was.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: SqlProvider) {}

  /** Reasons applicable to a given target type, most severe first. */
  async reasonsFor(targetType: string): Promise<ReportReasonDto[]> {
    return this.db.sql<ReportReasonDto[]>`
      select key, label_az as label, severity
        from ref.report_reason
       where is_active
         and ${targetType}::public.report_target_type = any (applies_to)
       order by display_order
    `;
  }

  /**
   * Files a report.
   *
   * ALWAYS SUCCEEDS from the caller's point of view, whatever happens inside —
   * duplicate, unknown target, already-removed content. The API conventions
   * doc requires a uniform 202 here, and the reason is worth restating: a
   * response that varied would tell a reporter whether their target exists,
   * whether someone else already reported it, and whether their report
   * changed anything. Each of those is a probe.
   *
   * The one thing a caller CAN learn is that their own duplicate did not
   * double-count, and they learn it by nothing visibly happening.
   */
  async fileReport(
    user: KiksuRequestContext,
    input: { targetType: string; targetId: string; reasonKey: string; details?: string },
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [reason] = await tx<Array<{ key: string; severity: number; auto_hide_at_count: number | null }>>`
        select key, severity, auto_hide_at_count
          from ref.report_reason
         where key = ${input.reasonKey}
           and is_active
           and ${input.targetType}::public.report_target_type = any (applies_to)
      `;
      // A reason that does not apply to this target type is a client bug, not
      // a user action, so it is the one case that does surface an error.
      if (!reason) throw new BadRequestException("invalid_report_reason");

      // Resolve the target's campus and author so the case lands in the right
      // queue. Missing target: return quietly rather than confirming absence.
      const [target] = await tx<Array<{ university_id: string | null }>>`
        select case ${input.targetType}
                 when 'post' then (select p.university_id from public.post p where p.id = ${input.targetId}::uuid)
                 when 'comment' then (select p.university_id from public.post p
                                        join public.post_comment c on c.post_id = p.id
                                       where c.id = ${input.targetId}::uuid)
                 when 'review' then (select r.university_id from public.review r where r.id = ${input.targetId}::uuid)
                 when 'listing' then (select l.university_id from public.listing l where l.id = ${input.targetId}::uuid)
               end as university_id
      `;
      if (!target?.university_id) return;

      // One report per person per target. A second one is silently ignored:
      // it must not inflate report_count, because report_count drives the
      // auto-hide threshold and a single determined person could otherwise
      // hide anything.
      const [existing] = await tx<Array<{ id: string }>>`
        select id from public.report
         where reporter_id = ${user.appUserId}
           and target_type = ${input.targetType}::public.report_target_type
           and target_id = ${input.targetId}::uuid
      `;
      if (existing) return;

      // Find or open the case for this piece of content.
      const [existingCase] = await tx<Array<{ id: string; report_count: number }>>`
        select id, report_count from moderation.mod_case
         where subject_type = ${input.targetType}::public.report_target_type
           and subject_id = ${input.targetId}::uuid
           and state in ('open', 'triage')
         for update
      `;

      let caseId: string;
      let count: number;
      if (existingCase) {
        caseId = existingCase.id;
        count = existingCase.report_count + 1;
        await tx`
          update moderation.mod_case
             set report_count = ${count},
                 -- A case keeps the HIGHEST severity anything has been
                 -- reported for. A spam report on top of a harassment report
                 -- must not demote it down the queue.
                 severity = greatest(severity, ${reason.severity})
           where id = ${caseId}
        `;
      } else {
        count = 1;
        const [created] = await tx<Array<{ id: string }>>`
          insert into moderation.mod_case
            (subject_type, subject_id, university_id, opened_by, state, severity, report_count)
          values (${input.targetType}::public.report_target_type, ${input.targetId}::uuid,
                  ${target.university_id}, 'report', 'open', ${reason.severity}, 1)
          returning id
        `;
        if (!created) return;
        caseId = created.id;
      }

      await tx`
        insert into public.report (reporter_id, target_type, target_id, reason_key, details, case_id)
        values (${user.appUserId}, ${input.targetType}::public.report_target_type,
                ${input.targetId}::uuid, ${reason.key}, ${input.details ?? null}, ${caseId})
      `;

      // Auto-limit once enough DISTINCT people have reported. This is the only
      // protection between a report and a moderator, and it deliberately
      // limits rather than removes: `limited` keeps the content reachable by
      // direct link and reversible in one update, so a brigade cannot use the
      // threshold as a delete button.
      if (reason.auto_hide_at_count !== null && count >= reason.auto_hide_at_count) {
        const table =
          input.targetType === "post" ? "post"
          : input.targetType === "comment" ? "post_comment"
          : input.targetType === "review" ? "review"
          : input.targetType === "listing" ? "listing"
          : null;
        if (table === "post") {
          await tx`update public.post set moderation_state = 'limited'
                    where id = ${input.targetId}::uuid and moderation_state = 'visible'`;
        } else if (table === "post_comment") {
          await tx`update public.post_comment set moderation_state = 'limited'
                    where id = ${input.targetId}::uuid and moderation_state = 'visible'`;
        } else if (table === "review") {
          await tx`update public.review set moderation_state = 'limited'
                    where id = ${input.targetId}::uuid and moderation_state = 'visible'`;
        } else if (table === "listing") {
          await tx`update public.listing set moderation_state = 'limited'
                    where id = ${input.targetId}::uuid and moderation_state = 'visible'`;
        }
      }
    });
  }
}
