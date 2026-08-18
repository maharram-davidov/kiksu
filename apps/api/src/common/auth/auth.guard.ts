import { type CanActivate, type ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AppError } from "../errors/app-error";
import {
  findSuspiciousKeys,
  parseTrustedAppMetadata,
  SYNTHETIC_EMAIL_PATTERN,
} from "./claims";
import { EpochService } from "./epoch.service";
import { JwtVerifierService } from "./jwt-verifier.service";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { KiksuRequestContext } from "./request-context";
import { SecurityMetricsService } from "./security-metrics.service";
import { ConfigService } from "../../config/config.service";
import { buildDevContext } from "./dev-identity";

declare module "express-serve-static-core" {
  interface Request {
    /** Set by {@link AuthGuard} once a token has passed every check. Absent on `@Public()` routes. */
    kiksu?: KiksuRequestContext;
  }
}

/**
 * Verifies the Supabase JWT and populates `req.kiksu` from the trusted claim
 * allowlist (`05-api-conventions.md` §2.2, identity spec §7.1). Registered globally in
 * `main.ts` so every route requires authentication unless explicitly marked
 * `@Public()` — fail closed by default.
 *
 * Five things happen here, in order, and none of them may be reordered without
 * re-reading §2.3-§2.4:
 *
 * 1. Extract and cryptographically verify the token (delegated to `JwtVerifierService`).
 * 2. Check `user_metadata` for allowlisted-looking keys — record and IGNORE, never reject.
 * 3. Check the `email` claim against the synthetic-address shape — alarm, don't use.
 * 4. Parse `app_metadata` against the trusted-claim schema — reject if it doesn't fit.
 * 5. Epoch check — the revocation primitive.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger("AuthGuard");

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtVerifier: JwtVerifierService,
    private readonly epochs: EpochService,
    private readonly securityMetrics: SecurityMetricsService,
    private readonly config: ConfigService,
  ) {
    if (this.config.devAuthAppUserId) {
      this.logger.warn(
        "DEVELOPMENT AUTH BYPASS ACTIVE — every authenticated route is served " +
          `as app_user ${this.config.devAuthAppUserId} with no token. ` +
          "parseEnv() refuses to boot if this is ever set in production.",
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<Request>();

    if (isPublic) return true;

    // Development bypass. parseEnv() has already refused to boot if this is
    // set in production, so reaching here means NODE_ENV is not production AND
    // an operator explicitly named a user. See dev-identity.ts.
    const devAppUserId = this.config.devAuthAppUserId;
    if (devAppUserId) {
      req.kiksu = buildDevContext(
        devAppUserId,
        this.config.devAuthUniversityId ?? "",
        // The REAL auth subject. Synthesising one here is what made every
        // staff route answer 500 — see buildDevContext's doc comment.
        this.config.devAuthAuthUserId ?? "",
        this.config.devAuthTier,
      );
      return true;
    }

    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError("unauthenticated");
    }

    const claims = await this.jwtVerifier.verify(token);

    // --- The user_metadata trap (05-api-conventions.md §2.3) ---
    // `user_metadata` (`raw_user_meta_data`) is client-writable: any signed-in user can
    // set it via the standard Supabase `updateUser` call, and whatever they set lands
    // in the next access token, correctly signed. A signed JWT proves Supabase minted
    // it; it does NOT prove WE wrote every claim inside it. No authorisation decision
    // anywhere in this API may read `user_metadata` — not for tier, not for role, not
    // for university, not for a feature flag, not "just for logging". Below, we never
    // read `claims.user_metadata` for anything except detecting that it LOOKS like an
    // attempt to smuggle a trusted claim — and even then we only count it.
    //
    // A request whose `user_metadata` contains `tier`, `role`, `app_user_id`,
    // `univ_id`, `epoch`, `verification_status`, `karma` or `contributor_level` is
    // served NORMALLY, with those values ignored, and the occurrence is counted as a
    // security metric. This is deliberately NOT an error: rejecting it would tell an
    // attacker which key names we check for, i.e. would hand them the allowlist they're
    // trying to guess. So: never throw here, only record.
    const suspiciousKeys = findSuspiciousKeys(claims.user_metadata);
    if (suspiciousKeys.length > 0) {
      this.securityMetrics.recordSuspiciousUserMetadata(suspiciousKeys, req.requestId);
    }

    // The auth-anchor leak check (§2.3 / identity spec §7.2 trap 1): the Supabase auth
    // email must always be the synthetic `<uuid>@users.kiksu.invalid` address. A token
    // carrying a real-looking address is a defect in how the auth user was provisioned,
    // not a value to render or authorise anything with — alarm on it, never use it.
    // This is the server-side counterpart of `identity.auth_email_leak_check` in the
    // schema.
    if (claims.email && !SYNTHETIC_EMAIL_PATTERN.test(claims.email)) {
      this.logger.error(
        `auth_email_leak_check: token sub=${claims.sub} carries a non-synthetic email claim`,
      );
    }

    // Only `app_metadata` (server-written) claims ever populate the request context.
    const appMetadata = parseTrustedAppMetadata(claims.app_metadata);
    if (!appMetadata) {
      // Verified signature, but our own claim block is missing or malformed: not a
      // valid Kiksu session token, whatever else it might be.
      throw new AppError("token_invalid");
    }

    // The revocation primitive (identity spec §7.4): one integer comparison.
    const currentEpoch = await this.epochs.getCurrentEpoch(appMetadata.app_user_id);
    if (appMetadata.epoch < currentEpoch) {
      throw new AppError("token_stale");
    }

    req.kiksu = {
      authUserId: claims.sub,
      appUserId: appMetadata.app_user_id,
      tier: appMetadata.tier,
      role: appMetadata.role,
      univId: appMetadata.univ_id,
      epoch: appMetadata.epoch,
      sid: appMetadata.sid,
    };

    return true;
  }
}

function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}
