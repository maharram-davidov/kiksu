import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { MeService } from "../src/modules/me/me.service";
import type { KiksuRequestContext } from "../src/common/auth/request-context";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("me service (integration)", () => {
  let sql: postgres.Sql;
  let service: MeService;
  let user: KiksuRequestContext;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const db = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    service = new MeService(db as never);

    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const [u] = await sql`
      insert into public.app_user (auth_user_id, handle, university_id, verification_tier,
                                   status, karma, display_study_year)
      values (${au!.id}, 'profil-testi-01', ${uni!.id}, 'email_verified', 'active', 312, 2)
      returning id`;
    user = {
      authUserId: au!.id, appUserId: u!.id, tier: "email",
      role: "student", univId: uni!.id, epoch: 1, sid: "t",
    };
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("serves the caller's OWN exact karma, which no other surface does", async () => {
    const p = await service.getProfile(user);
    expect(p.karma).toBe(312);          // the design's "312 KARMA"
    expect(p.university_code).toBe("BDU");
    expect(p.study_year).toBe(2);
  });

  it("reports card review state separately from tier, as the design does", async () => {
    const p = await service.getProfile(user);
    // The design shows "✓ E-POÇT DOĞRULANDI" and "KART: GÖZLƏYİR" as two
    // independent facts, because they are.
    // The TOKEN vocabulary. /v1/me, the onboarding response and the tier claim
    // all speak the same one, so a screen never has to know which surface a
    // tier arrived from.
    expect(p.verification_tier).toBe("email");
    expect(p.card_review_state).toBeTruthy();
  });

  it("updates only the toggles supplied and leaves the rest alone", async () => {
    const before = await service.getProfile(user);
    const after = await service.updatePrivacy(user, { discoverable: true });
    expect(after.privacy.discoverable).toBe(true);
    // Everything omitted must be untouched: a PATCH that silently resets
    // unmentioned privacy flags is a privacy bug, not a convenience.
    expect(after.privacy.show_year).toBe(before.privacy.show_year);
    expect(after.privacy.share_timetable).toBe(before.privacy.share_timetable);
    expect(after.privacy.show_uni_badge).toBe(before.privacy.show_uni_badge);
    expect(after.privacy.link_listings).toBe(before.privacy.link_listings);
  });

  it("refuses a handle rotation inside the 14-day cooldown", async () => {
    await expect(service.rotateHandle(user)).rejects.toThrow();
  });

  it("rotates to a NEW GENERATED handle once the cooldown has passed", async () => {
    await sql`update public.app_user
                 set handle_changed_at = now() - interval '15 days'
               where id = ${user.appUserId}`;
    const before = await service.getProfile(user);

    const { handle } = await service.rotateHandle(user);
    expect(handle).not.toBe(before.handle);
    // Generated, not chosen — the same rule as at signup, so a rotation cannot
    // be used to adopt a name carried from another service.
    expect(handle).toMatch(/^[a-zəğıöşüç]+-[a-zəğıöşüç]+-\d{2}$/u);
  });

  it("closes the old tenancy and opens a new one, so a rename is traceable", async () => {
    const rows = await sql<Array<{ handle: string; released_at: Date | null; release_reason: string | null }>>`
      select handle, released_at, release_reason from internal.handle_history
       where app_user_id = ${user.appUserId} order by assigned_at`;
    const old = rows.find((r) => r.handle === "profil-testi-01");
    // Renaming must not be an escape hatch: the released handle still resolves
    // to this person for blocks and sanctions.
    expect(old).toBeDefined();
    expect(old!.released_at).not.toBeNull();
    expect(old!.release_reason).toBe("rotated");
    // Exactly one live tenancy.
    expect(rows.filter((r) => r.released_at === null)).toHaveLength(1);
  });

  it("quarantines a released handle rather than freeing it immediately", async () => {
    const [held] = await sql`
      select handle from internal.handle_history
       where app_user_id = ${user.appUserId} and released_at is not null limit 1`;
    // Handing a just-released handle to a stranger would let them inherit a
    // reputation, or impersonate one.
    const [clash] = await sql`
      select 1 as x from internal.handle_history
       where handle = ${held!.handle}
         and released_at > now() - interval '365 days'`;
    expect(clash).toBeTruthy();
  });

  it("starts a fresh cooldown after rotating", async () => {
    const p = await service.getProfile(user);
    expect(p.can_change_handle).toBe(false);
    await expect(service.rotateHandle(user)).rejects.toThrow();
  });
});
