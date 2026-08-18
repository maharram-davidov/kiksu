import { z } from "zod";

/**
 * Every environment variable the API reads, typed and validated.
 *
 * This is the single source of truth for "what env does this service need" — it
 * doubles as the spec for `.env.example`. Boot fails fast (see `config.module.ts`)
 * rather than limping along with `undefined` scattered through the request path.
 *
 * SECURITY: `SUPABASE_SERVICE_ROLE_KEY` bypasses every RLS policy in the database
 * (`01-schema-notes.md` — `kiksu_app` holds `bypassrls`). It must exist ONLY here,
 * on the server layer. It must never be sent to the Expo app, never logged, never
 * put in a client-facing response, and never put in a URL. If this value leaks, every
 * identity protection in `02-identity-spec.md` is void — a holder of this key can read
 * the sealed `identity` and `career` schemas directly, bypassing every layer boundary
 * this whole product exists to enforce.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // --- HTTP server ---
  PORT: z.coerce.number().int().positive().default(3000),

  // --- Supabase project (04-infrastructure.md: project ref houicgsdduzzcarxkuuo, eu-central-1) ---
  /**
   * Postgres connection string for the server layer. SECURITY: server-only,
   * and it authenticates as a BYPASSRLS role — see SqlProvider's class doc.
   */
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  /**
   * Verification-service connection. MUST be a distinct least-privilege
   * credential (kiksu_identity_svc); sharing DATABASE_URL collapses the
   * Layer 1 boundary. See IdentitySqlProvider.
   */
  DATABASE_URL_IDENTITY: z.string().url(),
  /** SECURITY: server-only, KMS-held. Rotating it requires a versioned backfill. */
  CREDENTIAL_PEPPER: z.string().min(32),
  /**
   * DEVELOPMENT ONLY. When set, every request is treated as this app_user
   * without any token. Boot is refused if this is present while NODE_ENV is
   * production, so a stray value in a real deployment crashes on startup
   * rather than silently accepting unauthenticated traffic.
   */
  DEV_AUTH_APP_USER_ID: z.string().uuid().optional(),
  /** DEVELOPMENT ONLY. Campus the bypassed identity belongs to. */
  DEV_AUTH_UNIVERSITY_ID: z.string().uuid().optional(),
  /**
   * DEVELOPMENT ONLY. The bypassed user's REAL `auth.users` id.
   *
   * Typed as a uuid on purpose. The bypass previously synthesised
   * `dev-auth-<uuid>` here, which every admin route then fed to a uuid column
   * and died on — see buildDevContext. A malformed value now fails at boot
   * instead of at the first staff request.
   */
  DEV_AUTH_AUTH_USER_ID: z.string().uuid().optional(),
  SUPABASE_URL: z.string().url(),
  // Server-only. See the SECURITY note on the exported schema above.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  /**
   * Private bucket holding student card images.
   *
   * Must NOT be public-read: these are identity documents, and the whole point
   * of Layer 1 is that a real name never leaves it. Objects are reached only
   * through short-lived signed URLs minted by EvidenceService, and every mint
   * is written to identity.access_log first.
   */
  SUPABASE_EVIDENCE_BUCKET: z.string().min(1).default("verification-evidence"),

  // --- Auth token verification (05-api-conventions.md §2.1: Supabase JWT, RS256, 900s TTL) ---
  // Used to build the JWKS URL: `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`.
  // Overridable for self-hosted / non-standard gateways.
  SUPABASE_JWKS_URL: z.string().url().optional(),
  // Expected `aud` claim on Supabase-issued access tokens. Supabase defaults to "authenticated".
  SUPABASE_JWT_AUDIENCE: z.string().default("authenticated"),
  // Expected `iss` claim prefix check is derived from SUPABASE_URL; no separate var needed.

  // --- Cursor signing (05-api-conventions.md §4.3) ---
  // 32+ bytes of random data, base64 or hex. Rotating this invalidates every outstanding
  // cursor (clients see `cursor_invalid` and restart their list — degrades gracefully).
  CURSOR_HMAC_SECRET: z.string().min(32),

  // --- Idempotency store (05-api-conventions.md §6) ---
  // "memory" is the scaffold default (single-process only, lost on restart — fine for
  // dev/test, NOT fine for a multi-instance production deploy). Swap for a Redis-backed
  // store before shipping; see `common/idempotency/idempotency.store.ts`.
  IDEMPOTENCY_STORE: z.enum(["memory", "redis"]).default("memory"),
  REDIS_URL: z.string().url().optional(),

  // --- Mail (verification codes) ---
  /**
   * SMTP connection string, e.g. `smtps://user:pass@smtp.postmarkapp.com:587`.
   *
   * Deliberately a URL rather than a provider SDK: deliverability to `.edu.az`
   * university mail servers is the real risk in this feature, and finding out
   * which provider actually gets through should be a config change, not a code
   * change.
   *
   * Optional so local development works with no mail infrastructure — the
   * capture transport holds the message instead. The production check below
   * refuses to boot without it.
   */
  SMTP_URL: z.string().optional(),
  /** Envelope sender, e.g. `Kiksu <noreply@kiksu.az>`. */
  MAIL_FROM: z.string().optional(),

  // --- Rate limiting (05-api-conventions.md §5) ---
  // Same caveat as IDEMPOTENCY_STORE: "memory" does not coordinate across instances.
  RATE_LIMIT_STORE: z.enum(["memory", "redis"]).default("memory"),

  // --- App store URLs, surfaced via GET /v1/bootstrap ---
  IOS_STORE_URL: z.string().url(),
  ANDROID_STORE_URL: z.string().url(),

  // --- Minimum / recommended client versions, surfaced via GET /v1/bootstrap ---
  // Semver strings. Kept in env (not hardcoded) so ops can raise `min_supported_client`
  // without a deploy — that is the entire point of §1.5's rollout mechanism.
  MIN_SUPPORTED_CLIENT_IOS: z.string().default("1.0.0"),
  MIN_SUPPORTED_CLIENT_ANDROID: z.string().default("1.0.0"),
  RECOMMENDED_CLIENT_IOS: z.string().default("1.0.0"),
  RECOMMENDED_CLIENT_ANDROID: z.string().default("1.0.0"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Values `scripts/dev-api.sh` writes into `apps/api/.env`. They are recognisable
 * on sight here so that a production boot with one of them fails with a sentence
 * naming the problem, rather than with a wall of 401s that looks like an outage.
 */
const DEV_PLACEHOLDER_SERVICE_ROLE_KEYS = new Set([
  "dev-placeholder-service-role-key",
]);

/**
 * Parses and validates `process.env`. Throws a readable, aggregated error on failure —
 * called once at boot (see `main.ts`) so a missing/malformed variable is a startup crash,
 * never a runtime surprise on the first request that happens to need it.
 */
export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid environment configuration. Fix these before the server can boot:\n${issues}`,
    );
  }
  // A development auth bypass must never survive into production. Refusing to
  // boot is the only safe behaviour: warning and continuing would leave a
  // deployment silently accepting unauthenticated requests as a real user, and
  // that is exactly the sort of thing that gets noticed months later.
  if (result.data.NODE_ENV === "production" && result.data.DEV_AUTH_APP_USER_ID) {
    throw new Error(
      "DEV_AUTH_APP_USER_ID is set while NODE_ENV=production. Refusing to " +
        "boot: this bypass accepts every request as a real user without a token.",
    );
  }

  // The rest of these guard the Supabase configuration that token verification
  // now actually depends on. Before the access-token hook existed none of it
  // was load-bearing: the bypass answered every request and a wrong SUPABASE_URL
  // cost nothing. Now a misconfigured project means every token fails to verify,
  // which presents as a total outage with a 401 on every route — and the one
  // thing worse than that is the version where it silently half-works.
  if (result.data.NODE_ENV === "production") {
    // dev-api.sh writes this literal into apps/api/.env on every run. Inheriting
    // that file, or copying it as a starting point for a real deployment, is the
    // realistic way a placeholder reaches production.
    if (DEV_PLACEHOLDER_SERVICE_ROLE_KEYS.has(result.data.SUPABASE_SERVICE_ROLE_KEY)) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is still a development placeholder while " +
          "NODE_ENV=production. Refusing to boot: no request could be authorised, " +
          "and the value looks real enough to be mistaken for a working config.",
      );
    }

    // The issuer check inside JwtVerifierService is derived from SUPABASE_URL,
    // so a plaintext or loopback value is not merely insecure — it means tokens
    // are verified against an issuer no real token will ever carry.
    // A deployment that accepts signups and cannot deliver a code is worse
    // than one that refuses to start: the student completes the form, waits
    // for a message that never arrives, and nothing anywhere reports an error
    // because from the API's point of view nothing failed.
    if (!result.data.SMTP_URL || !result.data.MAIL_FROM) {
      throw new Error(
        "SMTP_URL and MAIL_FROM are required in production. Refusing to boot: " +
          "without them verification codes are captured in memory and never sent, " +
          "so email signup silently does nothing.",
      );
    }

    if (!result.data.SUPABASE_URL.startsWith("https://")) {
      throw new Error(
        `SUPABASE_URL must be https in production (got ${result.data.SUPABASE_URL}). ` +
          "Refusing to boot: the JWT issuer check is derived from this value.",
      );
    }
    if (/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(result.data.SUPABASE_URL)) {
      throw new Error(
        "SUPABASE_URL points at localhost while NODE_ENV=production. Refusing to boot.",
      );
    }
  }

  return result.data;
}
