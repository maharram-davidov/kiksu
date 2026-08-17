import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { AdminService } from "../src/modules/admin/admin.service";
import { OnboardingService } from "../src/modules/onboarding/onboarding.service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const PEPPER = "admin-test-pepper-long-enough-to-pass-32";

suite("admin queues (integration)", () => {
  let sql: postgres.Sql;
  let admin: AdminService;
  let onboarding: OnboardingService;
  let staffId: string;
  let uniId: string;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const db = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    admin = new AdminService(db as never, db as never);
    onboarding = new OnboardingService(db as never, db as never, { credentialPepper: PEPPER } as never);

    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    uniId = uni!.id;
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const [s] = await sql`
      insert into moderation.staff (auth_user_id, display_name, role, is_active)
      values (${au!.id}, 'Test Moderator', 'moderator', true) returning id`;
    staffId = s!.id;
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("lists a submitted card, ordered by the SLA the app promised", async () => {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await onboarding.submitCardVerification(uniId, au!.id, "cards/queue-a.jpg", "b".repeat(64));

    const queue = await admin.verificationQueue(null);
    const mine = queue.find((c) => c.evidence_path === "cards/queue-a.jpg");
    expect(mine).toBeDefined();
    expect(mine!.state).toBe("in_review");
    // Sorted by deadline, not submission time: when they diverge, the deadline
    // is what a student was told.
    const deadlines = queue.map((c) => c.minutes_to_sla ?? Number.MAX_SAFE_INTEGER);
    expect(deadlines).toEqual([...deadlines].sort((a, b) => a - b));
  });

  it("approving a card provisions a generated pseudonym at card tier", async () => {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await onboarding.submitCardVerification(uniId, au!.id, "cards/approve.jpg", "c".repeat(64));
    const queue = await admin.verificationQueue(null);
    const target = queue.find((c) => c.evidence_path === "cards/approve.jpg")!;

    const result = await admin.decideVerification(target.attempt_id, staffId, true);
    expect(result.state).toBe("verified");
    expect(result.handle).toMatch(/^[a-zəğıöşüç]+-[a-zəğıöşüç]+-\d{2}$/u);

    const [row] = await sql`select verification_tier::text as t from public.app_user where handle = ${result.handle}`;
    expect(row!.t).toBe("card_verified");
  });

  it("clears the evidence pointer on decision so the image can be purged", async () => {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await onboarding.submitCardVerification(uniId, au!.id, "cards/purge.jpg", "d".repeat(64));
    const q = await admin.verificationQueue(null);
    const target = q.find((c) => c.evidence_path === "cards/purge.jpg")!;

    await admin.decideVerification(target.attempt_id, staffId, false, "unreadable");
    const [row] = await sql`
      select evidence_path, state::text as state, reject_reason_code
        from identity.verification_attempt where id = ${target.attempt_id}`;
    // A decided case has no further use for the document.
    expect(row!.evidence_path).toBeNull();
    expect(row!.state).toBe("rejected");
    expect(row!.reject_reason_code).toBe("unreadable");
  });

  it("takes a decided case out of the queue", async () => {
    const before = await admin.verificationQueue(null);
    const target = before[0];
    if (!target) return;
    await admin.decideVerification(target.attempt_id, staffId, true);
    const after = await admin.verificationQueue(null);
    expect(after.find((c) => c.attempt_id === target.attempt_id)).toBeUndefined();
  });

  it("refuses to decide the same case twice", async () => {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await onboarding.submitCardVerification(uniId, au!.id, "cards/twice.jpg", "e".repeat(64));
    const q = await admin.verificationQueue(null);
    const target = q.find((c) => c.evidence_path === "cards/twice.jpg")!;

    await admin.decideVerification(target.attempt_id, staffId, true);
    await expect(admin.decideVerification(target.attempt_id, staffId, true)).rejects.toThrow();
  });

  it("removes reported content and records the action", async () => {
    const [post] = await sql`select id, board_id from public.post limit 1`;
    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    const [mc] = await sql`
      insert into moderation.mod_case (subject_type, subject_id, university_id, state, report_count, opened_by)
      values ('post', ${post!.id}, ${uni!.id}, 'open', 3, 'report') returning id`;

    const res = await admin.decideModeration(mc!.id, staffId, "remove_content", "Şəxsi hücum");
    expect(res.state).toBe("actioned");

    const [p] = await sql`select moderation_state::text as s from public.post where id = ${post!.id}`;
    expect(p!.s).toBe("removed");

    const [act] = await sql`select kind::text as k from moderation.action where case_id = ${mc!.id}`;
    expect(act!.k).toBe("remove_content");

    await sql`update public.post set moderation_state = 'visible' where id = ${post!.id}`;
  });

  it("records an action even when nothing is removed", async () => {
    const [post] = await sql`select id from public.post offset 1 limit 1`;
    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    const [mc] = await sql`
      insert into moderation.mod_case (subject_type, subject_id, university_id, state, report_count, opened_by)
      values ('post', ${post!.id}, ${uni!.id}, 'open', 1, 'automod') returning id`;

    const res = await admin.decideModeration(mc!.id, staffId, "no_action");
    expect(res.state).toBe("dismissed");

    // A queue that logs only removals cannot answer "was this looked at and
    // kept" — which is what a transparency report and an appeal both need.
    const [act] = await sql`select kind::text as k from moderation.action where case_id = ${mc!.id}`;
    expect(act!.k).toBe("no_action");

    const [p] = await sql`select moderation_state::text as s from public.post where id = ${post!.id}`;
    expect(p!.s).toBe("visible");
  });

  it("scopes a campus moderator to their own campus", async () => {
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    const scoped = await admin.verificationQueue(ada!.id);
    expect(scoped.every((c) => c.university_code === "ADA")).toBe(true);
  });
});
