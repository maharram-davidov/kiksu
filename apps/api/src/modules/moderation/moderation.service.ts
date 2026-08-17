import { Injectable, Logger } from "@nestjs/common";
import type postgres from "postgres";
import { runRules, worstSeverity, type RuleHit } from "./rules";

/**
 * The moderation pipeline, tier 1 and the seam for tier 2.
 *
 * Called at write time from post, comment and review creation, INSIDE the same
 * transaction as the insert. That placement is deliberate: classifying
 * afterwards leaves a window where harmful content is fully visible, and the
 * whole point of an automated tier is to shrink that window to zero for the
 * things it can be certain about.
 *
 * TIER 2 (an LLM pass for tone and context) is not implemented. The interface
 * is here and `classify` already returns a shape that accommodates it, but
 * calling a model per write needs a key, a budget and a latency decision that
 * have not been made. The gap is recorded in the README rather than papered
 * over with a stub that silently approves everything — a moderation layer that
 * fails open is worse than one that is honestly absent.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  /**
   * Classifies content and, if the rules fire, opens a case in the same
   * transaction as the content insert.
   *
   * Returns the moderation_state the caller should write. Severity 5 hits —
   * a phone number, an email, a student ID — are limited IMMEDIATELY rather
   * than waiting for three strangers to notice. Those are not judgement calls
   * and the damage is done the moment the post is readable.
   */
  async classifyOnWrite(
    tx: postgres.TransactionSql,
    input: {
      targetType: "post" | "comment" | "review";
      targetId: string;
      universityId: string;
      title?: string | null;
      body?: string | null;
    },
  ): Promise<"visible" | "limited"> {
    const hits = runRules([input.title, input.body].filter(Boolean).join("\n"));
    if (hits.length === 0) return "visible";

    const severity = worstSeverity(hits) ?? 1;
    const limit = severity >= 5;

    await this.openCase(tx, input, hits, severity);

    if (limit) {
      this.logger.warn(
        `automod limited ${input.targetType} ${input.targetId}: ` +
          hits.map((h) => h.rule).join(", "),
      );
    }
    return limit ? "limited" : "visible";
  }

  private async openCase(
    tx: postgres.TransactionSql,
    input: { targetType: string; targetId: string; universityId: string },
    hits: RuleHit[],
    severity: number,
  ): Promise<void> {
    // Notes only, never the matched text. A queue row that quotes the phone
    // number it found has copied the personal information into a second place.
    const note = hits.map((h) => `${h.rule}: ${h.note}`).join(" ");

    await tx`
      insert into moderation.mod_case
        (subject_type, subject_id, university_id, opened_by, state, severity,
         report_count, resolution_note)
      values (${input.targetType}::public.report_target_type, ${input.targetId}::uuid,
              ${input.universityId}, 'automod', 'open', ${severity}, 0, ${note})
      on conflict do nothing
    `;
  }
}
