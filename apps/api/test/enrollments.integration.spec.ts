import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { EnrollmentsService } from "../src/modules/timetable/enrollments.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

/**
 * Run via `scripts/test-integration.sh`.
 *
 * Two properties carry most of the weight here. **Own-row**: the pool is
 * BYPASSRLS, so every predicate in the service is the only thing standing
 * between one student and another's timetable — and a timetable is a movement
 * profile, not a preference list. **Soft drop**: dropping must not erase
 * absence history, because on a course where twelve absences bar you from the
 * exam, drop-and-re-add would otherwise be a way to reset the counter.
 */
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("enrollments service (integration)", () => {
  let sql: postgres.Sql;
  let service: EnrollmentsService;
  let user: KiksuRequestContext;
  let otherUser: KiksuRequestContext;
  let bduId: string;
  let sectionIds: string[] = [];
  let foreignSectionId: string | null = null;

  const mk = (appUserId: string, univId: string): KiksuRequestContext => ({
    authUserId: "00000000-0000-4000-8000-00000000000a",
    appUserId,
    tier: "email",
    role: "student",
    univId,
    epoch: 1,
    sid: "00000000-0000-4000-8000-00000000000b",
  } as KiksuRequestContext);

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    service = new EnrollmentsService({ sql } as never);

    const [bdu] = await sql`select id from ref.university where code = 'BDU'`;
    const [other] = await sql`select id from ref.university where code <> 'BDU' limit 1`;
    bduId = bdu!.id as string;

    const mkUser = async (handle: string, univId: string) => {
      const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
      const [u] = await sql`
        insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
        values (${au!.id as string}, ${handle}, ${univId}, 'email_verified', 'active')
        returning id`;
      return u!.id as string;
    };
    user = mk(await mkUser("enrol-test-oxucu-01", bduId), bduId);
    otherUser = mk(await mkUser("enrol-test-oxucu-02", other!.id as string), other!.id as string);

    const sections = await sql`
      select s.id from ref.course_section s
        join ref.course c on c.id = s.course_id
        join ref.term t on t.id = s.term_id
       where c.university_id = ${bduId} and t.is_current
       limit 3`;
    sectionIds = sections.map((r) => r.id as string);
    if (sectionIds.length < 2) throw new Error("seed missing: BDU sections in the current term");

    const [foreign] = await sql`
      select s.id from ref.course_section s
        join ref.course c on c.id = s.course_id
       where c.university_id <> ${bduId} limit 1`;
    foreignSectionId = (foreign?.id as string) ?? null;
  });

  beforeEach(async () => {
    await sql`delete from public.enrollment where app_user_id in (${user.appUserId}::uuid, ${otherUser.appUserId}::uuid)`;
  });

  afterAll(async () => {
    await sql`delete from public.enrollment where app_user_id in (${user.appUserId}::uuid, ${otherUser.appUserId}::uuid)`;
    await sql`delete from public.app_user where handle like 'enrol-test-%'`;
    await sql?.end({ timeout: 5 });
  });

  it("adds a section and returns it in the list", async () => {
    const created = await service.create(user, { section_id: sectionIds[0]! });
    expect(created.state).toBe("enrolled");
    expect(created.course.code).toBeTruthy();

    const list = await service.list(user);
    expect(list.map((e) => e.id)).toContain(created.id);
  });

  it("defaults the colour to turquoise and honours an explicit one", async () => {
    const a = await service.create(user, { section_id: sectionIds[0]! });
    expect(a.color).toBe("turquoise");

    await service.drop(user, a.id);
    const b = await service.create(user, { section_id: sectionIds[0]!, color: "pomegranate" });
    expect(b.color).toBe("pomegranate");
  });

  it("recolours through update", async () => {
    const e = await service.create(user, { section_id: sectionIds[0]! });
    const updated = await service.update(user, e.id, { color: "moss" });
    expect(updated.color).toBe("moss");
    expect(updated.id).toBe(e.id);
  });

  it("refuses a second add of the same section", async () => {
    await service.create(user, { section_id: sectionIds[0]! });
    await expect(service.create(user, { section_id: sectionIds[0]! }))
      .rejects.toMatchObject({ code: "already_enrolled" });
  });

  it("refuses a section belonging to another university", async () => {
    if (!foreignSectionId) return;
    // Deliberately the same 404 as a nonexistent section: a distinguishable
    // error would confirm another campus's catalogue exists.
    await expect(service.create(user, { section_id: foreignSectionId }))
      .rejects.toThrow(/section_not_found/);
  });

  // ----------------------------------------------------------------
  // Soft drop
  // ----------------------------------------------------------------

  it("drops without deleting the row, and hides it from the default list", async () => {
    const e = await service.create(user, { section_id: sectionIds[0]! });
    await service.drop(user, e.id);

    expect((await service.list(user)).map((x) => x.id)).not.toContain(e.id);

    const all = await service.list(user, undefined, "all");
    const found = all.find((x) => x.id === e.id);
    expect(found).toBeDefined();
    expect(found!.state).toBe("dropped");

    const [row] = await sql`select state::text from public.enrollment where id = ${e.id}::uuid`;
    expect(row!.state).toBe("dropped");
  });

  it("drops exactly one row and leaves every sibling enrolled", async () => {
    // Added after an ad-hoc simulator session ended with four enrollments in
    // `dropped` when only one had been dropped. That was never reproduced and
    // may well have been my own stray requests, but "a drop that touches rows
    // it was not given" is precisely the failure that would be invisible until
    // a student lost half a timetable, so it is pinned here rather than
    // reasoned about.
    const created = [];
    for (const id of sectionIds) created.push(await service.create(user, { section_id: id }));
    expect(created.length).toBeGreaterThanOrEqual(2);

    await service.drop(user, created[0]!.id);

    const after = await service.list(user, undefined, "all");
    const byId = new Map(after.map((e) => [e.id, e.state]));
    expect(byId.get(created[0]!.id)).toBe("dropped");
    for (const e of created.slice(1)) {
      expect(byId.get(e.id)).toBe("enrolled");
    }
  });

  it("preserves absence history across a drop and re-add", async () => {
    // The reason drop is soft. On a course where twelve absences bar you from
    // the exam, a hard delete would make drop-and-re-add a way to launder the
    // counter back to zero.
    const e = await service.create(user, { section_id: sectionIds[0]! });
    await sql`update public.enrollment set absence_count = 4, absence_units = 4 where id = ${e.id}::uuid`;

    await service.drop(user, e.id);
    const readded = await service.create(user, { section_id: sectionIds[0]! });

    expect(readded.id).toBe(e.id); // the same row, revived
    const [row] = await sql`select absence_count from public.enrollment where id = ${e.id}::uuid`;
    expect(Number(row!.absence_count)).toBe(4);
  });

  it("allows re-adding a dropped section", async () => {
    const e = await service.create(user, { section_id: sectionIds[0]! });
    await service.drop(user, e.id);
    const again = await service.create(user, { section_id: sectionIds[0]! });
    expect(again.state).toBe("enrolled");
    expect((await service.list(user)).map((x) => x.id)).toContain(e.id);
  });

  // ----------------------------------------------------------------
  // Own-row isolation — the pool is BYPASSRLS
  // ----------------------------------------------------------------

  it("never lists another student's enrollments", async () => {
    const mine = await service.create(user, { section_id: sectionIds[0]! });
    const theirs = await service.list(otherUser);
    expect(theirs.map((e) => e.id)).not.toContain(mine.id);
  });

  it("refuses to update another student's enrollment", async () => {
    const mine = await service.create(user, { section_id: sectionIds[0]! });
    await expect(service.update(otherUser, mine.id, { color: "ink" }))
      .rejects.toThrow(/enrollment_not_found/);
    const [row] = await sql`select color::text from public.enrollment where id = ${mine.id}::uuid`;
    expect(row!.color).toBe("turquoise");
  });

  it("refuses to drop another student's enrollment", async () => {
    const mine = await service.create(user, { section_id: sectionIds[0]! });
    await expect(service.drop(otherUser, mine.id)).rejects.toThrow(/enrollment_not_found/);
    const [row] = await sql`select state::text from public.enrollment where id = ${mine.id}::uuid`;
    expect(row!.state).toBe("enrolled");
  });

  it("carries no field naming another user", async () => {
    const e = await service.create(user, { section_id: sectionIds[0]! });
    const body = JSON.stringify(e);
    expect(body).not.toContain("app_user_id");
    expect(body).not.toContain(user.appUserId);
    expect(e).not.toHaveProperty("handle");
  });

  // ----------------------------------------------------------------
  // Capacity and term window
  // ----------------------------------------------------------------

  it("refuses a full section", async () => {
    const section = sectionIds[1]!;
    const [before] = await sql`select capacity from ref.course_section where id = ${section}::uuid`;
    const [taken] = await sql`
      select count(*)::int as n from public.enrollment
       where section_id = ${section}::uuid and state = 'enrolled'`;
    await sql`update ref.course_section set capacity = ${Number(taken!.n)} where id = ${section}::uuid`;
    try {
      await expect(service.create(user, { section_id: section }))
        .rejects.toMatchObject({ code: "section_full" });
    } finally {
      await sql`update ref.course_section set capacity = ${before!.capacity as number | null} where id = ${section}::uuid`;
    }
  });

  it("refuses to add once the add/drop window has closed", async () => {
    const [term] = await sql`select id, add_drop_ends_on from ref.term where is_current and university_id = ${bduId}`;
    const original = term!.add_drop_ends_on as Date | null;
    await sql`update ref.term set add_drop_ends_on = current_date - 1 where id = ${term!.id as string}::uuid`;
    try {
      await expect(service.create(user, { section_id: sectionIds[0]! }))
        .rejects.toMatchObject({ code: "term_closed" });
    } finally {
      await sql`update ref.term set add_drop_ends_on = ${original} where id = ${term!.id as string}::uuid`;
    }
  });

  it("treats a term with no add/drop deadline as open", async () => {
    const [term] = await sql`select id, add_drop_ends_on from ref.term where is_current and university_id = ${bduId}`;
    const original = term!.add_drop_ends_on as Date | null;
    await sql`update ref.term set add_drop_ends_on = null where id = ${term!.id as string}::uuid`;
    try {
      const e = await service.create(user, { section_id: sectionIds[0]! });
      expect(e.state).toBe("enrolled");
    } finally {
      await sql`update ref.term set add_drop_ends_on = ${original} where id = ${term!.id as string}::uuid`;
    }
  });
});
