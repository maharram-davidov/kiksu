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
  SUPABASE_URL: z.string().url(),
  // Server-only. See the SECURITY note on the exported schema above.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

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
  return result.data;
}
