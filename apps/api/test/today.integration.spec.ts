import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { TodayService } from "../src/modules/today/today.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("today service (integration)", () => {
  let sql: postgres.Sql;
  let service: TodayService;
  let user: KiksuRequestContext;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    service = new TodayService({ sql } as never);

    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    if (!uni) throw new Error("seed missing: BDU");
    const [authUser] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    if (!authUser) throw new Error("failed to create auth user");
    const [appUser] = await sql`
      insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
      values (${authUser.id}, 'today-test-oxucu-02', ${uni.id}, 'email_verified', 'active')
      returning id`;
    if (!appUser) throw new Error("failed to create app_user");
    await sql`
      insert into public.enrollment (app_user_id, section_id, term_id, state)
      select ${appUser.id}, s.id, s.term_id, 'enrolled'
        from ref.course_section s join ref.course c on c.id = s.course_id
       where c.university_id = ${uni.id}`;

    user = {
      authUserId: authUser.id, appUserId: appUser.id, tier: "email",
      role: "student", univId: uni.id, epoch: 1, sid: "test",
    };
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("reports the date and weekday in the UNIVERSITY's timezone", async () => {
    const today = await service.getToday(user);
    expect(today.timezone).toBe("Asia/Baku");
    // Whatever the server's own clock is set to, the answer must agree with
    // Baku. Computing this in the server's zone would break the moment the API
    // is deployed outside Azerbaijan.
    const bakuNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Baku" }));
    const expectedIsoDow = bakuNow.getDay() === 0 ? 7 : bakuNow.getDay();
    expect(today.weekday).toBe(expectedIsoDow);
  });

  it("returns only classes that have not finished yet", async () => {
    const today = await service.getToday(user);
    // Everything returned must still be running or yet to start; a class that
    // ended an hour ago is not what the landing screen should lead with.
    for (const c of today.remaining_classes) {
      const ended = c.starts_in_minutes < 0 && !c.is_in_progress;
      expect(ended).toBe(false);
    }
  });

  it("marks a class as in progress only while it is actually running", async () => {
    const today = await service.getToday(user);
    for (const c of today.remaining_classes) {
      if (c.is_in_progress) expect(c.starts_in_minutes).toBeLessThanOrEqual(0);
      else expect(c.starts_in_minutes).toBeGreaterThan(0);
    }
  });

  it("surfaces campus hot posts ranked by score", async () => {
    const today = await service.getToday(user);
    expect(today.hot_posts.length).toBeGreaterThan(0);
    const scores = today.hot_posts.map((p) => p.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("leaks no other campus's posts into the hot list", async () => {
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    const today = await service.getToday({ ...user, univId: ada!.id });
    // ADA has no campus boards seeded, so anything here must be national.
    const slugs = today.hot_posts.map((p) => p.board_slug);
    expect(slugs.every((s) => !s.startsWith("bdu-"))).toBe(true);
  });

  it("leaks no other campus's classes", async () => {
    const [ada] = await sql`select id from ref.university where code = 'ADA'`;
    const today = await service.getToday({ ...user, univId: ada!.id });
    expect(today.remaining_classes).toHaveLength(0);
  });
});
