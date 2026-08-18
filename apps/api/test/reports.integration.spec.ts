import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { DbEpochService } from "../src/common/auth/epoch.service";
import { ReportsService } from "../src/modules/reports/reports.service";
import { AdminService } from "../src/modules/admin/admin.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("report flow (integration)", () => {
  let sql: postgres.Sql;
  let reports: ReportsService;
  let admin: AdminService;
  let uniId: string;
  const users: KiksuRequestContext[] = [];

  const mkPost = async (title: string) => {
    const [board] = await sql`select id, university_id from public.board where slug = 'bdu-serbest-sohbet'`;
    const [p] = await sql`
      insert into public.post (board_id, university_id, title, author_display_mode,
                               author_alias_number, author_tier)
      values (${board!.id}, ${board!.university_id}, ${title}, 'alias', 1, 'email_verified')
      returning id`;
    return p!.id as string;
  };

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const db = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    reports = new ReportsService(db as never);
    admin = new AdminService(db as never, db as never, new DbEpochService(db as never));

    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    uniId = uni!.id;
    for (let i = 0; i < 4; i++) {
      const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      const [u] = await sql`
        insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
        values (${au!.id}, ${`sikayet-eden-${i}-01`}, ${uniId}, 'email_verified', 'active')
        returning id`;
      users.push({
        authUserId: au!.id, appUserId: u!.id, tier: "email",
        role: "student", univId: uniId, epoch: 1, sid: "t",
      });
    }
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("offers only the reasons that apply to the target type", async () => {
    const forReview = await reports.reasonsFor("review");
    expect(forReview.map((r) => r.key)).toContain("naming_person");
    // A listing cannot be "off topic"; a board post can.
    const forListing = await reports.reasonsFor("listing");
    expect(forListing.map((r) => r.key)).not.toContain("off_topic");
    expect(forListing.map((r) => r.key)).toContain("scam");
  });

  it("opens a moderation case, which is what makes the queue real", async () => {
    const postId = await mkPost("Şikayət testi 1");
    // Scoped to THIS post rather than to the queue's total length. moderationQueue(null)
    // is deliberately unscoped — it is the platform-wide staff view — and vitest runs
    // test files in parallel against one database, so three other files opening cases
    // concurrently made a `before.length + 1` assertion fail roughly one run in six.
    // The claim worth testing was never "the queue grew by one" anyway; it is "a case
    // now exists for this post, and it says what it should", which is what follows.
    expect((await admin.moderationQueue(null)).find((x) => x.subject_id === postId)).toBeUndefined();

    await reports.fileReport(users[0]!, {
      targetType: "post", targetId: postId, reasonKey: "spam",
    });

    const after = await admin.moderationQueue(null);
    const c = after.find((x) => x.subject_id === postId);
    expect(c, "a moderation case should exist for the reported post").toBeDefined();
    expect(c!.report_count).toBe(1);
    expect(c!.reasons).toContain("spam");
    expect(c!.excerpt).toContain("Şikayət testi 1");
  });

  it("does not let one person inflate the count by reporting twice", async () => {
    const postId = await mkPost("Təkrar şikayət");
    await reports.fileReport(users[0]!, { targetType: "post", targetId: postId, reasonKey: "spam" });
    await reports.fileReport(users[0]!, { targetType: "post", targetId: postId, reasonKey: "spam" });
    await reports.fileReport(users[0]!, { targetType: "post", targetId: postId, reasonKey: "harassment" });

    const q = await admin.moderationQueue(null);
    const c = q.find((x) => x.subject_id === postId)!;
    // report_count drives the auto-hide threshold, so one determined person
    // must not be able to move it.
    expect(c.report_count).toBe(1);
  });

  it("keeps the highest severity when a milder reason arrives later", async () => {
    const postId = await mkPost("Ciddilik testi");
    await reports.fileReport(users[0]!, { targetType: "post", targetId: postId, reasonKey: "harassment" });
    await reports.fileReport(users[1]!, { targetType: "post", targetId: postId, reasonKey: "off_topic" });

    const [c] = await sql`select severity from moderation.mod_case where subject_id = ${postId}`;
    // A spam report on top of harassment must not demote it down the queue.
    expect(c!.severity).toBe(5);
  });

  it("auto-limits content once enough DISTINCT people report it", async () => {
    const postId = await mkPost("Avtomatik gizlətmə");
    // harassment auto-hides at 3.
    await reports.fileReport(users[0]!, { targetType: "post", targetId: postId, reasonKey: "harassment" });
    let [p] = await sql`select moderation_state::text as s from public.post where id = ${postId}`;
    expect(p!.s).toBe("visible");

    await reports.fileReport(users[1]!, { targetType: "post", targetId: postId, reasonKey: "harassment" });
    await reports.fileReport(users[2]!, { targetType: "post", targetId: postId, reasonKey: "harassment" });

    [p] = await sql`select moderation_state::text as s from public.post where id = ${postId}`;
    // `limited`, not `removed`: reversible in one update and still reachable
    // by direct link, so the threshold cannot be used as a delete button.
    expect(p!.s).toBe("limited");
  });

  it("never auto-hides on a judgement-call reason", async () => {
    const postId = await mkPost("Mövzudan kənar");
    for (let i = 0; i < 4; i++) {
      await reports.fileReport(users[i]!, { targetType: "post", targetId: postId, reasonKey: "off_topic" });
    }
    const [p] = await sql`select moderation_state::text as s from public.post where id = ${postId}`;
    // off_topic has no threshold: an automatic hide would hand a brigade a
    // delete button for anything they merely dislike.
    expect(p!.s).toBe("visible");
  });

  it("stays silent about a target that does not exist", async () => {
    // No error, no case: a varying response would let a reporter probe for
    // whether a given id exists.
    await expect(reports.fileReport(users[0]!, {
      targetType: "post",
      targetId: "00000000-0000-0000-0000-000000000000",
      reasonKey: "spam",
    })).resolves.toBeUndefined();
  });

  it("rejects a reason that does not apply to the target type", async () => {
    const postId = await mkPost("Yanlış səbəb");
    // This one IS an error: it is a client bug, not a user action.
    await expect(reports.fileReport(users[0]!, {
      targetType: "post", targetId: postId, reasonKey: "off_topic_nonexistent",
    })).rejects.toThrow();
  });

  it("hands a moderator everything needed to decide without a second lookup", async () => {
    const postId = await mkPost("Moderator görünüşü");
    await reports.fileReport(users[0]!, {
      targetType: "post", targetId: postId, reasonKey: "naming_person",
      details: "Qrup yoldaşımın adını yazıb.",
    });
    const q = await admin.moderationQueue(null);
    const c = q.find((x) => x.subject_id === postId)!;
    expect(c.excerpt).toBeTruthy();
    expect(c.reasons).toContain("naming_person");
    expect(c.severity).toBe(4);
  });
});
