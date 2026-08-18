import { Injectable, NotFoundException } from "@nestjs/common";
import { AppError } from "../../common/errors/app-error";
import { SqlProvider } from "../../common/db/sql.provider";
import type { KiksuRequestContext } from "../../common/auth/request-context";

/**
 * One thing that happened to the caller's content.
 *
 * NOTE WHAT IS ABSENT: no moderator, no reporter, no other case, no report
 * count. That is the mirror image of identity spec T4 — moderators may not see
 * the author, and the author may not see the moderator. Telling a student
 * which member of staff hid their post, on a product whose staff are drawn
 * from the same small campuses as its users, invites exactly the retaliation
 * the anonymity model exists to prevent.
 */
export interface MyModerationActionDto {
  action_id: string;
  kind: string;
  target_type: string;
  /** 'visible' | 'limited' | 'removed' — what the content looks like now. */
  content_state: string;
  excerpt: string | null;
  created_at: string;
  /** null when never appealed. */
  appeal_state: string | null;
  appeal_decided_at: string | null;
  appeal_decision_note: string | null;
  /** Whether an appeal can still be filed. */
  can_appeal: boolean;
}

export interface AppealQueueItemDto {
  appeal_id: string;
  action_id: string;
  action_kind: string;
  /** Null when automod decided it — see migration 0022. */
  decided_by_machine: boolean;
  target_type: string;
  excerpt: string | null;
  body: string;
  created_at: string;
}

/**
 * Appeals.
 *
 * `moderation.appeal` has existed since migration 0012 and nothing has ever
 * written it — the gap in the product's own words was "content can be
 * auto-limited with no way to contest it".
 *
 * The three things worth knowing about the shape here:
 *
 * 1. AN APPEAL CONTESTS AN ACTION, not a piece of content. That is the
 *    schema's own choice (`appeal.action_id` is NOT NULL) and it is the right
 *    one: it means the record says which decision is being argued with, so an
 *    overturn is unambiguous even when several things happened to one post.
 *
 * 2. OWNERSHIP IS RESOLVED THROUGH THE AUTHORSHIP TABLES, server-side. There
 *    is no author column on public.post — that is invariant 8 — so this walks
 *    internal.post_author / comment_author / review_author, which is the same
 *    legitimate own-row read ReviewsService.access() makes.
 *
 * 3. OVERTURNING RESTORES THE CONTENT. An appeal that succeeds on paper and
 *    leaves the post hidden is worse than no appeal, because the student is
 *    told they won and can see that nothing changed.
 */
@Injectable()
export class AppealsService {
  constructor(private readonly db: SqlProvider) {}

  /**
   * What has been done to the caller's content.
   *
   * Only the kinds a student can actually see the effect of. `no_action` and
   * `escalate_legal` are deliberately excluded: the first is a moderator
   * deciding nothing was wrong, and surfacing it would tell someone they were
   * reported when the outcome was that they did nothing wrong — an anxiety
   * with no remedy attached. The second is a live legal matter and not
   * something to announce in an app.
   */
  async listMine(user: KiksuRequestContext): Promise<MyModerationActionDto[]> {
    const rows = await this.db.sql<Array<Record<string, unknown>>>`
      with mine as (
        select 'post'::text as target_type, pa.post_id as target_id
          from internal.post_author pa where pa.app_user_id = ${user.appUserId}
        union all
        select 'comment', ca.comment_id
          from internal.comment_author ca where ca.app_user_id = ${user.appUserId}
        union all
        select 'review', ra.review_id
          from internal.review_author ra where ra.app_user_id = ${user.appUserId}
      )
      select a.id as action_id,
             a.kind::text as kind,
             a.target_type::text as target_type,
             a.created_at,
             coalesce(
               (select p.moderation_state::text from public.post p where p.id = a.target_id),
               (select c.moderation_state::text from public.post_comment c where c.id = a.target_id),
               (select r.moderation_state::text from public.review r where r.id = a.target_id)
             ) as content_state,
             coalesce(
               (select left(p.title, 160) from public.post p where p.id = a.target_id),
               (select left(c.body, 160) from public.post_comment c where c.id = a.target_id),
               (select left(r.body, 160) from public.review r where r.id = a.target_id)
             ) as excerpt,
             ap.state as appeal_state,
             ap.decided_at as appeal_decided_at,
             ap.decision_note as appeal_decision_note
        from moderation.action a
        join mine m on m.target_type = a.target_type::text and m.target_id = a.target_id
        left join moderation.appeal ap
               on ap.action_id = a.id and ap.app_user_id = ${user.appUserId}
       where a.kind not in ('no_action', 'escalate_legal', 'restore_content')
       order by a.created_at desc
       limit 100
    `;

    return rows.map((r) => ({
      action_id: r.action_id as string,
      kind: r.kind as string,
      target_type: r.target_type as string,
      content_state: (r.content_state as string) ?? "removed",
      excerpt: (r.excerpt as string) ?? null,
      created_at: (r.created_at as Date).toISOString(),
      appeal_state: (r.appeal_state as string) ?? null,
      appeal_decided_at: r.appeal_decided_at ? (r.appeal_decided_at as Date).toISOString() : null,
      appeal_decision_note: (r.appeal_decision_note as string) ?? null,
      // One appeal per action, by the unique constraint. Nothing to contest
      // once the content is already visible again.
      can_appeal: !r.appeal_state && (r.content_state as string) !== "visible",
    }));
  }

  /**
   * Files an appeal.
   *
   * A caller passing an action id that is not theirs gets `not_found`, never
   * `forbidden`: whether a given action exists is not something to confirm to
   * someone guessing ids.
   */
  async create(
    user: KiksuRequestContext,
    input: { actionId: string; body: string },
  ): Promise<{ id: string; state: string }> {
    return this.db.transaction(async (tx) => {
      const [owned] = await tx<Array<{ id: string }>>`
        select a.id
          from moderation.action a
         where a.id = ${input.actionId}
           and a.kind not in ('no_action', 'escalate_legal', 'restore_content')
           and (
             exists (select 1 from internal.post_author pa
                      where pa.post_id = a.target_id and pa.app_user_id = ${user.appUserId})
             or exists (select 1 from internal.comment_author ca
                      where ca.comment_id = a.target_id and ca.app_user_id = ${user.appUserId})
             or exists (select 1 from internal.review_author ra
                      where ra.review_id = a.target_id and ra.app_user_id = ${user.appUserId})
           )
      `;
      if (!owned) throw new NotFoundException("case_not_found");

      const [existing] = await tx<Array<{ id: string }>>`
        select id from moderation.appeal
         where action_id = ${input.actionId} and app_user_id = ${user.appUserId}
      `;
      // AppError, not BadRequestException. A stock Nest exception is flattened
      // by the filter to `malformed_request` by status — the message is never
      // passed through — so the registered code would never reach the client
      // and the screen could not tell "already appealed" from "bad request".
      // Exactly the bug just fixed on email_domain_not_recognised.
      if (existing) throw new AppError("appeal_already_filed");

      const [row] = await tx<Array<{ id: string; state: string }>>`
        insert into moderation.appeal (action_id, app_user_id, body)
        values (${input.actionId}, ${user.appUserId}, ${input.body})
        returning id, state
      `;
      if (!row) throw new AppError("internal_error");
      return { id: row.id, state: row.state };
    });
  }

  /** Open appeals, oldest first — the queue is a promise about response time. */
  async queue(): Promise<AppealQueueItemDto[]> {
    const rows = await this.db.sql<Array<Record<string, unknown>>>`
      select ap.id as appeal_id, ap.body, ap.created_at,
             a.id as action_id, a.kind::text as action_kind,
             a.actor_staff_id is null as decided_by_machine,
             a.target_type::text as target_type,
             coalesce(
               (select left(p.title, 160) from public.post p where p.id = a.target_id),
               (select left(c.body, 160) from public.post_comment c where c.id = a.target_id),
               (select left(r.body, 160) from public.review r where r.id = a.target_id)
             ) as excerpt
        from moderation.appeal ap
        join moderation.action a on a.id = ap.action_id
       where ap.state = 'open'
       order by ap.created_at
    `;

    return rows.map((r) => ({
      appeal_id: r.appeal_id as string,
      action_id: r.action_id as string,
      action_kind: r.action_kind as string,
      decided_by_machine: r.decided_by_machine as boolean,
      target_type: r.target_type as string,
      excerpt: (r.excerpt as string) ?? null,
      body: r.body as string,
      created_at: (r.created_at as Date).toISOString(),
    }));
  }

  /**
   * Decides an appeal.
   *
   * Overturning restores the content in the SAME transaction as the decision.
   * Splitting them would allow a state where the appeal reads 'overturned' and
   * the post is still hidden — which is the one outcome worse than having no
   * appeals process, because the student is told they won and can see that
   * nothing changed.
   */
  async decide(
    appealId: string,
    staffId: string,
    outcome: "upheld" | "overturned",
    note?: string,
  ): Promise<{ state: string; content_restored: boolean }> {
    return this.db.transaction(async (tx) => {
      const [appeal] = await tx<Array<{
        id: string; action_id: string; target_type: string | null; target_id: string | null;
        case_id: string;
      }>>`
        select ap.id, ap.action_id, a.target_type::text, a.target_id, a.case_id
          from moderation.appeal ap
          join moderation.action a on a.id = ap.action_id
         where ap.id = ${appealId} and ap.state = 'open'
         for update of ap
      `;
      if (!appeal) throw new NotFoundException("case_not_found");

      await tx`
        update moderation.appeal
           set state = ${outcome}, decided_by = ${staffId},
               decided_at = now(), decision_note = ${note ?? null}
         where id = ${appealId}
      `;

      if (outcome !== "overturned") return { state: outcome, content_restored: false };

      // Restore. Which table the content lives in is not recorded anywhere but
      // target_type, so this branches rather than guessing.
      if (appeal.target_type === "post") {
        await tx`update public.post set moderation_state = 'visible' where id = ${appeal.target_id}`;
      } else if (appeal.target_type === "comment") {
        await tx`update public.post_comment set moderation_state = 'visible' where id = ${appeal.target_id}`;
      } else if (appeal.target_type === "review") {
        await tx`update public.review set moderation_state = 'visible' where id = ${appeal.target_id}`;
      }

      // A restore is also a moderation decision, so it gets its own action —
      // the audit trail should read as a sequence of decisions, not end at the
      // one that was reversed.
      await tx`
        insert into moderation.action
          (case_id, actor_staff_id, kind, target_type, target_id, note)
        values (${appeal.case_id}, ${staffId}, 'restore_content',
                ${appeal.target_type}::public.report_target_type,
                ${appeal.target_id}, 'appeal overturned')
      `;

      await tx`
        update moderation.mod_case
           set state = 'dismissed', resolved_at = now()
         where id = ${appeal.case_id}
      `;

      return { state: outcome, content_restored: true };
    });
  }
}
