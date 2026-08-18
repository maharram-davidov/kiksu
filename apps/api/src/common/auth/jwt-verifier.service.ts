import { Inject, Injectable } from "@nestjs/common";
import { errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ConfigService } from "../../config/config.service";
import { AppError } from "../errors/app-error";

/** The claim shape we read off a verified token, top level plus the `app_metadata` block. */
export interface SupabaseJwtClaims {
  sub: string;
  app_metadata?: unknown;
  user_metadata?: unknown;
  email?: string;
  phone?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
}

/** DI token for the key resolver, so tests can swap a remote JWKS for a local one. */
export const JWKS_RESOLVER = Symbol("JWKS_RESOLVER");

/**
 * Verifies a Supabase-issued access token: signature (against the project's
 * JWKS), issuer, audience, and expiry. Everything else about "is this claim set
 * trustworthy" — the allowlist, the `user_metadata` trap — is a separate concern
 * handled in `claims.ts` and `auth.guard.ts`; this service answers exactly one
 * question: "did Supabase mint this token, and is it still valid."
 *
 * THE ALGORITHM IS NOT PINNED, and that is deliberate. This was written
 * assuming RS256; the live project actually signs ES256, which was only
 * discovered by verifying a real token against the real JWKS. `jwtVerify`
 * resolves the key by `kid` from the published set and validates against
 * whatever that key is, so both work and a key rotation or curve change is a
 * non-event. Adding an `algorithms` allowlist here would convert exactly that
 * routine platform change into a total outage — every token rejected, with a
 * signature error that looks like an attack rather than a config drift.
 */
@Injectable()
export class JwtVerifierService {
  constructor(
    @Inject(JWKS_RESOLVER) private readonly getKey: JWTVerifyGetKey,
    private readonly config: ConfigService,
  ) {}

  /**
   * @throws AppError("unauthenticated") on a missing/expired token — §2.5: "No/expired
   *   token → sign in" is explicitly the `unauthenticated` row, not `token_invalid`.
   * @throws AppError("token_invalid") on a signature, issuer, or audience failure, or
   *   any other malformed-token condition — §2.5: "Signature/issuer/audience failure →
   *   sign out".
   */
  async verify(token: string): Promise<SupabaseJwtClaims> {
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        audience: this.config.supabaseJwtAudience,
        issuer: `${this.config.supabaseUrl}/auth/v1`,
      });
      return payload as SupabaseJwtClaims;
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        throw new AppError("unauthenticated", { cause: err });
      }
      // Signature failure (JWSSignatureVerificationFailed), bad iss/aud
      // (JWTClaimValidationFailed), structurally malformed (JWTInvalid/JWSInvalid), or
      // no matching JWKS key (JWKSNoMatchingKey) all land here: the token was not
      // minted the way we expect, full stop.
      throw new AppError("token_invalid", { cause: err });
    }
  }
}
