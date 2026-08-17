import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { DbEpochService } from "../src/common/auth/epoch.service";
import {
  DB_TIERS,
  TOKEN_TIERS,
  UNREACHABLE_TOKEN_TIERS,
  dbTierToToken,
  tokenTierToDb,
  type DbTier,
} from "../src/common/auth/tier-vocabulary";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

/** A session id shaped like the one GoTrue puts in every real access token. */
const SID = "0193f2c1-b1c3-7d55-9f32-5a8b2e3c4d66";

suite("access token claims (integration)", () => {
  let sql: postgres.Sql;
  let epochs: DbEpochService;
  let uniId: string;

  /** Calls the hook the way Supabase Auth does and returns just `app_metadata`. */
  async function mint(
    authUserId: string,
    claims: Record<string, unknown> = { session_id: SID },
  ): Promise<Record<string, unknown>> {
    const [row] = await sql<Array<{ md: Record<string, unknown> }>>`
      select auth_hooks.custom_access_token_hook(
        jsonb_build_object('user_id', ${authUserId}::uuid,
                           'claims', ${sql.json(claims as never)}::jsonb)
      ) -> 'claims' -> 'app_metadata' as md`;
    return row!.md;
  }

  async function makeUser(opts: {
    tier: DbTier;
    status?: string;
    withUniversity?: boolean;
  }): Promise<{ authUserId: string; appUserId: string }> {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const handle = `token-test-${Math.random().toString(36).slice(2, 10)}`;
    const [u] = await sql`
      insert into public.app_user (auth_user_id, handle, university_id, verification_tier, status)
      values (${au!.id}, ${handle},
              ${opts.withUniversity === false ? null : uniId},
              ${opts.tier}::public.verification_tier,
              ${opts.status ?? "active"}::public.app_user_status)
      returning id`;
    return { authUserId: au!.id as string, appUserId: u!.id as string };
  }

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    epochs = new DbEpochService({ sql } as never);
    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    uniId = uni!.id as string;
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  // -------------------------------------------------------------------
  // The vocabulary mapping, and its SQL twin
  // -------------------------------------------------------------------

  it("maps every database tier to a token tier, in TypeScript and in SQL identically", async () => {
    // The TypeScript mapping is only safe if it agrees with internal.token_claims,
    // which is what actually stamps a live token. Assert against the real view
    // rather than restating the mapping a second time in the test.
    for (const dbTier of DB_TIERS) {
      const { authUserId } = await makeUser({ tier: dbTier });
      const md = await mint(authUserId);
      expect(md.tier, `db tier ${dbTier}`).toBe(dbTierToToken(dbTier));
    }
  });

  it("round-trips every reachable token tier back to its database value", () => {
    for (const dbTier of DB_TIERS) {
      expect(tokenTierToDb(dbTierToToken(dbTier))).toBe(dbTier);
    }
  });

  it("reports graduate and expired as unrepresentable rather than inventing a mapping", () => {
    // Nothing in the schema produces these: there is no graduation transition
    // and no credential-expiry job. Mapping them onto a status would silently
    // downgrade the badge of every suspended student.
    for (const tier of UNREACHABLE_TOKEN_TIERS) {
      expect(tokenTierToDb(tier)).toBeNull();
    }
    const reachable = TOKEN_TIERS.filter((t) => !UNREACHABLE_TOKEN_TIERS.includes(t as never));
    expect(reachable).toEqual(DB_TIERS.map(dbTierToToken));
  });

  // -------------------------------------------------------------------
  // Role mapping
  // -------------------------------------------------------------------

  it("collapses the four staff roles onto the token's three, with legal as a student", async () => {
    const { authUserId } = await makeUser({ tier: "email_verified" });
    const cases: Array<[string, string]> = [
      ["moderator", "moderator"],
      ["senior_moderator", "moderator"],
      ["admin", "admin"],
      // NOT 'moderator'. The token role gates moderation writes; legal work goes
      // through the sealed-store unseal path, which has its own authorisation.
      ["legal", "student"],
    ];
    for (const [staffRole, expected] of cases) {
      await sql`delete from moderation.staff where auth_user_id = ${authUserId}`;
      await sql`
        insert into moderation.staff (auth_user_id, display_name, role)
        values (${authUserId}, 'test', ${staffRole}::moderation.staff_role)`;
      const md = await mint(authUserId);
      expect(md.role, `staff role ${staffRole}`).toBe(expected);
    }
    await sql`delete from moderation.staff where auth_user_id = ${authUserId}`;
  });

  it("defaults to student when there is no staff row", async () => {
    const { authUserId } = await makeUser({ tier: "email_verified" });
    expect((await mint(authUserId)).role).toBe("student");
  });

  it("ignores a deactivated staff row rather than honouring a revoked moderator", async () => {
    const { authUserId } = await makeUser({ tier: "email_verified" });
    await sql`
      insert into moderation.staff (auth_user_id, display_name, role, is_active)
      values (${authUserId}, 'test', 'admin', false)`;
    expect((await mint(authUserId)).role).toBe("student");
  });

  // -------------------------------------------------------------------
  // What the token must never carry (identity spec §7.2)
  // -------------------------------------------------------------------

  it("emits exactly the six allowlisted claims and nothing identifying", async () => {
    const { authUserId } = await makeUser({ tier: "card_verified" });
    const md = await mint(authUserId);
    expect(Object.keys(md).sort()).toEqual(
      ["app_user_id", "epoch", "role", "sid", "tier", "univ_id"],
    );
    // Named individually because §7.2 names them: the handle is a rename oracle
    // and would land in every log that captures a bearer token; faculty and
    // entry year are exactly what the k-anonymity floor exists to generalise.
    for (const forbidden of ["handle", "email", "faculty", "entry_year", "study_year", "karma"]) {
      expect(md, `token must not carry ${forbidden}`).not.toHaveProperty(forbidden);
    }
  });

  it("preserves claims Supabase itself wrote into app_metadata", async () => {
    const { authUserId } = await makeUser({ tier: "email_verified" });
    const md = await mint(authUserId, {
      session_id: SID,
      app_metadata: { provider: "anonymous", providers: ["anonymous"] },
    });
    expect(md.provider).toBe("anonymous");
    expect(md.app_user_id).toBeTruthy();
  });

  // -------------------------------------------------------------------
  // Failing closed
  // -------------------------------------------------------------------

  it("strips the six keys for a caller with no app_user, rather than leaving stale ones", async () => {
    const [ghost] = await sql`select gen_random_uuid() as id`;
    const md = await mint(ghost!.id, {
      session_id: SID,
      // A stale claim block that would award the ANONİM KART badge if the hook
      // merely declined to write rather than actively removing.
      app_metadata: { provider: "anonymous", tier: "card", app_user_id: ghost!.id },
    });
    expect(md).toEqual({ provider: "anonymous" });
  });

  it("emits no claims when the mint carries no session_id", async () => {
    const { authUserId } = await makeUser({ tier: "email_verified" });
    // sid is not optional in the allowlist, so a block without it would fail the
    // parse anyway; fabricating one would corrupt the only session identifier
    // moderation has for targeted revocation.
    const md = await mint(authUserId, { app_metadata: { provider: "anonymous" } });
    expect(md).toEqual({ provider: "anonymous" });
  });

  it("emits no claims for an app_user with no university", async () => {
    // The schema's own default state — 'unverified' with a null university,
    // which app_user_tier_needs_uni permits. univ_id is required by the
    // allowlist, so emitting the row would produce token_invalid, whose client
    // action is "sign out": a signout loop the student could never escape.
    const { authUserId } = await makeUser({ tier: "unverified", withUniversity: false });
    expect(await mint(authUserId)).toEqual({});
  });

  it("emits no claims for an erased or deactivated account", async () => {
    for (const status of ["erased", "deactivated"]) {
      const { authUserId } = await makeUser({ tier: "email_verified", status });
      expect(await mint(authUserId), status).toEqual({});
    }
  });

  it("still issues claims to suspended and shadowbanned accounts, deliberately", async () => {
    // A suspended student has to be able to sign in to read why. A shadowbanned
    // one must not be able to detect the sanction by failing to authenticate.
    for (const status of ["suspended", "shadowbanned", "muted"]) {
      const { authUserId } = await makeUser({ tier: "email_verified", status });
      expect((await mint(authUserId)).tier, status).toBe("email");
    }
  });

  // -------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------

  it("raises the minted epoch when a user is bumped", async () => {
    const { authUserId, appUserId } = await makeUser({ tier: "email_verified" });
    const before = Number((await mint(authUserId)).epoch);

    await epochs.bump(appUserId, "ban");

    expect(Number((await mint(authUserId)).epoch)).toBeGreaterThan(before);
  });

  it("outranks the no-row fallback on the very first bump", async () => {
    // token_claims coalesces a missing epoch row to 1, so a bump that also
    // started at 1 would be a no-op and a ban would not revoke anything.
    const { appUserId } = await makeUser({ tier: "email_verified" });
    await sql`delete from internal.auth_epoch where app_user_id = ${appUserId}`;
    expect(await epochs.bump(appUserId, "suspension")).toBeGreaterThan(1);
  });

  it("serves the bumped value immediately rather than a cached one", async () => {
    // The cache is write-through on bump. If it merely expired, the instance
    // that just banned someone would keep authorising them for the TTL.
    const { appUserId } = await makeUser({ tier: "email_verified" });
    const before = await epochs.getCurrentEpoch(appUserId);
    const bumped = await epochs.bump(appUserId, "forced_logout");
    expect(await epochs.getCurrentEpoch(appUserId)).toBe(bumped);
    expect(bumped).toBeGreaterThan(before);
  });

  it("rejects a bump reason the database does not recognise", async () => {
    // The reason vocabulary is a check constraint, not a convention: a typo
    // would otherwise be a hole in the only record of why someone was logged out.
    const { appUserId } = await makeUser({ tier: "email_verified" });
    await expect(epochs.bump(appUserId, "vibes" as never)).rejects.toThrow();
  });
});
