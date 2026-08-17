import { describe, expect, it, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { OnboardingService } from "../src/modules/onboarding/onboarding.service";

/**
 * Run via `scripts/test-integration.sh`.
 *
 * These use ONE connection for both pools, which production forbids — see
 * IdentitySqlProvider. That is acceptable here precisely because the thing
 * under test is the flow's logic, not the grant boundary; the boundary itself
 * is asserted by invariant 1 in scripts/schema-invariants.sql, which runs
 * against the real grants.
 */
const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const PEPPER = "integration-test-pepper-long-enough-32+";

suite("onboarding (integration)", () => {
  let sql: postgres.Sql;
  let service: OnboardingService;

  beforeAll(() => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    const pool = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) =>
        sql.begin(fn) as Promise<T>,
    };
    service = new OnboardingService(
      pool as never, pool as never,
      { credentialPepper: PEPPER } as never,
    );
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  it("lists universities with the sample address the design renders", async () => {
    const unis = await service.listUniversities();
    const bdu = unis.find((u) => u.code === "BDU");
    expect(bdu).toBeDefined();
    expect(bdu!.name).toBe("Bakı Dövlət Universiteti");
    expect(bdu!.email_sample).toBe("ad.soyad@std.bsu.edu.az");
  });

  it("rejects a domain no university owns", async () => {
    await expect(service.startEmailVerification("someone@gmail.com")).rejects.toThrow();
  });

  it("accepts a recognised university domain", async () => {
    const res = await service.startEmailVerification("ilkin.aliyev@std.bsu.edu.az");
    expect(res.expires_in_seconds).toBe(600);
  });

  it("never stores the code itself, only its HMAC", async () => {
    await service.startEmailVerification("gizli.kod@std.bsu.edu.az");
    const code = service.pendingCodeForDevelopment!;
    const rows = await sql`
      select challenge_hmac::text as h from identity.verification_attempt
       where state = 'pending'`;
    for (const r of rows) expect(r.h).not.toContain(code);
  });

  it("provisions a generated handle on a correct code", async () => {
    const email = "yeni.telebe@std.bsu.edu.az";
    await service.startEmailVerification(email);
    const code = service.pendingCodeForDevelopment!;
    const [authUser] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;

    const result = await service.confirmEmailVerification(email, code, authUser!.id);
    expect(result.tier).toBe("email_verified");
    // Generated, never chosen: adjective-noun-number.
    expect(result.handle).toMatch(/^[a-zəğıöşüç]+-[a-zəğıöşüç]+-\d{2}$/u);
  });

  it("rejects a wrong code", async () => {
    const email = "sehv.kod@std.bsu.edu.az";
    await service.startEmailVerification(email);
    const [authUser] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await expect(
      service.confirmEmailVerification(email, "000000", authUser!.id),
    ).rejects.toThrow();
  });

  it("invalidates the previous code when a new one is requested", async () => {
    const email = "tekrar@std.bsu.edu.az";
    await service.startEmailVerification(email);
    const firstCode = service.pendingCodeForDevelopment!;
    await service.startEmailVerification(email);   // supersedes
    const [authUser] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await expect(
      service.confirmEmailVerification(email, firstCode, authUser!.id),
    ).rejects.toThrow();
  });

  it("treats an Azerbaijani-cased address as the same credential", async () => {
    // The dotted/dotless i again, this time end to end: a student whose phone
    // uppercases differently must still land on the same verification attempt.
    const email = "ilkin.test@std.bsu.edu.az";
    await service.startEmailVerification(email);
    const code = service.pendingCodeForDevelopment!;
    const [authUser] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const result = await service.confirmEmailVerification(
      "İLKİN.TEST@std.bsu.edu.az", code, authUser!.id,
    );
    expect(result.tier).toBe("email_verified");
  });

  it("mints a dev auth subject that a confirm can bind to", async () => {
    const { auth_user_id } = await service.createDevAuthSubject();
    expect(auth_user_id).toMatch(/^[0-9a-f-]{36}$/);
    const [row] = await sql`select id from auth.users where id = ${auth_user_id}`;
    expect(row).toBeTruthy();
  });

  it("keeps the sealed link out of the public schema entirely", async () => {
    const email = "sizinti.yoxlamasi@std.bsu.edu.az";
    await service.startEmailVerification(email);
    const code = service.pendingCodeForDevelopment!;
    const [authUser] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const { app_user_id } = await service.confirmEmailVerification(email, code, authUser!.id);

    // Nothing in public.app_user records which subject this came from.
    const [row] = await sql`select * from public.app_user where id = ${app_user_id}`;
    expect(Object.keys(row!)).not.toContain("subject_id");
    // The link exists, but only inside identity.
    const [link] = await sql`select subject_id from identity.app_user_link
                              where app_user_id = ${app_user_id}`;
    expect(link!.subject_id).toBeTruthy();
  });
});
