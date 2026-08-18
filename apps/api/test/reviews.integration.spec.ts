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

suite("review composer inputs (integration)", () => {
  let sql: postgres.Sql;
  let service: ReviewsService;
  let uniId: string;

  /** A fresh student with no reviews and no enrollments. */
  async function makeStudent(handle: string): Promise<KiksuRequestContext> {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const [u] = await sql`
      insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
      values (${au!.id}, ${handle}, ${uniId}, 'email_verified', 'active') returning id`;
    return {
      authUserId: au!.id as string, appUserId: u!.id as string, tier: "email",
      role: "student", univId: uniId, epoch: 1, sid: "t",
    };
  }

  /** Enrols them in every current-term section of one course. */
  async function enrol(user: KiksuRequestContext, courseCode: string): Promise<void> {
    await sql`
      insert into public.enrollment (app_user_id, section_id, term_id, state)
      select ${user.appUserId}, s.id, s.term_id, 'enrolled'
        from ref.course_section s
        join ref.course c on c.id = s.course_id
        join ref.term t on t.id = s.term_id and t.is_current
       where c.code = ${courseCode} and c.university_id = ${uniId}
      on conflict do nothing`;
  }

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const db = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    service = new ReviewsService(db as never, new ModerationService());
    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    uniId = uni!.id as string;
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  // -------------------------------------------------------------------
  // The tag vocabulary
  // -------------------------------------------------------------------

  it("serves the closed tag vocabulary the composer needs", async () => {
    // Without this the tag half of a review is unwritable: POST /reviews
    // answers review_tag_unknown (422) to anything not in this list, so a
    // client cannot guess a key.
    const tags = await service.listTags("az");
    expect(tags.length).toBeGreaterThan(0);
    const keys = tags.map((t) => t.key);
    expect(keys).toContain("slides_clear");
    // The design's chips, in the design's words.
    expect(tags.find((t) => t.key === "slides_clear")?.label).toBe("Slaydlar aydın");
    expect(tags.find((t) => t.key === "strict_checking")?.polarity).toBe("negative");
  });

  it("returns tags in display order, so the chips are stable between renders", async () => {
    const tags = await service.listTags("az");
    const orders = await sql<Array<{ key: string; display_order: number }>>`
      select key, display_order from ref.review_tag where is_active order by display_order, key`;
    expect(tags.map((t) => t.key)).toEqual(orders.map((o) => o.key));
  });

  it("serves English labels to an English caller", async () => {
    const tags = await service.listTags("en");
    expect(tags.find((t) => t.key === "slides_clear")?.label).toBe("Clear slides");
  });

  it("falls back to Azerbaijani where a translation is missing", async () => {
    // label_ru is nullable and unseeded. A Russian caller must see the
    // Azerbaijani word, never an empty chip — the fallback is permanent
    // correct behaviour, the missing copy is a separate gap.
    const tags = await service.listTags("ru");
    expect(tags.find((t) => t.key === "slides_clear")?.label).toBe("Slaydlar aydın");
    expect(tags.every((t) => t.label.length > 0)).toBe(true);
  });

  // -------------------------------------------------------------------
  // What the caller may review
  // -------------------------------------------------------------------

  it("offers nothing to a student with no enrollments", async () => {
    const stranger = await makeStudent("rey-yazmayan-01");
    expect(await service.listReviewable(stranger)).toEqual([]);
  });

  it("offers a course the student is enrolled in, with its instructor", async () => {
    const student = await makeStudent("rey-yazan-01");
    await enrol(student, "CS 214");

    const options = await service.listReviewable(student);
    const cs214 = options.find((o) => o.course_code === "CS 214");
    expect(cs214, "an enrolled course should be reviewable").toBeDefined();
    expect(cs214!.instructor_name).toBeTruthy();
    expect(cs214!.term_label).toBeTruthy();
  });

  it("offers an instructor who has no reviews yet — the cold-start case", async () => {
    // THE REASON THIS ENDPOINT EXISTS. InstructorProfileDto.courses is filtered
    // to courses that already have reviews, so driving the composer from the
    // profile would offer an empty picker for exactly the instructor the
    // contribution wall is trying to get a first review for.
    const [fresh] = await sql<Array<{ id: string; course_code: string }>>`
      select i.id, c.code as course_code
        from ref.instructor i
        join ref.course_section s on s.primary_instructor_id = i.id
        join ref.course c on c.id = s.course_id
        join ref.term t on t.id = s.term_id and t.is_current
       where i.university_id = ${uniId}
         and not exists (select 1 from public.review r where r.instructor_id = i.id)
       limit 1`;
    if (!fresh) return; // seed has no unreviewed instructor; nothing to assert

    const student = await makeStudent("rey-yazan-02");
    await enrol(student, fresh.course_code);

    const options = await service.listReviewable(student);
    expect(options.some((o) => o.instructor_id === fresh.id)).toBe(true);

    // And the profile-driven path would indeed have offered nothing.
    const profile = await service.getInstructor(student, fresh.id);
    expect(profile.courses).toEqual([]);
  });

  it("stops offering a pair once it has been reviewed", async () => {
    const student = await makeStudent("rey-yazan-03");
    await enrol(student, "CS 214");

    const before = await service.listReviewable(student);
    const target = before.find((o) => o.course_code === "CS 214");
    expect(target).toBeDefined();

    await service.createReview(student, {
      courseId: target!.course_id, instructorId: target!.instructor_id,
      overall: 4, quality: 4, fairness: 4, workload: 3, attendanceStrictness: 3,
      tags: ["slides_clear"], body: "Dərs aydın izah olunur.",
    });

    // The unique constraint on internal.review_author would reject a second
    // one anyway; excluding it here means the composer never offers a choice
    // that is going to fail.
    const after = await service.listReviewable(student);
    expect(after.some(
      (o) => o.course_id === target!.course_id && o.instructor_id === target!.instructor_id,
    )).toBe(false);
  });

  it("does not offer another campus's courses", async () => {
    // The pool is BYPASSRLS, so this predicate is the only thing scoping it.
    const student = await makeStudent("rey-yazan-04");
    await enrol(student, "CS 214");

    const options = await service.listReviewable(student);
    if (options.length === 0) return;

    const ids = options.map((o) => o.course_id);
    const [foreign] = await sql<Array<{ n: number }>>`
      select count(*)::int as n from ref.course
       where id = any(${ids}) and university_id <> ${uniId}`;
    expect(foreign!.n).toBe(0);
  });

  it("opens the contribution wall once a review is written", async () => {
    const student = await makeStudent("rey-yazan-05");
    await enrol(student, "CS 214");
    const target = (await service.listReviewable(student))
      .find((o) => o.course_code === "CS 214");

    const [instructor] = await sql`select id from ref.instructor where slug = 'nigar-eliyeva'`;

    // Before: 200 with the wall's state, never a 403 — the client renders a
    // bargain, not an error.
    const locked = await service.listReviews(student, instructor!.id);
    expect(locked.access.can_read_text).toBe(false);
    expect(locked.items).toEqual([]);

    await service.createReview(student, {
      courseId: target!.course_id, instructorId: target!.instructor_id,
      overall: 5, quality: 5, fairness: 4, workload: 3, attendanceStrictness: 2,
      tags: [], body: undefined,
    });

    const open = await service.listReviews(student, instructor!.id);
    expect(open.access.can_read_text).toBe(true);
    expect(open.items.length).toBeGreaterThan(0);
    // Even unlocked, no review carries an author of any kind.
    for (const r of open.items) {
      expect(r).not.toHaveProperty("author");
      expect(r).not.toHaveProperty("alias");
      expect(r).not.toHaveProperty("app_user_id");
    }
  });
});
