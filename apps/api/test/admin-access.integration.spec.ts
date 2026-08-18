import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";
import { StaffGuard } from "../src/modules/admin/staff.guard";
import { EvidenceService } from "../src/modules/admin/evidence.service";
import { AdminService } from "../src/modules/admin/admin.service";
import { DbEpochService } from "../src/common/auth/epoch.service";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

suite("staff access and evidence handling (integration)", () => {
  let sql: postgres.Sql;
  let guard: StaffGuard;
  let uniId: string;

  beforeAll(async () => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
    guard = new StaffGuard({ sql } as never);
    const [uni] = await sql`select id from ref.university where code = 'BDU'`;
    uniId = uni!.id as string;
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  async function makeStaff(role = "moderator"): Promise<{ authUserId: string; staffId: string }> {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    const [s] = await sql`
      insert into moderation.staff (auth_user_id, display_name, role, is_active)
      values (${au!.id}, 'Test Staff', ${role}::moderation.staff_role, true)
      returning id`;
    return { authUserId: au!.id as string, staffId: s!.id as string };
  }

  function ctx(authUserId: string): Record<string, unknown> {
    return { kiksu: { authUserId, appUserId: "x", tier: "email", role: "student", univId: uniId, epoch: 1, sid: "t" } };
  }

  // -------------------------------------------------------------------
  // StaffGuard
  // -------------------------------------------------------------------

  it("admits an active staff member and attaches their scope", async () => {
    const { authUserId, staffId } = await makeStaff();
    const req = ctx(authUserId);

    expect(await guard.canActivate(makeContext(req))).toBe(true);
    expect((req.kiksuStaff as { id: string }).id).toBe(staffId);
  });

  it("answers not_found — not 500 — for a non-uuid auth subject", async () => {
    // THE BUG THIS FILE EXISTS FOR. The development bypass used to synthesise
    // `dev-auth-<uuid>` as the auth subject. moderation.staff.auth_user_id is a
    // uuid column, so Postgres raised and every admin route in development
    // answered 500 internal_error.
    //
    // A 500 is worse than a broken route here: this guard returns not_found
    // rather than forbidden precisely so an ordinary student cannot confirm an
    // admin surface exists at a path, and a 500 confirms it.
    await expect(
      guard.canActivate(makeContext(ctx("dev-auth-63a3ca9e-57b5-4c45-8d98-3d5fcee42633"))),
    ).rejects.toThrow(expect.objectContaining({ code: "not_found" }) as never);

    // The empty-string case too: that is what an unset DEV_AUTH_AUTH_USER_ID
    // produces, and it reached the same query.
    await expect(guard.canActivate(makeContext(ctx("")))).rejects.toThrow(
      expect.objectContaining({ code: "not_found" }) as never,
    );
  });

  it("answers not_found for a well-formed subject that is not staff", async () => {
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await expect(guard.canActivate(makeContext(ctx(au!.id)))).rejects.toThrow(
      expect.objectContaining({ code: "not_found" }) as never,
    );
  });

  it("answers not_found for a deactivated staff member, immediately", async () => {
    // The whole reason membership is a per-request lookup rather than a token
    // claim: revoking a moderator must take effect now, not at the next mint.
    const { authUserId } = await makeStaff();
    await sql`update moderation.staff set is_active = false where auth_user_id = ${authUserId}`;

    await expect(guard.canActivate(makeContext(ctx(authUserId)))).rejects.toThrow(
      expect.objectContaining({ code: "not_found" }) as never,
    );
  });

  it("answers not_found when there is no authenticated caller at all", async () => {
    await expect(guard.canActivate(makeContext({}))).rejects.toThrow(
      expect.objectContaining({ code: "not_found" }) as never,
    );
  });

  // -------------------------------------------------------------------
  // Evidence: the log is written before the URL is minted
  // -------------------------------------------------------------------

  describe("evidence access", () => {
    /**
     * The storage call is stubbed. What is under test is the ORDER and the
     * audit row, not Supabase's signing — and a test that reached real storage
     * would need a real bucket holding a real student card, which is precisely
     * the thing this code exists to keep scarce.
     */
    function makeEvidence(fetchImpl: typeof fetch) {
      const config = {
        supabaseUrl: "https://example.supabase.co",
        supabaseServiceRoleKey: "service-role-key-value-long-enough",
        supabaseEvidenceBucket: "verification-evidence",
      };
      vi.stubGlobal("fetch", fetchImpl);
      return new EvidenceService({ sql } as never, config as never);
    }

    async function makeAttempt(): Promise<{ attemptId: string; subjectId: string }> {
      const [subject] = await sql`
        insert into identity.subject (subject_key, key_version)
        values (extensions.gen_random_bytes(32), 1) returning id`;
      const [a] = await sql`
        insert into identity.verification_attempt
          (subject_id, university_id, method, state, evidence_path, sla_due_at)
        values (${subject!.id}, ${uniId}, 'student_card', 'in_review',
                'cards/' || encode(extensions.gen_random_bytes(16), 'hex') || '.jpg',
                now() + interval '24 hours')
        returning id`;
      return { attemptId: a!.id as string, subjectId: subject!.id as string };
    }

    it("writes the access log BEFORE minting, so a mint failure still leaves a record", async () => {
      const { attemptId, subjectId } = await makeAttempt();
      const { staffId } = await makeStaff();

      // Storage refuses. If the log were written after the mint, this look at a
      // student's ID document would go unrecorded — and an unrecorded look is
      // the failure mode identity spec §7.4's read-volume alarm cannot see.
      const evidence = makeEvidence(
        (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch,
      );

      await expect(evidence.signedUrlFor(attemptId, staffId)).rejects.toThrow();

      const [logged] = await sql<Array<{ n: number }>>`
        select count(*)::int as n from identity.access_log
         where subject_id = ${subjectId} and actor_ref = ${staffId}
           and purpose = 'verification'`;
      expect(logged!.n).toBe(1);
    });

    it("returns a short-lived url and logs the access", async () => {
      const { attemptId, subjectId } = await makeAttempt();
      const { staffId } = await makeStaff();

      const evidence = makeEvidence((async () => ({
        ok: true,
        json: async () => ({ signedURL: "/object/sign/verification-evidence/x.jpg?token=abc" }),
      })) as unknown as typeof fetch);

      const result = await evidence.signedUrlFor(attemptId, staffId);

      expect(result.url).toContain("token=abc");
      // Long enough to load an image, not to share one.
      expect(result.expires_in_seconds).toBeLessThanOrEqual(60);

      const [logged] = await sql<Array<{ purpose: string; function_name: string }>>`
        select purpose::text, function_name from identity.access_log
         where subject_id = ${subjectId} and actor_ref = ${staffId}`;
      expect(logged!.purpose).toBe("verification");
      expect(logged!.function_name).toBe("admin.evidence.signed_url");
    });

    it("refuses an attempt whose evidence has already been cleared", async () => {
      // evidence_path is nulled on decision so the sweeper can delete the file.
      // Asking for one is asking for something that should already be gone.
      const { attemptId } = await makeAttempt();
      const { staffId } = await makeStaff();
      await sql`update identity.verification_attempt set evidence_path = null where id = ${attemptId}`;

      const evidence = makeEvidence((async () => {
        throw new Error("storage must not be called");
      }) as unknown as typeof fetch);

      await expect(evidence.signedUrlFor(attemptId, staffId)).rejects.toThrow();
    });

    it("does not log an access for an attempt that does not exist", async () => {
      // Logging a lookup of a nonexistent id would let anyone with staff
      // access pad the audit trail with noise, which is how a real access gets
      // lost in it.
      const { staffId } = await makeStaff();
      const evidence = makeEvidence((async () => {
        throw new Error("storage must not be called");
      }) as unknown as typeof fetch);

      const [before] = await sql<Array<{ n: number }>>`
        select count(*)::int as n from identity.access_log where actor_ref = ${staffId}`;
      await expect(
        evidence.signedUrlFor("00000000-0000-4000-8000-000000000000", staffId),
      ).rejects.toThrow();
      const [after] = await sql<Array<{ n: number }>>`
        select count(*)::int as n from identity.access_log where actor_ref = ${staffId}`;

      expect(after!.n).toBe(before!.n);
    });

    it("keeps the access log append-only", async () => {
      // Enforced by trigger. A moderator who could delete their own audit row
      // would make the whole log decorative.
      const { attemptId, subjectId } = await makeAttempt();
      const { staffId } = await makeStaff();
      const evidence = makeEvidence((async () => ({
        ok: true, json: async () => ({ signedURL: "/x?token=t" }),
      })) as unknown as typeof fetch);
      await evidence.signedUrlFor(attemptId, staffId);

      await expect(
        sql`delete from identity.access_log where subject_id = ${subjectId}`,
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------
  // T4: what a moderator may see
  // -------------------------------------------------------------------

  it("never puts an author in the moderation queue payload", async () => {
    // Identity spec T4(e): moderators never see handle, karma, post count,
    // university, or any other case. The queue references content ids only;
    // author resolution would have to go through a case-scoped resolver that
    // does not exist. This asserts the payload so nobody "helpfully" adds one.
    const db = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    const admin = new AdminService(db as never, db as never, new DbEpochService(db as never));

    const cases = await admin.moderationQueue(null);
    for (const c of cases) {
      for (const forbidden of [
        "author", "author_app_user_id", "app_user_id", "handle",
        "karma", "alias", "university_id", "post_count",
      ]) {
        expect(c, `moderation case must not carry ${forbidden}`).not.toHaveProperty(forbidden);
      }
    }
  });
});
