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
      /** The writer, when the caller knows it — used for the shadowban check. */
      authorAppUserId?: string;
    },
  ): Promise<"visible" | "limited"> {
    // A shadowbanned author's content is limited on the way in.
    //
    // Done HERE, at write, because the author is already known at this point.
    // The alternative — filtering shadowbanned authors out of feeds — would
    // put internal.post_author into every read query in the forum, which is
    // exactly the join invariant 8 exists to prevent, for the sake of a
    // sanction that is rarely used.
    //
    // No case is opened and nothing is logged against the post: the whole
    // point of a shadowban is that the person cannot tell it happened, and a
    // moderation case they could later see in /me/moderation would tell them.
    if (input.authorAppUserId && (await this.isShadowbanned(tx, input.authorAppUserId))) {
      return "limited";
    }

    const hits = runRules([input.title, input.body].filter(Boolean).join("\n"));
    if (hits.length === 0) return "visible";

    const severity = worstSeverity(hits) ?? 1;
    const limit = severity >= 5;

    const caseId = await this.openCase(tx, input, hits, severity);

    // An action, not just a case — and this is the whole point of it.
    //
    // moderation.appeal.action_id is NOT NULL, so an appeal can only contest a
    // recorded ACTION. Human decisions have always written one; automod never
    // did, which meant content the classifier limited had, structurally,
    // nothing to appeal against. A student could be silenced by a regex with
    // no route to argue with it.
    //
    // Only written when we actually limit. A severity below the threshold
    // changes nothing a student can see, so recording an "action" for it would
    // put a decision in their history that never happened.
    if (limit && caseId) {
      await tx`
        insert into moderation.action
          (case_id, actor_staff_id, kind, target_type, target_id, note)
        values (${caseId},
                -- Null, deliberately: no person decided this. The column is
                -- nullable and null is the honest value.
                null,
                'limit'::moderation.action_kind,
                ${input.targetType}::public.report_target_type,
                ${input.targetId}::uuid,
                ${hits.map((h) => h.rule).join(", ")})
      `;
    }

    if (limit) {
      this.logger.warn(
        `automod limited ${input.targetType} ${input.targetId}: ` +
          hits.map((h) => h.rule).join(", "),
      );
    }
    return limit ? "limited" : "visible";
  }

  private async isShadowbanned(
    tx: postgres.TransactionSql,
    appUserId: string,
  ): Promise<boolean> {
    const [row] = await tx<Array<{ shadowbanned: boolean }>>`
      select status = 'shadowbanned' as shadowbanned
        from public.app_user where id = ${appUserId}
    `;
    return row?.shadowbanned ?? false;
  }

  private async openCase(
    tx: postgres.TransactionSql,
    input: { targetType: string; targetId: string; universityId: string },
    hits: RuleHit[],
    severity: number,
  ): Promise<string | null> {
    // Notes only, never the matched text. A queue row that quotes the phone
    // number it found has copied the personal information into a second place.
    const note = hits.map((h) => `${h.rule}: ${h.note}`).join(" ");

    // Returns the case id so the caller can hang an action off it. `on
    // conflict do nothing` returns no row when the case already exists — a
    // second rule firing on the same content — so the id is fetched
    // explicitly rather than assumed present.
    await tx`
      insert into moderation.mod_case
        (subject_type, subject_id, university_id, opened_by, state, severity,
         report_count, resolution_note)
      values (${input.targetType}::public.report_target_type, ${input.targetId}::uuid,
              ${input.universityId}, 'automod', 'open', ${severity}, 0, ${note})
      on conflict do nothing
    `;

    const [row] = await tx<Array<{ id: string }>>`
      select id from moderation.mod_case
       where subject_type = ${input.targetType}::public.report_target_type
         and subject_id = ${input.targetId}::uuid
    `;
    return row?.id ?? null;
  }
}
