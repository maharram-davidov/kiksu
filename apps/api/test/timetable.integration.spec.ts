import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { TimetableService } from "../src/modules/timetable/timetable.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

/**
 * Integration tests against a real Postgres with migrations + seed applied.
 * Run via `scripts/test-integration.sh`, which stands the database up and
 * exports DATABASE_URL. Skipped when that is unset so `vitest run` stays fast
 * for everyone else.
 *
 * These exist because the unit-testable part of this module is trivial and the
 * part that breaks is the SQL. Every defect found in this project so far —
 * four in the schema, four in the seed — was invisible to review and instant
 * to catch by execution.
 */
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("timetable service (integration)", () => {
  let sql: postgres.Sql;
  let service: TimetableService;
  let user: KiksuRequestContext;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    service = new TimetableService({ sql } as never);

    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    if (!uni) throw new Error("seed missing: BDU university");
    const [authUser] = await sql`
      insert into auth.users (id) values (gen_random_uuid()) returning id`;
    if (!authUser) throw new Error("failed to create auth user");
    const [appUser] = await sql`
      insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
      values (${authUser.id}, 'test-tələbə-01', ${uni.id}, 'email_verified', 'active')
      returning id`;
    if (!appUser) throw new Error("failed to create app_user");

    // Enrol in every seeded section so the grid has content.
    await sql`
      insert into public.enrollment (app_user_id, section_id, term_id, state)
      select ${appUser.id}, s.id, s.term_id, 'enrolled'
        from ref.course_section s
        join ref.course c on c.id = s.course_id
       where c.university_id = ${uni.id}`;

    // Four unexcused absences in CS 214 — the design's "4 / 12".
    const [cs214] = await sql`
      select e.id from public.enrollment e
        join ref.course_section s on s.id = e.section_id
        join ref.course c on c.id = s.course_id and c.code = 'CS 214'
       where e.app_user_id = ${appUser.id}`;
    if (!cs214) throw new Error("seed missing: CS 214 enrollment");
    for (const d of ["2025-09-16", "2025-09-23", "2025-09-30", "2025-10-07"]) {
      await sql`insert into public.absence (enrollment_id, occurred_on, kind, source)
                values (${cs214.id}, ${d}::date, 'absent', 'self_reported')`;
    }

    user = {
      authUserId: authUser.id, appUserId: appUser.id, tier: "email",
      role: "student", univId: uni.id, epoch: 1, sid: "test",
    };
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("returns the week grid for the current term in one query", async () => {
    const grid = await service.getWeekGrid(user);
    expect(grid).not.toBeNull();
    expect(grid!.term.label).toBe("2025/26 Payız");
    expect(grid!.timezone).toBe("Asia/Baku");
    expect(grid!.meetings.length).toBeGreaterThan(0);
  });

  it("reproduces the design's CS 214 slot exactly", async () => {
    const grid = await service.getWeekGrid(user);
    const slot = grid!.meetings.find(
      (m) => m.course_code === "CS 214" && m.weekday === 2,
    );
    expect(slot).toBeDefined();
    expect(slot!.starts_at).toBe("14:05");
    expect(slot!.ends_at).toBe("15:25");
    expect(slot!.room).toBe("312");
    expect(slot!.instructor).toBe("dos. Nigar Əliyeva");
  });

  it("meetings come back ordered by weekday then start time", async () => {
    const grid = await service.getWeekGrid(user);
    const keys = grid!.meetings.map((m) => m.weekday * 10000 + Number(m.starts_at.replace(":", "")));
    expect(keys).toEqual([...keys].sort((a, b) => a - b));
  });

  it("computes attendance against the university's configured limit, not a constant", async () => {
    const rows = await service.getAttendance(user);
    const cs214 = rows.find((r) => r.course_code === "CS 214");
    expect(cs214).toBeDefined();
    expect(cs214!.absences).toBe(4);
    expect(cs214!.max_absences).toBe(12);   // BDU's configured policy
    expect(cs214!.expulsion_at).toBe(12);
    expect(cs214!.used_ratio).toBeCloseTo(0.3333, 3);
    expect(cs214!.is_warning).toBe(true);   // BDU warns at 0.33
    expect(cs214!.is_barred).toBe(false);
  });

  it("does not count an approved excused absence against the limit", async () => {
    // Regression: `excuse_state` is none/requested/approved/rejected, and
    // `kind` is absent/late/excused. Filtering excuse_state against 'excused'
    // matches nothing, so approved excuses silently counted and could bar a
    // student from an exam they were entitled to sit.
    const [enr] = await sql`
      select e.id from public.enrollment e
        join ref.course_section s on s.id = e.section_id
        join ref.course c on c.id = s.course_id and c.code = 'MATH 201'
       where e.app_user_id = ${user.appUserId}`;
    if (!enr) throw new Error("seed missing: MATH 201 enrollment");

    await sql`insert into public.absence (enrollment_id, occurred_on, kind, source, excuse_state)
              values (${enr.id}, '2025-10-14'::date, 'absent', 'self_reported', 'approved')`;
    await sql`insert into public.absence (enrollment_id, occurred_on, kind, source)
              values (${enr.id}, '2025-10-21'::date, 'excused', 'instructor')`;
    await sql`insert into public.absence (enrollment_id, occurred_on, kind, source)
              values (${enr.id}, '2025-10-28'::date, 'absent', 'self_reported')`;

    const rows = await service.getAttendance(user);
    const math = rows.find((r) => r.course_code === "MATH 201");
    // three rows inserted, only the plain unexcused one counts
    expect(math!.absences).toBe(1);
  });

  describe("class detail sheet", () => {
    let sectionId: string;

    beforeAll(async () => {
      const [s] = await sql`
        select s.id from ref.course_section s
          join ref.course c on c.id = s.course_id and c.code = 'CS 214'`;
      sectionId = s!.id;
    });

    it("returns the design's header in one call", async () => {
      const d = await service.getClassDetail(user, sectionId);
      expect(d.course_code).toBe("CS 214");
      expect(d.course_title).toBe("Verilənlər bazası sistemləri");
      expect(d.credits).toBe(6);                       // the design's "6 KREDİT"
      expect(d.instructor!.full_name).toBe("Nigar Əliyeva");
      expect(d.instructor!.title_prefix).toBe("dos.");
      expect(Number(d.instructor!.rating_avg)).toBeCloseTo(4.3, 1);
      expect(d.meetings.length).toBeGreaterThan(0);
      const cakhs = d.meetings.find((m) => m.weekday === 2);
      expect(cakhs!.starts_at).toBe("14:05");
      expect(cakhs!.room).toBe("312");
    });

    it("agrees with the attendance list, so two surfaces cannot disagree", async () => {
      const detail = await service.getClassDetail(user, sectionId);
      const list = await service.getAttendance(user);
      const same = list.find((a) => a.section_id === sectionId)!;
      // A student anxious about exclusion must never see two different counts.
      expect(detail.attendance.absences).toBe(same.absences);
      expect(detail.attendance.max_absences).toBe(same.max_absences);
      expect(detail.attendance.is_barred).toBe(same.is_barred);
    });

    it("records a self-reported absence and returns the new count", async () => {
      const before = await service.getClassDetail(user, sectionId);
      const res = await service.recordAbsence(user, sectionId, "2025-11-04");
      expect(res.absences).toBe(before.attendance.absences + 1);
    });

    it("does not charge a second absence for the same date", async () => {
      const first = await service.recordAbsence(user, sectionId, "2025-11-11");
      const second = await service.recordAbsence(user, sectionId, "2025-11-11");
      // Tapping twice must not cost a student an absence against a limit that
      // can exclude them.
      expect(second.absences).toBe(first.absences);
    });

    it("refuses to record for a course the caller is not enrolled in", async () => {
      const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      const [u] = await sql`
        insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
        values (${au!.id}, 'qeyri-telebe-01', ${user.univId}, 'email_verified', 'active')
        returning id`;
      const stranger = { ...user, appUserId: u!.id };
      await expect(service.recordAbsence(stranger, sectionId, "2025-11-18")).rejects.toThrow();
    });

    it("hides recording for a non-enrolled caller by returning no enrollment", async () => {
      const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      const [u] = await sql`
        insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
        values (${au!.id}, 'baxan-telebe-01', ${user.univId}, 'email_verified', 'active')
        returning id`;
      const d = await service.getClassDetail({ ...user, appUserId: u!.id }, sectionId);
      expect(d.enrollment_id).toBeNull();
    });

    it("refuses a section on another campus", async () => {
      const [ada] = await sql`select id from ref.university where code = 'ADA'`;
      await expect(
        service.getClassDetail({ ...user, univId: ada!.id }, sectionId),
      ).rejects.toThrow();
    });
  });

  it("finds a course typed with plain ASCII instead of Azerbaijani letters", async () => {
    // A student types "verilenler" for "Verilənlər". Folding both sides is the
    // whole reason util.tsq/fold_text exist.
    const hits = await service.searchCourses(user, "verilenler");
    expect(hits.map((h) => h.code)).toContain("CS 214");
  });

  it("finds the same course by its real Azerbaijani spelling", async () => {
    const hits = await service.searchCourses(user, "Verilənlər");
    expect(hits.map((h) => h.code)).toContain("CS 214");
  });

  it("finds a course by code prefix", async () => {
    const hits = await service.searchCourses(user, "CS 2");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("leaks no BDU meetings to a caller scoped to another campus", async () => {
    // The pool is BYPASSRLS, so nothing filters this query but the query
    // itself. If the university predicate were ever dropped, this test is what
    // catches it — the same enrolled user, re-scoped to ADA, must see nothing.
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    const grid = await service.getWeekGrid({ ...user, univId: ada!.id });
    expect(grid).not.toBeNull();
    expect(grid!.meetings).toHaveLength(0);
  });

  it("leaks no BDU attendance to a caller scoped to another campus", async () => {
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    const rows = await service.getAttendance({ ...user, univId: ada!.id });
    expect(rows).toHaveLength(0);
  });

  it("leaks no BDU courses into another campus's catalogue search", async () => {
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    const hits = await service.searchCourses({ ...user, univId: ada!.id }, "verilenler");
    expect(hits).toHaveLength(0);
  });
});
