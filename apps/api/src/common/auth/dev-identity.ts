import { Logger } from "@nestjs/common";
import type { KiksuRequestContext } from "./request-context";
import { dbTierToToken } from "./tier-vocabulary";

/**
 * A DEVELOPMENT-ONLY identity, used when no real Supabase project is reachable.
 *
 * WHY THIS EXISTS: the API verifies tokens against a Supabase JWKS endpoint.
 * Running locally there is no such endpoint, so without this every
 * authenticated route is unreachable and no screen can be built or demonstrated
 * against real data.
 *
 * WHY IT IS SAFE: it is gated on THREE independent conditions, all of which
 * must hold, and any one of which is enough to disable it:
 *
 *   1. `NODE_ENV` is not `production` — checked here.
 *   2. `DEV_AUTH_APP_USER_ID` is explicitly set — an operator has to opt in by
 *      naming a specific user; there is no default.
 *   3. `ConfigModule` refuses to boot at all if condition 1 fails while the
 *      variable is set, so a production deploy that inherits a stray value
 *      crashes on startup rather than silently accepting unauthenticated
 *      traffic.
 *
 * A bypass that fails open is worse than no bypass. This one fails closed and
 * says so loudly on every boot where it is active.
 */
export function resolveDevIdentity(
  nodeEnv: string,
  appUserId: string | undefined,
  logger = new Logger("DevAuth"),
): KiksuRequestContext | null {
  if (!appUserId) return null;

  if (nodeEnv === "production") {
    // Belt to ConfigModule's braces. Reaching here at all means the earlier
    // guard was removed, so refuse rather than degrade.
    throw new Error(
      "DEV_AUTH_APP_USER_ID is set in production. Refusing to start: this " +
        "would accept unauthenticated requests as a real user.",
    );
  }

  logger.warn(
    `DEVELOPMENT AUTH BYPASS ACTIVE — every request is treated as app_user ` +
      `${appUserId}. Never set DEV_AUTH_APP_USER_ID outside local development.`,
  );

  return null; // the per-request context is built by the guard; see buildDevContext
}

/** Builds the request context the bypass hands to downstream code. */
export function buildDevContext(
  appUserId: string,
  universityId: string,
  authUserId: string,
): KiksuRequestContext {
  return {
    authUserId,
    appUserId,
    // Deliberately the lowest useful tier rather than 'card'. Developing
    // against the most privileged identity hides tier-gating bugs, which is
    // exactly the class of bug this project has already shipped once.
    //
    // Routed through the vocabulary mapping rather than written as the literal
    // 'email' it produces. This function is one of the two places that emit a
    // tier claim without passing through internal.token_claims, and having it
    // hardcode a token-vocabulary string is how the two vocabularies drifted
    // apart in the first place.
    tier: dbTierToToken("email_verified"),
    role: "student",
    univId: universityId,
    epoch: 1,
    sid: "dev-session",
  };
}
