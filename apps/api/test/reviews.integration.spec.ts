import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { ReviewsService } from "../src/modules/reviews/reviews.service";
import { ModerationService } from "../src/modules/moderation/moderation.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("reviews service (integration)", () => {
  let sql: postgres.Sql;
  let service: ReviewsService;
  let reader: KiksuRequestContext;      // has written nothing
  let instructorId: string;
  let courseId: string;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const db = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    service = new ReviewsService(db as never, new ModerationService());

    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    const [i] = await sql`select id from ref.instructor where slug = 'nigar-eliyeva'`;
    const [c] = await sql`select id from ref.course where code = 'CS 214'`;
    if (!uni || !i || !c) throw new Error("seed missing");
    instructorId = i.id; courseId = c.id;

    const mk = async (handle: string) => {
      const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      const [u] = await sql`
        insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
        values (${au!.id}, ${handle}, ${uni.id}, 'email_verified', 'active') returning id`;
      return {
        authUserId: au!.id, appUserId: u!.id, tier: "email" as const,
        role: "student" as const, univId: uni.id, epoch: 1, sid: "t",
      };
    };
    reader = await mk("rey-oxuyan-01");
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("renders the design's professor profile from real aggregates", async () => {
    const p = await service.getInstructor(reader, instructorId);
    expect(p.full_name).toBe("Nigar Əliyeva");
    expect(p.title_prefix).toBe("dos.");
    expect(p.department).toBe("İnformatika");
    expect(p.review_count).toBe(61);
    // The design's histogram: 5:35 4:16 3:7 2:2 1:1
    expect(p.histogram).toEqual([1, 2, 7, 16, 35]);
    // And its criterion averages: 4.6 / 4.0 / 3.5 / 2.9
    expect(Number(p.criteria.quality)).toBeCloseTo(4.6, 1);
    expect(Number(p.criteria.fairness)).toBeCloseTo(4.0, 1);
    expect(Number(p.criteria.workload)).toBeCloseTo(3.5, 1);
    expect(Number(p.criteria.attendance_strictness)).toBeCloseTo(2.9, 1);
  });

  it("shows the design's tag chips, computed from the reviews themselves", async () => {
    const p = await service.getInstructor(reader, instructorId);
    expect(p.top_tags.length).toBeGreaterThan(0);
    // Ranked by how often reviewers actually chose them, not by a stale job.
    expect(p.top_tags.map((t) => t.key)).toContain("slides_clear");
    for (const t of p.top_tags) expect(t.label).toBeTruthy();
  });

  it("shows aggregates to someone who has written nothing", async () => {
    // The wall gates prose, not numbers. Gating everything would leave a
    // student at a locked door with no reason to open it.
    const p = await service.getInstructor(reader, instructorId);
    expect(p.review_count).toBe(61);
    expect(p.rating_avg).not.toBeNull();
  });

  it("withholds prose behind the wall, as a prompt rather than a 403", async () => {
    const page = await service.listReviews(reader, instructorId);
    expect(page.access.can_read_text).toBe(false);
    expect(page.access.written_this_term).toBe(0);
    expect(page.access.required_this_term).toBe(1);
    expect(page.items).toHaveLength(0);   // 200 with nothing, never an error
  });

  it("opens the wall the moment the caller contributes", async () => {
    const before = await service.listReviews(reader, instructorId);
    expect(before.access.can_read_text).toBe(false);

    const [other] = await sql`select id from ref.course where code = 'MATH 201'`;
    await service.createReview(reader, {
      courseId: other!.id, instructorId, overall: 4, quality: 4,
      fairness: 4, workload: 3, attendanceStrictness: 3,
      tags: ["slides_clear"], body: "Aydın izah edir, imtahan gözləniləndir.",
    });

    const after = await service.listReviews(reader, instructorId);
    expect(after.access.can_read_text).toBe(true);
    expect(after.items.length).toBeGreaterThan(0);
  });

  it("exposes no author field of any kind on a review", async () => {
    const page = await service.listReviews(reader, instructorId);
    const json = JSON.stringify(page);
    // Not even an ordinal: a course cohort is small enough that
    // "Anonim 3, spring term" narrows to a handful of people.
    expect(json).not.toContain("alias");
    expect(json).not.toContain("app_user");
    expect(json).not.toContain("handle");
    for (const item of page.items) {
      expect(Object.keys(item)).not.toContain("author");
    }
  });

  it("keeps review authorship in internal, never on the public row", async () => {
    // Parentheses matter: `a and b or c` would match any table's app_user_id.
    const cols = await sql<Array<{ column_name: string }>>`
      select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'review'
         and (column_name like '%author%' or column_name like '%app_user%')`;
    expect(cols).toHaveLength(0);

    // And the real map does live in internal, reachable only by this service.
    const [internal] = await sql`
      select column_name from information_schema.columns
       where table_schema = 'internal' and table_name = 'review_author'
         and column_name = 'app_user_id'`;
    expect(internal).toBeTruthy();
  });

  it("refuses a second review of the same course, instructor and term", async () => {
    const [other] = await sql`select id from ref.course where code = 'MATH 201'`;
    await expect(service.createReview(reader, {
      courseId: other!.id, instructorId, overall: 3, quality: 3,
      fairness: 3, workload: 3, attendanceStrictness: 3, tags: [],
    })).rejects.toThrow();
  });

  it("marks a reviewer who was never enrolled as unverified", async () => {
    const page = await service.listReviews(reader, instructorId);
    const mine = page.items.find((r) => r.body?.startsWith("Aydın izah"));
    // reader was never enrolled in MATH 201, so no DOĞRULANMIŞ badge.
    expect(mine?.is_enrollment_verified).toBe(false);
  });

  it("filters written reviews to one course", async () => {
    const page = await service.listReviews(reader, instructorId, courseId);
    expect(page.items.every((r) => r.course_code === "CS 214")).toBe(true);
  });
});
