import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { EpochService } from "../../common/auth/epoch.service";
import { MailerService } from "../../common/mail/mailer.service";
import { verificationCodeMail } from "../../common/mail/verification-code.template";
import { DEFAULT_LOCALE, type Locale } from "../../common/locale/locale";
import { FIXED_BUCKETS } from "../../common/rate-limit/rate-limit.buckets";
import { RateLimiterService } from "../../common/rate-limit/rate-limit.service";
import { dbTierToToken, type TokenTier } from "../../common/auth/tier-vocabulary";
import { IdentitySqlProvider } from "../../common/db/identity-sql.provider";
import { SqlProvider } from "../../common/db/sql.provider";
import { ConfigService } from "../../config/config.service";
import { AppError } from "../../common/errors/app-error";
import {
  CREDENTIAL_KEY_VERSION, hashChallenge, hashCredentialBytes, normaliseCredential,
} from "./credential-hash";
import { generateHandle } from "./handle-generator";

export interface UniversityDto {
  id: string;
  code: string;
  name: string;
  city: string;
  /** e.g. "ad.soyad@std.bsu.edu.az" — rendered on the onboarding screen. */
  email_sample: string | null;
  routes: string[];
}

/** OTP lifetime. Short enough to limit brute force, long enough to switch apps. */
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly db: SqlProvider,
    private readonly identity: IdentitySqlProvider,
    private readonly config: ConfigService,
    private readonly epochs: EpochService,
    private readonly mailer: MailerService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  /**
   * The send limits from `rate-limit.buckets.ts`, applied.
   *
   * They were specified there and never wired — the file's own comment says
   * the bookkeeping "doesn't exist in this scaffold". That was harmless while
   * nothing was sent. With real delivery it is an email-bombing vector:
   * without these, anyone can make Kiksu mail any address on a known
   * university domain without limit, and every bounce lands on Kiksu's own
   * sending reputation, which is the asset that makes the email route work at
   * all.
   *
   * THE PRINCIPAL KEY IS THE CREDENTIAL HMAC, NOT THE ADDRESS. The limiter
   * store is keyed by principal, and a Redis-backed store persists those keys
   * — so keying on the address would put university emails in a cache, which
   * is the same leak as storing them, by a different route. The HMAC is
   * already this product's non-reversible identifier for an address, so it is
   * both the correct key and free.
   */
  private async enforceSendLimits(credentialHmac: Buffer): Promise<void> {
    const principalKey = credentialHmac.toString("hex");

    for (const bucket of [
      FIXED_BUCKETS["auth.otp.send.cooldown"],
      FIXED_BUCKETS["auth.otp.send.hourly"],
      FIXED_BUCKETS["auth.otp.send.daily"],
    ]) {
      const decision = await this.rateLimiter.consumeFixed({
        bucketName: bucket.name,
        policyName: bucket.name,
        principalKey,
        limit: bucket.limit,
        windowSeconds: bucket.windowSeconds,
      });
      if (!decision.allowed) {
        throw new AppError("rate_limited", {
          details: { retry_after_seconds: decision.resetSeconds },
        });
      }
    }
  }

  /** Public: the university picker, before the caller has any identity. */
  async listUniversities(): Promise<UniversityDto[]> {
    return this.db.sql<UniversityDto[]>`
      select u.id, u.code, u.name_az as name, u.city_az as city,
             (select d.sample_pattern from ref.university_email_domain d
               where d.university_id = u.id and d.audience = 'student'
                 and d.is_active order by d.is_primary desc limit 1) as email_sample,
             coalesce(
               (select array_agg(r.method::text order by r.method)
                  from ref.university_verification_route r
                 where r.university_id = u.id and r.is_enabled),
               '{}'
             ) as routes
        from ref.university u
       where u.is_active
       order by u.name_az
    `;
  }

  /**
   * Starts university-email verification.
   *
   * The response is deliberately identical whether or not the address is
   * already registered. Differentiating would turn this endpoint into an
   * oracle for "does this student have a Kiksu account", which is a
   * de-anonymisation primitive: an attacker who knows a classmate's university
   * email could confirm their membership.
   */
  async startEmailVerification(
    email: string,
    locale: Locale = DEFAULT_LOCALE,
  ): Promise<{ expires_in_seconds: number }> {
    const normalised = normaliseCredential(email);
    const domain = normalised.split("@")[1] ?? "";

    const [match] = await this.db.sql<Array<{ university_id: string }>>`
      select university_id from ref.university_email_domain
       where domain = ${domain}::extensions.citext
         and audience = 'student' and is_active
       limit 1
    `;
    // An unknown domain IS reported, unlike an existing account: the student
    // needs to know their university is not onboarded yet, and the domain is
    // not personal information.
    // AppError, not BadRequestException. A stock Nest exception is flattened
    // by the filter to `malformed_request` by status — the message is never
    // passed through — so the specific code this comment promises never
    // reached the client, and the mobile screen's branch on it was dead code
    // showing a generic failure instead.
    if (!match) throw new AppError("email_domain_not_recognised");

    const code = String(randomInt(100_000, 1_000_000));
    const pepper = this.config.credentialPepper;

    const credentialHmac = hashCredentialBytes("university_email", normalised, pepper);

    // Before any write. A refused send should leave no trace: superseding the
    // caller's live challenge and then declining to mail a new one would
    // invalidate a code they may still be about to type.
    await this.enforceSendLimits(credentialHmac);

    await this.identity.transaction(async (tx) => {
      // The subject is the stable handle for one verified human. It is created
      // (or found) from the credential BEFORE the attempt, because the attempt
      // references it — one person can make many attempts, and they must all
      // resolve to the same subject or one-person-one-account stops meaning
      // anything.
      const [subject] = await tx<Array<{ id: string }>>`
        insert into identity.subject (subject_key, key_version)
        values (${credentialHmac}, ${CREDENTIAL_KEY_VERSION})
        on conflict (subject_key) do update set updated_at = now()
        returning id
      `;
      if (!subject) throw new BadRequestException("verification_failed");

      // Supersede any live challenge so a second request invalidates the first
      // rather than leaving two valid codes in flight.
      await tx`
        update identity.verification_attempt
           set state = 'expired', updated_at = now()
         where subject_id = ${subject.id} and state = 'pending'
      `;
      await tx`
        insert into identity.verification_attempt
          (subject_id, university_id, method, state, challenge_hmac,
           challenge_expires_at, attempt_count)
        values (${subject.id}, ${match.university_id}, 'university_email', 'pending',
                ${hashChallenge(code, pepper)},
                now() + ${`${OTP_TTL_MINUTES} minutes`}::interval, 0)
      `;
    });

    // Sent INLINE, inside the request that carries the address.
    //
    // This cannot become a queued job without changing what the product
    // stores: the address is nowhere in the database — only its HMAC is — so a
    // worker picking this up later would need it persisted, which would put a
    // real student email in a table for the first time. The cost of inline is
    // that this endpoint is as available as the mail provider. That is the
    // right trade.
    //
    // The code is never returned in the response. Doing so would make the
    // whole flow decorative and hand a credential to anyone who can call the
    // endpoint. It is logged only behind the development gate — the same one
    // that guards the auth bypass, which parseEnv() refuses to boot with in
    // production.
    if (this.config.devAuthAppUserId) {
      this.logger.warn(`DEV OTP ${code} for ${normalised} — development only`);
    }

    try {
      await this.mailer.send(
        verificationCodeMail({
          to: normalised,
          code,
          ttlMinutes: OTP_TTL_MINUTES,
          locale,
        }),
      );
    } catch (err) {
      // Fail honestly rather than returning success. A student who is told the
      // code is on its way, and then waits for a message that will never
      // arrive, has no way to find out and no reason to try the card route
      // instead. This leaks nothing new either: the endpoint already reports
      // an unrecognised domain, so it was never an account-existence oracle.
      this.logger.error(`verification mail failed to send: ${String(err)}`);
      throw new AppError("service_unavailable", { cause: err });
    }

    return { expires_in_seconds: OTP_TTL_MINUTES * 60 };
  }

  /**
   * Submits a student card for manual review.
   *
   * Deliberately does NOT verify anyone. It records an attempt in `in_review`
   * with an SLA deadline and returns; a human decides. The design promises
   * "24 saata qədər", and `sla_due_at` is what makes that promise measurable
   * rather than decorative — a queue with no deadline column cannot be audited
   * against the thing the app told a student.
   *
   * The image itself never passes through this service. The client uploads to
   * a private bucket and submits the resulting path plus a content hash, so a
   * swapped file after submission is detectable. `evidence_purge_at` carries
   * the deletion deadline: an identity document is the most sensitive thing
   * Kiksu will ever hold, and holding it past a decision has no upside.
   */
  async submitCardVerification(
    universityId: string, authUserId: string, evidencePath: string, evidenceSha256: string,
  ): Promise<{ state: string; sla_due_at: string }> {
    const pepper = this.config.credentialPepper;

    const [route] = await this.db.sql<Array<{ sla_minutes: number }>>`
      select sla_minutes from ref.university_verification_route
       where university_id = ${universityId}
         and method = 'student_card'
         and is_enabled
    `;
    if (!route) throw new BadRequestException("verification_route_unavailable");

    return this.identity.transaction(async (tx) => {
      // The subject key for a card is the auth subject, not the card number:
      // card numbers are not yet parsed at submission time, and binding the
      // credential is the reviewer's job once they can read the document.
      const subjectKey = hashCredentialBytes("student_card", authUserId, pepper);
      const [subject] = await tx<Array<{ id: string }>>`
        insert into identity.subject (subject_key, key_version)
        values (${subjectKey}, ${CREDENTIAL_KEY_VERSION})
        on conflict (subject_key) do update set updated_at = now()
        returning id
      `;
      if (!subject) throw new BadRequestException("verification_failed");

      // One live submission at a time. Without this a student who taps twice
      // puts two documents in the queue and a reviewer decides the same case
      // twice.
      await tx`
        update identity.verification_attempt
           set state = 'expired', updated_at = now()
         where subject_id = ${subject.id}
           and method = 'student_card'
           and state in ('pending', 'in_review')
      `;

      const [row] = await tx<Array<{ sla_due_at: Date }>>`
        insert into identity.verification_attempt
          (subject_id, university_id, method, state, evidence_path, evidence_sha256,
           evidence_purge_at, sla_due_at)
        values (${subject.id}, ${universityId}, 'student_card', 'in_review',
                ${evidencePath}, decode(${evidenceSha256}, 'hex'),
                -- 30 days is the outer bound from the product plan; a decided
                -- case should be purged sooner by the sweeper.
                now() + interval '30 days',
                now() + (${route.sla_minutes} || ' minutes')::interval)
        returning sla_due_at
      `;
      return {
        state: "in_review",
        sla_due_at: row?.sla_due_at.toISOString() ?? "",
      };
    });
  }

  /**
   * Verification status for a caller who may not have an app_user yet.
   *
   * Returns the coarse state only. It deliberately does not say WHY a card was
   * rejected in this response — the reason belongs in the appeal flow, where
   * it can be written for a person, not inferred from an enum by a client.
   */
  async getVerificationStatus(authUserId: string): Promise<{
    state: string; method: string | null; sla_due_at: string | null;
  }> {
    const pepper = this.config.credentialPepper;
    const subjectKey = hashCredentialBytes("student_card", authUserId, pepper);

    const [row] = await this.identity.sql<
      Array<{ state: string; method: string; sla_due_at: Date | null }>
    >`
      select va.state::text, va.method::text, va.sla_due_at
        from identity.verification_attempt va
        join identity.subject s on s.id = va.subject_id
       where s.subject_key = ${subjectKey}
       order by va.created_at desc
       limit 1
    `;

    if (!row) return { state: "none", method: null, sla_due_at: null };
    return {
      state: row.state,
      method: row.method,
      sla_due_at: row.sla_due_at?.toISOString() ?? null,
    };
  }

  /**
   * DEVELOPMENT ONLY. Stands in for a Supabase anonymous sign-in so onboarding
   * can be walked without a Supabase project. The controller refuses to expose
   * this unless the development gate is open.
   */
  async createDevAuthSubject(): Promise<{ auth_user_id: string }> {
    const [row] = await this.db.sql<Array<{ id: string }>>`
      insert into auth.users (id) values (gen_random_uuid()) returning id
    `;
    return { auth_user_id: row?.id ?? "" };
  }

  /**
   * Confirms the OTP and, on success, provisions the pseudonymous account.
   *
   * The two halves live in different schemas on purpose: the subject, its
   * credential binding and the link row are Layer 1 and written through the
   * identity connection; `app_user` is Layer 2 and written through the main
   * one. Nothing in the public schema records which subject an app_user came
   * from — only `identity.app_user_link` knows, and only this service can read it.
   */
  async confirmEmailVerification(
    email: string, code: string, authUserId: string,
  ): Promise<{ app_user_id: string; handle: string; tier: TokenTier }> {
    const pepper = this.config.credentialPepper;
    const normalised = normaliseCredential(email);
    const credentialHmac = hashCredentialBytes("university_email", normalised, pepper);

    const attempt = await this.identity.transaction(async (tx) => {
      const [subject] = await tx<Array<{ id: string }>>`
        select id from identity.subject where subject_key = ${credentialHmac}
      `;
      if (!subject) throw new BadRequestException("verification_failed");

      const [row] = await tx<Array<{ id: string; university_id: string; subject_id: string }>>`
        select id, university_id, subject_id
          from identity.verification_attempt
         where subject_id = ${subject.id}
           and state = 'pending'
           and challenge_expires_at > now()
           and challenge_hmac = ${hashChallenge(code, pepper)}
         for update
      `;
      if (!row) {
        // Count the failure against the live attempt, then fail with a single
        // undifferentiated error. Distinguishing "wrong code" from "expired"
        // from "no such attempt" hands an attacker a search signal.
        await tx`
          update identity.verification_attempt
             set attempt_count = attempt_count + 1,
                 state = case when attempt_count + 1 >= ${OTP_MAX_ATTEMPTS} then 'expired'
                              else state end,
                 updated_at = now()
           where subject_id = ${subject.id} and state = 'pending'
        `;
        throw new BadRequestException("verification_failed");
      }

      await tx`update identity.verification_attempt
                  set state = 'verified', decided_at = now(),
                      decision = 'approved', updated_at = now()
                where id = ${row.id}`;
      return row;
    });

    // Provision Layer 2. Handle generation asks the main pool whether a
    // candidate is free; it never sees anything from identity.
    const handle = await generateHandle(async (candidate) => {
      const [taken] = await this.db.sql`
        select 1 from public.app_user where handle = ${candidate} limit 1`;
      return Boolean(taken);
    });

    const [appUser] = await this.db.sql<Array<{ id: string }>>`
      insert into public.app_user (auth_user_id, handle, university_id,
                                   verification_tier, status)
      values (${authUserId}, ${handle}, ${attempt.university_id}, 'email_verified', 'active')
      on conflict (auth_user_id) do update
        set verification_tier = 'email_verified', status = 'active'
      returning id
    `;
    if (!appUser) throw new NotFoundException("provisioning_failed");

    // Open the handle's first tenancy. internal.handle_history is what makes a
    // block survive a later rename, so it has to start at provisioning rather
    // than at the first rotation.
    await this.db.sql`
      insert into internal.handle_history (app_user_id, handle)
      values (${appUser.id}, ${handle})
      on conflict do nothing
    `;

    // The sealed link. One subject, one app_user — enforced by the unique
    // constraints on identity.app_user_link, not by this code being careful.
    // The subject already exists (created at start); bind the credential and
    // seal the link. The unique constraints on identity.app_user_link are what
    // enforce one-subject-one-app_user, not this code being careful.
    await this.identity.transaction(async (tx) => {
      await tx`
        insert into identity.credential_binding
          (subject_id, kind, credential_hmac, key_version, university_id, last_verified_at)
        values (${attempt.subject_id}, 'university_email', ${credentialHmac},
                ${CREDENTIAL_KEY_VERSION}, ${attempt.university_id}, now())
        on conflict do nothing
      `;
      await tx`
        insert into identity.app_user_link (subject_id, app_user_id)
        values (${attempt.subject_id}, ${appUser.id})
        on conflict do nothing
      `;
    });

    // Tier grant, one of the eight epoch-bump triggers in identity spec §7.3.
    //
    // It matters here specifically because the caller is about to refresh: the
    // access token in their hand was minted BEFORE this app_user existed, so it
    // carries no claims at all. Bumping now means that if a token somehow was
    // minted mid-flight against a half-provisioned row, it is already stale by
    // the time the client refreshes and cannot be replayed.
    await this.epochs.bump(appUser.id, "tier_grant");

    // The TOKEN vocabulary, not the database one. The client renders this as a
    // badge and compares it against the tier claim it will see on every
    // subsequent token, so returning 'email_verified' here — as this did — meant
    // the app saw a different string depending on whether it had just signed up
    // or just restarted. See common/auth/tier-vocabulary.ts.
    return { app_user_id: appUser.id, handle, tier: dbTierToToken("email_verified") };
  }
}
