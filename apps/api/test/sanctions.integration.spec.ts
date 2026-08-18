import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { AdminService } from "../src/modules/admin/admin.service";
import { SanctionsService } from "../src/common/sanctions/sanctions.service";
import { ModerationService } from "../src/modules/moderation/moderation.service";
import { AppealsService } from "../src/modules/moderation/appeals.service";
import { DbEpochService } from "../src/common/auth/epoch.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("account sanctions (integration)", () => {
  let sql: postgres.Sql;
  let admin: AdminService;
  let sanctions: SanctionsService;
  let moderation: ModerationService;
  let appeals: AppealsService;
  let uniId: string;
  let boardId: string;
  let staffId: string;

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

  /** A post by `author`, with a case opened on it, ready to be decided. */
  async function caseAgainst(author: KiksuRequestContext, title: string): Promise<string> {
    return sql.begin(async (tx) => {
      const [p] = await tx<Array<{ id: string }>>`
        insert into public.post (board_id, university_id, title, body, moderation_state,
                                 author_display_mode, author_alias_number, author_tier)
        values (${boardId}, ${uniId}, ${title}, 'gövdə', 'visible', 'alias', 1, 'email_verified')
        returning id`;
      await tx`insert into internal.post_author (post_id, app_user_id)
               values (${p!.id}, ${author.appUserId})`;
      const [c] = await tx<Array<{ id: string }>>`
        insert into moderation.mod_case
          (subject_type, subject_id, university_id, opened_by, state, severity, report_count)
        values ('post', ${p!.id}, ${uniId}, 'report', 'open', 3, 1)
        returning id`;
      return c!.id;
    }) as Promise<string>;
  }

  async function statusOf(user: KiksuRequestContext) {
    const [row] = await sql<Array<{ status: string; suspended_until: Date | null }>>`
      select status::text, suspended_until from public.app_user where id = ${user.appUserId}`;
    return row!;
  }

  const rnd = () => Math.random().toString(36).slice(2, 8);

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    sanctions = new SanctionsService(db() as never);
    moderation = new ModerationService();
    appeals = new AppealsService(db() as never);
    admin = new AdminService(db() as never, db() as never, new DbEpochService(db() as never));

    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    uniId = uni!.id as string;
    const [b] = await sql`select id from public.board where university_id = ${uniId} limit 1`;
    boardId = b!.id as string;
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const [s] = await sql`
      insert into moderation.staff (auth_user_id, display_name, role, is_active)
      values (${au!.id}, 'Sanction Staff', 'admin', true) returning id`;
    staffId = s!.id as string;
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  // -------------------------------------------------------------------
  // Applying
  // -------------------------------------------------------------------

  it("suspends the author of the reported content", async () => {
    const author = await makeUser(`cəza-${rnd()}`);
    const caseId = await caseAgainst(author, "Dayandırılacaq");

    const result = await admin.decideModeration(caseId, staffId, "suspend");

    expect(result.sanction_applied).toBe(true);
    const row = await statusOf(author);
    expect(row.status).toBe("suspended");
    expect(row.suspended_until).not.toBeNull();
  });

  it("defaults a suspension to seven days and a mute to a day", async () => {
    const a = await makeUser(`müddət-a-${rnd()}`);
    const b = await makeUser(`müddət-b-${rnd()}`);
    await admin.decideModeration(await caseAgainst(a, "Bir həftə"), staffId, "suspend");
    await admin.decideModeration(await caseAgainst(b, "Bir gün"), staffId, "mute");

    const hours = (d: Date | null) => (d!.getTime() - Date.now()) / 3_600_000;
    expect(hours((await statusOf(a)).suspended_until)).toBeGreaterThan(24 * 6);
    expect(hours((await statusOf(b)).suspended_until)).toBeLessThan(25);
  });

  it("honours an explicit duration", async () => {
    const author = await makeUser(`saat-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "İki saat"), staffId, "suspend", undefined, 2);

    const hours = ((await statusOf(author)).suspended_until!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(1.5);
    expect(hours).toBeLessThan(2.5);
  });

  it("bans with no expiry, which is what distinguishes it from a suspension", async () => {
    // public.app_user_status has no 'banned' value. A ban is 'suspended' with
    // a null suspended_until, and SanctionsService reads exactly that
    // difference to tell a student whether their sanction ends on a date.
    const author = await makeUser(`ban-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "Həmişəlik"), staffId, "ban");

    const row = await statusOf(author);
    expect(row.status).toBe("suspended");
    expect(row.suspended_until).toBeNull();
  });

  it("bumps the revocation epoch, so a live token stops working", async () => {
    // Without this a banned student keeps their access token for its full
    // 900s TTL — the sanction applies and does nothing for fifteen minutes.
    const author = await makeUser(`epoxa-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "Epoxa"), staffId, "ban");

    const [row] = await sql<Array<{ epoch: number; reason: string }>>`
      select epoch, reason from internal.auth_epoch where app_user_id = ${author.appUserId}`;
    expect(row!.epoch).toBeGreaterThan(1);
    expect(row!.reason).toBe("ban");
  });

  it("unbans, restoring the account and bumping again", async () => {
    // `unban` was in the action_kind enum from the start and was never
    // offered by the API, so a suspension could be applied and never lifted.
    const author = await makeUser(`geri-${rnd()}`);
    const caseId = await caseAgainst(author, "Bərpa");
    await admin.decideModeration(caseId, staffId, "ban");

    await admin.decideModeration(caseId, staffId, "unban");

    expect((await statusOf(author)).status).toBe("active");
    const [row] = await sql<Array<{ reason: string }>>`
      select reason from internal.auth_epoch where app_user_id = ${author.appUserId}`;
    expect(row!.reason).toBe("unban");
  });

  it("keeps the durable id out of the audit row", async () => {
    // T4(d): audit rows persist only a case-scoped label, never the durable
    // id. The sanction needs to know who at the moment of acting; the record
    // does not need to keep it.
    const author = await makeUser(`iz-${rnd()}`);
    const caseId = await caseAgainst(author, "İz qalmasın");
    await admin.decideModeration(caseId, staffId, "suspend");

    const rows = await sql<Array<{ target_app_user_id: string | null; duration: unknown }>>`
      select target_app_user_id, duration from moderation.action where case_id = ${caseId}`;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.target_app_user_id).toBeNull();
    // The duration IS recorded, which is what makes the trail say "suspended
    // for seven days" rather than just "suspended".
    expect(rows.some((r) => r.duration !== null)).toBe(true);
  });

  // -------------------------------------------------------------------
  // Enforcing — the half that actually stops anybody
  // -------------------------------------------------------------------

  it("refuses a suspended student's writes", async () => {
    const author = await makeUser(`yaza-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "Yaza bilməz"), staffId, "suspend");

    await expect(sanctions.assertMayWrite(author)).rejects.toThrow(
      expect.objectContaining({ code: "account_suspended" }) as never,
    );
  });

  it("tells a banned student it is a ban, not a suspension", async () => {
    // Both are 403 with action contact_support, but one ends on a date and
    // the other does not. Somebody deciding whether to appeal needs to know
    // which they are looking at.
    const author = await makeUser(`fərq-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "Fərq"), staffId, "ban");

    await expect(sanctions.assertMayWrite(author)).rejects.toThrow(
      expect.objectContaining({ code: "account_banned" }) as never,
    );
  });

  it("still lets a suspended student read", async () => {
    // Deliberate, and the same reasoning that keeps suspended accounts inside
    // internal.token_claims: they have to be able to sign in and find out what
    // happened. assertMayWrite is called by write paths only.
    const author = await makeUser(`oxuya-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "Oxuya bilər"), staffId, "suspend");

    const state = await sanctions.stateOf(author.appUserId);
    expect(state.may_write).toBe(false);
    // Reading their own moderation history is a read, and it works.
    expect(await appeals.listMine(author)).toBeInstanceOf(Array);
  });

  it("lets a lapsed suspension expire on its own, with no job running", async () => {
    // Expiry is evaluated on read against the DATABASE clock. A scheduled job
    // flipping statuses back would leave a window where a lapsed suspension
    // still refuses someone, and would be one more thing that can stop running.
    const author = await makeUser(`bitdi-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "Vaxtı bitdi"), staffId, "suspend");
    await expect(sanctions.assertMayWrite(author)).rejects.toThrow();

    await sql`update public.app_user set suspended_until = now() - interval '1 minute'
               where id = ${author.appUserId}`;

    await expect(sanctions.assertMayWrite(author)).resolves.toBeUndefined();
    expect((await sanctions.stateOf(author.appUserId)).may_write).toBe(true);
  });

  it("does not refuse an unsanctioned student", async () => {
    const clean = await makeUser(`təmiz-${rnd()}`);
    await expect(sanctions.assertMayWrite(clean)).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------
  // Shadowban — the one that must not announce itself
  // -------------------------------------------------------------------

  it("does NOT refuse a shadowbanned student's writes", async () => {
    // Being refused would tell them, which defeats the entire sanction.
    const author = await makeUser(`kölgə-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "Kölgə"), staffId, "shadowban");

    expect((await statusOf(author)).status).toBe("shadowbanned");
    await expect(sanctions.assertMayWrite(author)).resolves.toBeUndefined();
  });

  it("limits a shadowbanned student's new content at write time", async () => {
    const author = await makeUser(`kölgə2-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "Kölgə2"), staffId, "shadowban");

    const state = await sql.begin(async (tx) =>
      moderation.classifyOnWrite(tx, {
        targetType: "post", targetId: "00000000-0000-4000-8000-000000000001",
        universityId: uniId, title: "Tamamilə adi post", body: "Heç bir qayda pozulmur.",
        authorAppUserId: author.appUserId,
      }),
    );

    // Clean content that would otherwise be 'visible'.
    expect(state).toBe("limited");
  });

  it("opens no case when limiting for a shadowban", async () => {
    // A case would surface in /me/moderation as an action they could appeal,
    // which would tell them they are shadowbanned.
    const author = await makeUser(`kölgə3-${rnd()}`);
    await admin.decideModeration(await caseAgainst(author, "Kölgə3"), staffId, "shadowban");
    const target = "00000000-0000-4000-8000-000000000002";

    await sql.begin(async (tx) =>
      moderation.classifyOnWrite(tx, {
        targetType: "post", targetId: target, universityId: uniId,
        title: "Adi", body: "Adi mətn.", authorAppUserId: author.appUserId,
      }),
    );

    const cases = await sql`select 1 from moderation.mod_case where subject_id = ${target}`;
    expect(cases.length).toBe(0);
    const actions = await sql`select 1 from moderation.action where target_id = ${target}`;
    expect(actions.length).toBe(0);
  });

  it("leaves an unsanctioned author's clean content visible", async () => {
    const clean = await makeUser(`normal-${rnd()}`);
    const state = await sql.begin(async (tx) =>
      moderation.classifyOnWrite(tx, {
        targetType: "post", targetId: "00000000-0000-4000-8000-000000000003",
        universityId: uniId, title: "Adi", body: "Adi mətn.",
        authorAppUserId: clean.appUserId,
      }),
    );
    expect(state).toBe("visible");
  });

  // -------------------------------------------------------------------
  // Non-sanction kinds are unaffected
  // -------------------------------------------------------------------

  it("does not touch the account for warn or remove_content", async () => {
    const author = await makeUser(`xəbərdar-${rnd()}`);
    const caseId = await caseAgainst(author, "Yalnız xəbərdarlıq");

    const result = await admin.decideModeration(caseId, staffId, "warn");

    expect(result.sanction_applied).toBe(false);
    expect((await statusOf(author)).status).toBe("active");
  });
});
