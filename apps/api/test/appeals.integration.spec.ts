import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { AppealsService } from "../src/modules/moderation/appeals.service";
import { ModerationService } from "../src/modules/moderation/moderation.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("appeals (integration)", () => {
  let sql: postgres.Sql;
  let appeals: AppealsService;
  let moderation: ModerationService;
  let uniId: string;
  let boardId: string;

  function db() {
    return {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
  }

  async function makeUser(handle: string): Promise<KiksuRequestContext> {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const [u] = await sql`
      insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
      values (${au!.id}, ${handle}, ${uniId}, 'email_verified', 'active') returning id`;
    return {
      authUserId: au!.id as string, appUserId: u!.id as string, tier: "email",
      role: "student", univId: uniId, epoch: 1, sid: "t",
    };
  }

  /**
   * Writes a post carrying a severity-5 pattern, through the same
   * classify-on-write path the forum uses, so the action under test is the one
   * automod actually produces rather than a hand-written row.
   */
  async function limitedPost(author: KiksuRequestContext, title: string): Promise<string> {
    return sql.begin(async (tx) => {
      // Alias-mode, matching how ForumService writes one: post_alias_shape_ck
      // requires author_alias_number set and author_app_user_id null for
      // anonymous posts, which is invariant 8 expressed as a constraint.
      const [p] = await tx<Array<{ id: string }>>`
        insert into public.post (board_id, university_id, title, body, moderation_state,
                                 author_display_mode, author_alias_number, author_tier)
        values (${boardId}, ${uniId}, ${title}, 'Zəng et: 0501234567', 'visible',
                'alias', 1, 'email_verified')
        returning id`;
      await tx`insert into internal.post_author (post_id, app_user_id)
               values (${p!.id}, ${author.appUserId})`;
      const state = await moderation.classifyOnWrite(tx, {
        targetType: "post", targetId: p!.id, universityId: uniId,
        title, body: "Zəng et: 0501234567",
      });
      await tx`update public.post set moderation_state = ${state}::public.moderation_state
                where id = ${p!.id}`;
      return p!.id;
    }) as Promise<string>;
  }

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    appeals = new AppealsService(db() as never);
    moderation = new ModerationService();
    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    uniId = uni!.id as string;
    const [b] = await sql`select id from public.board where university_id = ${uniId} limit 1`;
    boardId = b!.id as string;
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  // -------------------------------------------------------------------
  // The gap this work exists to close
  // -------------------------------------------------------------------

  it("records an action when automod limits, so there is something to appeal", async () => {
    // THE WHOLE POINT. moderation.appeal.action_id is NOT NULL, so an appeal
    // can only contest a recorded action. Automod opened a case and returned
    // 'limited' without writing one — content limited by a regex had,
    // structurally, no route to argue with it.
    const author = await makeUser(`etiraz-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Kitab satıram");

    const [action] = await sql<Array<{ kind: string; actor_staff_id: string | null }>>`
      select kind::text, actor_staff_id from moderation.action
       where target_id = ${postId}`;

    expect(action, "automod must record an action").toBeDefined();
    expect(action!.kind).toBe("limit");
    // Null because no person decided this — the honest value.
    expect(action!.actor_staff_id).toBeNull();
  });

  it("does not record an action when nothing is limited", async () => {
    // A severity below the threshold changes nothing a student can see, so an
    // "action" for it would put a decision in their history that never
    // happened.
    const author = await makeUser(`temiz-${Math.random().toString(36).slice(2, 8)}`);
    const clean = await sql.begin(async (tx) => {
      const [p] = await tx<Array<{ id: string }>>`
        insert into public.post (board_id, university_id, title, body, moderation_state,
                                 author_display_mode, author_alias_number, author_tier)
        values (${boardId}, ${uniId}, 'Adi post', 'Sabah dərs var?', 'visible',
                'alias', 1, 'email_verified') returning id`;
      await tx`insert into internal.post_author (post_id, app_user_id)
               values (${p!.id}, ${author.appUserId})`;
      await moderation.classifyOnWrite(tx, {
        targetType: "post", targetId: p!.id, universityId: uniId,
        title: "Adi post", body: "Sabah dərs var?",
      });
      return p!.id;
    });

    const rows = await sql`select 1 from moderation.action where target_id = ${clean}`;
    expect(rows.length).toBe(0);
  });

  // -------------------------------------------------------------------
  // Seeing your own history
  // -------------------------------------------------------------------

  it("shows the author what was done to their content", async () => {
    const author = await makeUser(`gormek-${Math.random().toString(36).slice(2, 8)}`);
    await limitedPost(author, "Telefonlu elan");

    const mine = await appeals.listMine(author);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]!.kind).toBe("limit");
    expect(mine[0]!.content_state).toBe("limited");
    expect(mine[0]!.can_appeal).toBe(true);
  });

  it("never names the moderator, the reporter, or another case", async () => {
    // The mirror image of T4: moderators may not see the author, and the
    // author may not see the moderator. Staff are drawn from the same small
    // campuses as the students they moderate.
    const author = await makeUser(`gizli-${Math.random().toString(36).slice(2, 8)}`);
    await limitedPost(author, "Yenə telefon");

    for (const row of await appeals.listMine(author)) {
      for (const forbidden of [
        "actor_staff_id", "decided_by", "staff", "moderator",
        "reporter_id", "report_count", "case_id",
      ]) {
        expect(row, `must not carry ${forbidden}`).not.toHaveProperty(forbidden);
      }
    }
  });

  it("shows one author nothing about another author's content", async () => {
    const mine = await makeUser(`mene-${Math.random().toString(36).slice(2, 8)}`);
    const theirs = await makeUser(`ona-${Math.random().toString(36).slice(2, 8)}`);
    const theirPost = await limitedPost(theirs, "Başqasının elanı");

    const rows = await appeals.listMine(mine);
    expect(rows.some((r) => r.excerpt === "Başqasının elanı")).toBe(false);
    const [theirAction] = await sql`select id from moderation.action where target_id = ${theirPost}`;
    expect(rows.some((r) => r.action_id === theirAction!.id)).toBe(false);
  });

  // -------------------------------------------------------------------
  // Filing
  // -------------------------------------------------------------------

  it("lets the author contest the decision", async () => {
    const author = await makeUser(`yazan-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Etiraz edəcəyəm");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;

    const filed = await appeals.create(author, {
      actionId: action!.id, body: "Bu nömrə mənim deyil, kitabın üzərindəki ISBN-dir.",
    });
    expect(filed.state).toBe("open");
  });

  it("answers not_found for someone else's action, never forbidden", async () => {
    // Whether a given action exists is not something to confirm to someone
    // guessing ids.
    const author = await makeUser(`sahib-${Math.random().toString(36).slice(2, 8)}`);
    const stranger = await makeUser(`yad-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Mənim elanım");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;

    await expect(
      appeals.create(stranger, { actionId: action!.id, body: "Bu mənim postumdur, açın." }),
    ).rejects.toThrow(/not_found|case_not_found/i);
  });

  it("refuses a second appeal on the same decision", async () => {
    const author = await makeUser(`ikinci-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Bir dəfə");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;

    await appeals.create(author, { actionId: action!.id, body: "Birinci etirazım budur." });
    // The specific code, not just "it threw". A stock Nest exception would be
    // flattened to malformed_request by the filter, leaving the screen unable
    // to tell "already appealed" from "bad request".
    await expect(
      appeals.create(author, { actionId: action!.id, body: "İkinci dəfə yazıram." }),
    ).rejects.toThrow(expect.objectContaining({ code: "appeal_already_filed" }) as never);
  });

  // -------------------------------------------------------------------
  // Deciding
  // -------------------------------------------------------------------

  async function makeStaff(): Promise<string> {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const [s] = await sql`
      insert into moderation.staff (auth_user_id, display_name, role, is_active)
      values (${au!.id}, 'Appeal Staff', 'moderator', true) returning id`;
    return s!.id as string;
  }

  it("restores the content when an appeal is overturned", async () => {
    // An appeal that succeeds on paper and leaves the post hidden is worse
    // than no appeal, because the student is told they won and can see that
    // nothing changed.
    const author = await makeUser(`qalib-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Bərpa olunacaq");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;
    const filed = await appeals.create(author, {
      actionId: action!.id, body: "Səhv aşkarlanıb, izah edirəm.",
    });

    const result = await appeals.decide(filed.id, await makeStaff(), "overturned", "Klassifikator səhv etdi.");

    expect(result.content_restored).toBe(true);
    const [post] = await sql<Array<{ moderation_state: string }>>`
      select moderation_state::text from public.post where id = ${postId}`;
    expect(post!.moderation_state).toBe("visible");
  });

  it("closes the case and records the restore as its own action", async () => {
    // The audit trail should read as a sequence of decisions, not end at the
    // one that was reversed.
    const author = await makeUser(`iz-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "İz qalsın");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;
    const filed = await appeals.create(author, { actionId: action!.id, body: "Etiraz edirəm, səbəbi budur." });

    await appeals.decide(filed.id, await makeStaff(), "overturned");

    const kinds = await sql<Array<{ kind: string }>>`
      select kind::text from moderation.action where target_id = ${postId} order by created_at`;
    expect(kinds.map((k) => k.kind)).toEqual(["limit", "restore_content"]);

    const [c] = await sql<Array<{ state: string }>>`
      select state::text from moderation.mod_case where subject_id = ${postId}`;
    expect(c!.state).toBe("dismissed");
  });

  it("leaves the content alone when an appeal is upheld", async () => {
    const author = await makeUser(`uduzan-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Qalacaq");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;
    const filed = await appeals.create(author, { actionId: action!.id, body: "Yenə də etiraz edirəm." });

    const result = await appeals.decide(filed.id, await makeStaff(), "upheld", "Nömrə həqiqətən şəxsidir.");

    expect(result.content_restored).toBe(false);
    const [post] = await sql<Array<{ moderation_state: string }>>`
      select moderation_state::text from public.post where id = ${postId}`;
    expect(post!.moderation_state).toBe("limited");
  });

  it("shows the decision back to the author", async () => {
    const author = await makeUser(`cavab-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Cavab gözləyirəm");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;
    const filed = await appeals.create(author, { actionId: action!.id, body: "Səbəbimi izah edirəm." });
    await appeals.decide(filed.id, await makeStaff(), "upheld", "Qərar dəyişmir.");

    const row = (await appeals.listMine(author)).find((r) => r.action_id === action!.id);
    expect(row!.appeal_state).toBe("upheld");
    expect(row!.appeal_decision_note).toBe("Qərar dəyişmir.");
    // Already decided — nothing left to file.
    expect(row!.can_appeal).toBe(false);
  });

  it("refuses to decide an appeal twice", async () => {
    const author = await makeUser(`tek-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Bir qərar");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;
    const filed = await appeals.create(author, { actionId: action!.id, body: "Etirazımı yazıram." });
    const staff = await makeStaff();

    await appeals.decide(filed.id, staff, "upheld");
    await expect(appeals.decide(filed.id, staff, "overturned")).rejects.toThrow();
  });

  it("puts an open appeal in the staff queue and takes it out once decided", async () => {
    const author = await makeUser(`novbe-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Növbədə");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;
    const filed = await appeals.create(author, { actionId: action!.id, body: "Növbəyə düşməlidir." });

    expect((await appeals.queue()).some((a) => a.appeal_id === filed.id)).toBe(true);

    await appeals.decide(filed.id, await makeStaff(), "upheld");
    expect((await appeals.queue()).some((a) => a.appeal_id === filed.id)).toBe(false);
  });

  it("tells staff the decision was the machine's", async () => {
    // It changes how an appeal should be read: a classifier hit is a rule
    // firing, not a person's judgement, and is far likelier to be wrong in a
    // way the student can explain.
    const author = await makeUser(`makina-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Avtomatik");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;
    const filed = await appeals.create(author, { actionId: action!.id, body: "Avtomatik qərara etiraz." });

    const item = (await appeals.queue()).find((a) => a.appeal_id === filed.id);
    expect(item!.decided_by_machine).toBe(true);
    expect(item!.action_kind).toBe("limit");
  });

  it("carries no author into the staff appeal queue", async () => {
    const author = await makeUser(`anonim-${Math.random().toString(36).slice(2, 8)}`);
    const postId = await limitedPost(author, "Kim olduğum bilinməsin");
    const [action] = await sql`select id from moderation.action where target_id = ${postId}`;
    await appeals.create(author, { actionId: action!.id, body: "Etiraz mətnim budur." });

    for (const item of await appeals.queue()) {
      for (const forbidden of ["app_user_id", "handle", "author", "karma", "university_id"]) {
        expect(item, `appeal queue must not carry ${forbidden}`).not.toHaveProperty(forbidden);
      }
    }
  });
});
