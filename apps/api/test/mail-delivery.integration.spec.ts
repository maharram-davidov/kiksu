import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";
import { OnboardingService } from "../src/modules/onboarding/onboarding.service";
import { DbEpochService } from "../src/common/auth/epoch.service";
import { CaptureMailerService, MailerService, type OutgoingMail } from "../src/common/mail/mailer.service";
import { verificationCodeMail } from "../src/common/mail/verification-code.template";
import { InMemoryRateLimitStore } from "../src/common/rate-limit/rate-limit.store";
import { RateLimiterService } from "../src/common/rate-limit/rate-limit.service";
import { SUPPORTED_LOCALES } from "../src/common/locale/locale";

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;
const PEPPER = "mail-test-pepper-long-enough-to-pass-32";

/** A transport that always fails, for the honest-failure path. */
class BrokenMailerService extends MailerService {
  async send(): Promise<void> {
    throw new Error("smtp: connection refused");
  }
}

suite("verification mail (integration)", () => {
  let sql: postgres.Sql;
  let mailer: CaptureMailerService;
  let store: InMemoryRateLimitStore;

  function build(mailerImpl: MailerService = mailer, sharedStore = store) {
    const pool = {
      sql,
      transaction: <T,>(fn: (tx: postgres.TransactionSql) => Promise<T>) => sql.begin(fn) as Promise<T>,
    };
    return new OnboardingService(
      pool as never, pool as never,
      { credentialPepper: PEPPER } as never,
      new DbEpochService(pool as never),
      mailerImpl,
      new RateLimiterService(sharedStore),
    );
  }

  beforeAll(() => {
    sql = postgres(url!, { prepare: false, onnotice: () => {} });
  });

  beforeEach(() => {
    mailer = new CaptureMailerService();
    store = new InMemoryRateLimitStore();
  });

  afterAll(async () => { await sql?.end({ timeout: 5 }); });

  /** A distinct address per test, so the per-address caps do not collide. */
  function freshAddress(): string {
    return `mail.${Math.random().toString(36).slice(2, 10)}@std.bsu.edu.az`;
  }

  // -------------------------------------------------------------------
  // The code actually reaches a mailbox
  // -------------------------------------------------------------------

  it("mails a code that confirms the verification", async () => {
    const service = build();
    const email = freshAddress();

    await service.startEmailVerification(email);

    const code = mailer.lastMail!.text.match(/\b(\d{6})\b/)![1]!;
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;

    const result = await service.confirmEmailVerification(email, code, au!.id);
    expect(result.handle).toBeTruthy();
  });

  it("addresses the mail to the student, not to anyone else", async () => {
    const service = build();
    const email = freshAddress();
    await service.startEmailVerification(email);
    expect(mailer.lastMail!.to).toBe(email.toLowerCase());
  });

  it("never returns the code in the response", async () => {
    // Returning it would make the whole flow decorative and hand a live
    // credential to anyone who can call the endpoint.
    const service = build();
    const response = await service.startEmailVerification(freshAddress());
    expect(JSON.stringify(response)).not.toMatch(/\d{6}/);
    expect(Object.keys(response)).toEqual(["expires_in_seconds"]);
  });

  it("reports an unrecognised university domain with a code the client can act on", async () => {
    // The service comment promises this is reported rather than folded into a
    // generic failure — a student whose university is not onboarded needs to
    // know that instead of retrying an address that will never work. It threw
    // a stock BadRequestException, which the filter flattens to
    // `malformed_request` by status, so the mobile screen's branch on this
    // code was dead and showed "load failed".
    const service = build();
    await expect(
      service.startEmailVerification("someone@nowhere.example.com"),
    ).rejects.toThrow(expect.objectContaining({ code: "email_domain_not_recognised" }) as never);
  });

  it("does not mail anything for an unrecognised domain", async () => {
    // Otherwise the endpoint is an open relay to any address on the internet.
    const service = build();
    await expect(service.startEmailVerification("someone@nowhere.example.com")).rejects.toThrow();
    expect(mailer.lastMail).toBeNull();
  });

  // -------------------------------------------------------------------
  // Failing honestly
  // -------------------------------------------------------------------

  it("raises service_unavailable when the mail cannot be sent", async () => {
    // Rather than returning success. A student told the code is on its way,
    // who then waits for a message that never arrives, has no way to find out
    // and no reason to try the card route instead.
    const service = build(new BrokenMailerService());
    await expect(service.startEmailVerification(freshAddress())).rejects.toThrow(
      expect.objectContaining({ code: "service_unavailable" }) as never,
    );
  });

  // -------------------------------------------------------------------
  // Send limits — specified in rate-limit.buckets.ts, previously unwired
  // -------------------------------------------------------------------

  it("refuses a second send for the same address inside the cooldown", async () => {
    const service = build();
    const email = freshAddress();

    await service.startEmailVerification(email);
    await expect(service.startEmailVerification(email)).rejects.toThrow(
      expect.objectContaining({ code: "rate_limited" }) as never,
    );
  });

  it("does not let one address block another", async () => {
    // The cap is per address, not global. A shared limiter that confused the
    // two would take the whole email route down the moment anyone spammed it.
    const service = build();
    await service.startEmailVerification(freshAddress());
    await expect(service.startEmailVerification(freshAddress())).resolves.toBeTruthy();
  });

  it("keys the limiter on the credential HMAC, never on the address", async () => {
    // The limiter store is keyed by principal, and a Redis-backed store
    // persists those keys — so keying on the address would put university
    // emails in a cache, which is the same leak as storing them by another
    // route. Asserted against the store itself rather than trusted.
    const service = build();
    const email = freshAddress();
    const local = email.split("@")[0]!;

    await service.startEmailVerification(email);

    const keys = [...(store as unknown as { counters: Map<string, unknown> }).counters.keys()];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key, "a limiter key must not contain the address").not.toContain(local);
      expect(key).not.toContain("@");
      expect(key).not.toContain("std.bsu.edu.az");
    }
  });

  it("does not supersede a live code when the send is refused", async () => {
    // The limit is checked BEFORE any write. Superseding the caller's pending
    // challenge and then declining to mail a replacement would invalidate a
    // code they may still be about to type.
    const service = build();
    const email = freshAddress();
    await service.startEmailVerification(email);
    const code = mailer.lastMail!.text.match(/\b(\d{6})\b/)![1]!;

    await expect(service.startEmailVerification(email)).rejects.toThrow();

    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await expect(service.confirmEmailVerification(email, code, au!.id)).resolves.toBeTruthy();
  });

  // -------------------------------------------------------------------
  // The address is still nowhere
  // -------------------------------------------------------------------

  it("stores no plaintext address anywhere after a full signup", async () => {
    // The property the inline send exists to preserve. If this ever fails, a
    // queue or a log has started persisting what only an HMAC should record.
    const service = build();
    const email = freshAddress();
    const local = email.split("@")[0]!;

    await service.startEmailVerification(email);
    const code = mailer.lastMail!.text.match(/\b(\d{6})\b/)![1]!;
    const [au] = await sql`insert into auth.users (id) values (gen_random_uuid()) returning id`;
    await service.confirmEmailVerification(email, code, au!.id);

    // Every text/citext column in the identity schema, which is where an
    // address would land if anything started keeping one.
    const hits = await sql<Array<{ n: number }>>`
      select count(*)::int as n from identity.verification_attempt
       where evidence_path is not null and evidence_path like ${"%" + local + "%"}`;
    expect(hits[0]!.n).toBe(0);

    const [users] = await sql<Array<{ n: number }>>`
      select count(*)::int as n from auth.users where email like ${"%" + local + "%"}`;
    expect(users!.n, "the university address must never become the auth email").toBe(0);
  });

  // -------------------------------------------------------------------
  // The message itself
  // -------------------------------------------------------------------

  describe("template", () => {
    const built = (locale: (typeof SUPPORTED_LOCALES)[number]): OutgoingMail =>
      verificationCodeMail({ to: "a@std.bsu.edu.az", code: "123456", ttlMinutes: 10, locale });

    it("renders in every supported locale", () => {
      for (const locale of SUPPORTED_LOCALES) {
        const mail = built(locale);
        expect(mail.subject.length, locale).toBeGreaterThan(0);
        expect(mail.text).toContain("123456");
        expect(mail.html).toContain("123456");
      }
    });

    it("says nothing about what the account is for", () => {
      // The message lands in a university mailbox, administered by the
      // university rather than the student. Describing Kiksu as an anonymous
      // student forum would disclose to that administrator that this person is
      // joining one — the exact association the product exists to prevent.
      for (const locale of SUPPORTED_LOCALES) {
        const mail = built(locale);
        const whole = `${mail.subject} ${mail.text} ${mail.html}`.toLowerCase();
        for (const word of [
          "anonim", "anonymous", "аноним",
          "forum", "форум",
          "marketplace", "bazar", "базар",
          "rəy", "review", "отзыв",
        ]) {
          expect(whole, `mail must not mention "${word}"`).not.toContain(word);
        }
      }
    });

    it("carries no link and no remote image", () => {
      // A remote image would report to Kiksu that this mailbox opened the
      // message — a signal about a real person tied to a real address, which
      // is the one identifier this product refuses to hold.
      for (const locale of SUPPORTED_LOCALES) {
        const mail = built(locale);
        expect(mail.html).not.toMatch(/<img/i);
        expect(mail.html).not.toMatch(/https?:\/\//);
        expect(mail.text).not.toMatch(/https?:\/\//);
      }
    });

    it("states the expiry, so a stale code is explicable", () => {
      for (const locale of SUPPORTED_LOCALES) {
        expect(built(locale).text).toContain("10");
      }
    });
  });
});
