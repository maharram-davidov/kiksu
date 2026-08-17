import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomInt } from "node:crypto";
import { IdentitySqlProvider } from "../../common/db/identity-sql.provider";
import { SqlProvider } from "../../common/db/sql.provider";
import { ConfigService } from "../../config/config.service";
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
  ) {}

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
  async startEmailVerification(email: string): Promise<{ expires_in_seconds: number }> {
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
    if (!match) throw new BadRequestException("email_domain_not_recognised");

    const code = String(randomInt(100_000, 1_000_000));
    const pepper = this.config.credentialPepper;

    const credentialHmac = hashCredentialBytes("university_email", normalised, pepper);

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

    // TODO(delivery): no mail provider is wired yet. The code is deliberately
    // NOT returned in the response — doing so would make the whole flow
    // decorative and would hand it to anyone who can call the endpoint.
    //
    // It IS logged, but only when the development gate is open. Without that,
    // onboarding cannot be walked by hand at all, and an unwalkable signup
    // flow is one nobody checks. The gate is the same one that guards the auth
    // bypass, so this cannot reach production: parseEnv() refuses to boot
    // there with it set.
    this.pendingCodeForDevelopment = code;
    if (this.config.devAuthAppUserId) {
      this.logger.warn(`DEV OTP ${code} for ${normalised} — development only`);
    }

    return { expires_in_seconds: OTP_TTL_MINUTES * 60 };
  }

  /** Development-only escape hatch so the flow is testable before mail exists. */
  pendingCodeForDevelopment: string | null = null;

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
  ): Promise<{ app_user_id: string; handle: string; tier: string }> {
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

    return { app_user_id: appUser.id, handle, tier: "email_verified" };
  }
}
