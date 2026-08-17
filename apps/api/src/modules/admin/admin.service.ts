import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { IdentitySqlProvider } from "../../common/db/identity-sql.provider";
import { SqlProvider } from "../../common/db/sql.provider";
import { generateHandle } from "../onboarding/handle-generator";

export interface QueueCaseDto {
  attempt_id: string;
  university_code: string;
  method: string;
  state: string;
  evidence_path: string | null;
  submitted_at: string;
  sla_due_at: string | null;
  /** Negative once the SLA has been missed. The queue sorts by this. */
  minutes_to_sla: number | null;
}

export interface ModerationCaseDto {
  case_id: string;
  subject_type: string;
  subject_id: string;
  state: string;
  severity: number | null;
  report_count: number;
  opened_at: string;
  /** The reported text, so a moderator can decide without a second lookup. */
  excerpt: string | null;
  reasons: string[];
}

/**
 * The two staff queues.
 *
 * Both are deliberately thin: they list, they decide, they log. Anything
 * cleverer — auto-approval, bulk actions, heuristics that pre-judge — belongs
 * behind a human until there is evidence about what the queue actually looks
 * like in practice.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: SqlProvider,
    private readonly identity: IdentitySqlProvider,
  ) {}

  /**
   * Card cases awaiting a decision, most urgent first.
   *
   * Sorted by SLA deadline rather than submission time. Those usually agree,
   * but when they diverge the deadline is what the app promised a student, and
   * that is what the queue should chase.
   */
  async verificationQueue(universityScope: string | null): Promise<QueueCaseDto[]> {
    return this.identity.sql<QueueCaseDto[]>`
      select va.id                    as attempt_id,
             u.code                   as university_code,
             va.method::text          as method,
             va.state::text           as state,
             va.evidence_path,
             va.created_at            as submitted_at,
             va.sla_due_at,
             case when va.sla_due_at is null then null
                  else (extract(epoch from (va.sla_due_at - now())) / 60)::int end as minutes_to_sla
        from identity.verification_attempt va
        join ref.university u on u.id = va.university_id
       where va.state = 'in_review'
         and (${universityScope}::uuid is null or va.university_id = ${universityScope}::uuid)
       order by va.sla_due_at nulls last
       limit 100
    `;
  }

  /**
   * Approves or rejects a card, and on approval provisions the pseudonym.
   *
   * Approval is where Layer 1 and Layer 2 finally meet, and it is the only
   * place in the product where a human is looking at an identity document. The
   * evidence path is cleared on decision so the sweeper can delete the file:
   * a decided case has no further use for the image, and keeping it is pure
   * downside.
   */
  async decideVerification(
    attemptId: string, staffId: string, approve: boolean, reasonCode?: string,
  ): Promise<{ state: string; handle: string | null }> {
    const decided = await this.identity.transaction(async (tx) => {
      const [attempt] = await tx<Array<{
        id: string; subject_id: string; university_id: string; state: string;
      }>>`
        select id, subject_id, university_id, state::text
          from identity.verification_attempt
         where id = ${attemptId} and state = 'in_review'
         for update
      `;
      if (!attempt) throw new NotFoundException("case_not_found");

      await tx`
        update identity.verification_attempt
           set state = ${approve ? "verified" : "rejected"}::identity.verification_state,
               decision = ${approve ? "approved" : "rejected"},
               reject_reason_code = ${approve ? null : (reasonCode ?? "unreadable")},
               decided_at = now(),
               decided_by_staff_id = ${staffId},
               -- Clear the pointer on decision. The image has served its only
               -- purpose and the sweeper deletes it from here.
               evidence_path = null,
               updated_at = now()
         where id = ${attempt.id}
      `;

      if (!approve) return null;

      const [link] = await tx<Array<{ app_user_id: string }>>`
        select app_user_id from identity.app_user_link where subject_id = ${attempt.subject_id}`;
      return { subjectId: attempt.subject_id, universityId: attempt.university_id, existing: link?.app_user_id ?? null };
    });

    if (!decided) return { state: "rejected", handle: null };

    // A student who already has a pseudonym keeps it — approving their card
    // upgrades the tier, it does not mint them a second identity.
    if (decided.existing) {
      const [row] = await this.db.sql<Array<{ handle: string }>>`
        update public.app_user set verification_tier = 'card_verified'
         where id = ${decided.existing}
        returning handle`;
      return { state: "verified", handle: row?.handle ?? null };
    }

    const handle = await generateHandle(async (candidate) => {
      const [taken] = await this.db.sql`select 1 from public.app_user where handle = ${candidate} limit 1`;
      return Boolean(taken);
    });

    const [authRow] = await this.identity.sql<Array<{ auth_user_id: string }>>`
      select encode(subject_key, 'hex') as auth_user_id from identity.subject where id = ${decided.subjectId}`;
    if (!authRow) throw new BadRequestException("provisioning_failed");

    // The card route's subject key is derived from the auth subject, so a
    // fresh auth.users row is needed to hang the app_user off. In production
    // this is the Supabase user the client already holds.
    const [au] = await this.db.sql<Array<{ id: string }>>`
      insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const [appUser] = await this.db.sql<Array<{ id: string; handle: string }>>`
      insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
      values (${au!.id}, ${handle}, ${decided.universityId}, 'card_verified', 'active')
      returning id, handle`;
    if (!appUser) throw new BadRequestException("provisioning_failed");

    await this.identity.sql`
      insert into identity.app_user_link (subject_id, app_user_id)
      values (${decided.subjectId}, ${appUser.id})
      on conflict do nothing`;

    return { state: "verified", handle: appUser.handle };
  }

  /** Reported content awaiting triage, most-reported first. */
  async moderationQueue(universityScope: string | null): Promise<ModerationCaseDto[]> {
    const rows = await this.db.sql<Array<Record<string, unknown>>>`
      select mc.id as case_id, mc.subject_type::text as subject_type, mc.subject_id,
             mc.state::text as state, mc.severity, mc.report_count, mc.opened_at,
             coalesce(
               (select left(p.title, 160) from public.post p where p.id = mc.subject_id),
               (select left(c.body, 160) from public.post_comment c where c.id = mc.subject_id),
               (select left(r.body, 160) from public.review r where r.id = mc.subject_id)
             ) as excerpt,
             coalesce(
               (select array_agg(distinct rp.reason_key) from public.report rp where rp.case_id = mc.id),
               '{}'
             ) as reasons
        from moderation.mod_case mc
       where mc.state in ('open', 'triage')
         and (${universityScope}::uuid is null or mc.university_id = ${universityScope}::uuid)
       order by mc.report_count desc, mc.opened_at
       limit 100
    `;
    return rows.map((r) => ({
      case_id: r.case_id as string,
      subject_type: r.subject_type as string,
      subject_id: r.subject_id as string,
      state: r.state as string,
      severity: (r.severity as number) ?? null,
      report_count: Number(r.report_count ?? 0),
      opened_at: (r.opened_at as Date).toISOString(),
      excerpt: (r.excerpt as string) ?? null,
      reasons: (r.reasons as string[]) ?? [],
    }));
  }

  /**
   * Acts on a moderation case.
   *
   * Every decision writes a moderation.action row, including `no_action`. A
   * queue that only records removals cannot answer "was this looked at and
   * kept", which is the question a transparency report and an appeal both
   * turn on.
   */
  async decideModeration(
    caseId: string, staffId: string, kind: string, note?: string,
  ): Promise<{ state: string }> {
    return this.db.transaction(async (tx) => {
      const [c] = await tx<Array<{ id: string; subject_type: string; subject_id: string }>>`
        select id, subject_type::text as subject_type, subject_id
          from moderation.mod_case
         where id = ${caseId} and state in ('open', 'triage')
         for update`;
      if (!c) throw new NotFoundException("case_not_found");

      await tx`
        insert into moderation.action (case_id, actor_staff_id, kind, target_type, target_id, note)
        values (${caseId}, ${staffId}, ${kind}::moderation.action_kind,
                ${c.subject_type}, ${c.subject_id}, ${note ?? null})`;

      if (kind === "remove_content") {
        if (c.subject_type === "post") {
          await tx`update public.post set moderation_state = 'removed' where id = ${c.subject_id}`;
        } else if (c.subject_type === "comment") {
          await tx`update public.post_comment set moderation_state = 'removed' where id = ${c.subject_id}`;
        } else if (c.subject_type === "review") {
          await tx`update public.review set moderation_state = 'removed' where id = ${c.subject_id}`;
        }
      }

      const nextState = kind === "no_action" ? "dismissed" : "actioned";
      await tx`
        update moderation.mod_case
           set state = ${nextState}::moderation.mod_case_state,
               resolved_at = now(),
               first_response_at = coalesce(first_response_at, now())
         where id = ${caseId}`;

      return { state: nextState };
    });
  }
}
