import { describe, expect, it } from "vitest";
import postgres from "postgres";
import { parseEnv } from "../src/config/env.schema";
import { AuthObjectsCheck } from "../src/common/auth/auth-objects.check";

/**
 * The gates that stop a misconfigured deployment from booting.
 *
 * Every failure these catch has the same symptom in production — a 401 on every
 * authenticated route — and none of them logs an error at the point it goes
 * wrong, because each layer is behaving correctly in isolation. The value is
 * entirely in failing early with a sentence that names the cause.
 */

/** A complete, valid environment. Each test breaks exactly one thing. */
function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pw@db.example.com:5432/postgres",
    DATABASE_URL_IDENTITY: "postgresql://svc:pw@db.example.com:5432/postgres",
    CREDENTIAL_PEPPER: "x".repeat(32),
    CURSOR_HMAC_SECRET: "y".repeat(32),
    SUPABASE_URL: "https://houicgsdduzzcarxkuuo.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "a-real-looking-service-role-key-value",
    IOS_STORE_URL: "https://apps.apple.com/az/app/kiksu/id000000000",
    ANDROID_STORE_URL: "https://play.google.com/store/apps/details?id=az.kiksu.mobile",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe("production environment gates", () => {
  it("accepts a well-formed production environment", () => {
    expect(() => parseEnv(baseEnv())).not.toThrow();
  });

  it("refuses to boot with the development auth bypass set", () => {
    // Pre-existing gate, asserted here so the new ones cannot displace it.
    expect(() =>
      parseEnv(baseEnv({ DEV_AUTH_APP_USER_ID: "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa" })),
    ).toThrow(/DEV_AUTH_APP_USER_ID/);
  });

  it("refuses to boot with the placeholder service-role key dev-api.sh writes", () => {
    // The realistic path to production is someone copying apps/api/.env, which
    // dev-api.sh regenerates with this literal on every run.
    expect(() =>
      parseEnv(baseEnv({ SUPABASE_SERVICE_ROLE_KEY: "dev-placeholder-service-role-key" })),
    ).toThrow(/development placeholder/);
  });

  it("refuses to boot with a non-https SUPABASE_URL", () => {
    // The JWT issuer check is derived from this value, so http here does not
    // merely weaken transport — it means no real token can ever verify.
    expect(() =>
      parseEnv(baseEnv({ SUPABASE_URL: "http://houicgsdduzzcarxkuuo.supabase.co" })),
    ).toThrow(/must be https/);
  });

  it("refuses to boot with SUPABASE_URL pointing at localhost", () => {
    expect(() => parseEnv(baseEnv({ SUPABASE_URL: "https://localhost:54321" }))).toThrow(
      /localhost/,
    );
  });

  it("leaves development environments alone", () => {
    // dev-api.sh writes exactly this combination on every run; gating it would
    // break the only workflow that does not need a real project.
    expect(() =>
      parseEnv(
        baseEnv({
          NODE_ENV: "development",
          SUPABASE_URL: "http://127.0.0.1:54321",
          SUPABASE_SERVICE_ROLE_KEY: "dev-placeholder-service-role-key",
          DEV_AUTH_APP_USER_ID: "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa",
        }),
      ),
    ).not.toThrow();
  });
});

const url = process.env.DATABASE_URL;
const dbSuite = url ? describe : describe.skip;

/**
 * Builds the check over a stubbed connection reporting exactly which objects
 * exist.
 *
 * The "missing" cases are stubbed rather than produced by dropping the real
 * function, which is what an earlier version of this file did. Vitest runs test
 * FILES in parallel against one shared database, so dropping
 * `auth_hooks.custom_access_token_hook` here made `token-claims.integration.spec.ts`
 * fail intermittently while it was gone — a self-inflicted flake, and exactly
 * the kind that gets blamed on the code under test rather than on the suite.
 * The real query still runs in the integration case below; only the branching
 * on its result is stubbed.
 */
function checkWith(
  present: { epoch: boolean; claims: boolean; hook: boolean },
  devBypass?: string,
) {
  const sql = Object.assign(async () => [present], {}) as never;
  return new AuthObjectsCheck({ sql } as never, { devAuthAppUserId: devBypass } as never);
}

const ALL_PRESENT = { epoch: true, claims: true, hook: true };

describe("access token object check", () => {
  it("passes when every object is present", async () => {
    await expect(checkWith(ALL_PRESENT).onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it("refuses to boot when the hook is missing, naming the object and the fix", async () => {
    // The symptom this prevents — every route answering token_invalid with no
    // error logged anywhere — points at nothing on its own, so the message has
    // to carry the diagnosis.
    await expect(
      checkWith({ ...ALL_PRESENT, hook: false }).onApplicationBootstrap(),
    ).rejects.toThrow(/custom_access_token_hook.*0021_auth_claims_hook\.sql/s);
  });

  it("refuses to boot when the claims projection is missing", async () => {
    await expect(
      checkWith({ ...ALL_PRESENT, claims: false }).onApplicationBootstrap(),
    ).rejects.toThrow(/internal\.token_claims/);
  });

  it("reports every missing object at once, not just the first", async () => {
    // A half-applied migration should produce one message listing all of it,
    // rather than three restarts each revealing one more object.
    await expect(
      checkWith({ epoch: false, claims: false, hook: false }).onApplicationBootstrap(),
    ).rejects.toThrow(/auth_epoch.*token_claims.*custom_access_token_hook/s);
  });

  it("tolerates missing objects under the development bypass", async () => {
    // The guard never reads a token there, so refusing to boot would break the
    // one workflow that does not need the hook at all.
    await expect(
      checkWith(
        { epoch: false, claims: false, hook: false },
        "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa",
      ).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});

dbSuite("access token object check (integration)", () => {
  it("finds every object against a database with migration 0021 applied", async () => {
    // Read-only, so it is safe to run in parallel with everything else. This is
    // what proves the query in findMissing() is actually correct; the stubbed
    // cases above only prove the branching on its result.
    const sql = postgres(url!, { prepare: false, onnotice: () => {} });
    try {
      const check = new AuthObjectsCheck({ sql } as never, { devAuthAppUserId: undefined } as never);
      await expect(check.onApplicationBootstrap()).resolves.toBeUndefined();
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
