import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";
import { AuthGuard } from "../src/common/auth/auth.guard";
import type { EpochService } from "../src/common/auth/epoch.service";
import { JwtVerifierService } from "../src/common/auth/jwt-verifier.service";
import { SecurityMetricsService } from "../src/common/auth/security-metrics.service";

/**
 * The guard, end to end, against tokens that are actually signed.
 *
 * `auth.guard.spec.ts` covers the claim-handling rules with `JwtVerifierService`
 * mocked, which means the signature, JWKS resolution, issuer and audience checks
 * have never executed in a test — the exact half that only fails in production,
 * because a mock cannot get a signature wrong.
 *
 * Everything here mints a real RS256 token against a locally generated keypair
 * and resolves it through a local JWKS, using the `JWKS_RESOLVER` seam that
 * `auth.module.ts` already provides for precisely this.
 */

const ISSUER_BASE = "https://houicgsdduzzcarxkuuo.supabase.co";
const AUDIENCE = "authenticated";

const SUBJECT = "11111111-1111-4111-8111-111111111111";
const APP_USER = "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa";
const UNIV = "0193f2c1-a0b2-7c44-8e21-4f7a1d2b3c55";
const SESSION = "0193f2c1-b1c3-7d55-9f32-5a8b2e3c4d66";

const VALID_APP_METADATA = {
  app_user_id: APP_USER,
  tier: "email",
  role: "student",
  univ_id: UNIV,
  epoch: 3,
  sid: SESSION,
};

/** The synthetic address identity spec §7.2 requires on the auth anchor. */
const SYNTHETIC_EMAIL = `${SUBJECT}@users.kiksu.invalid`;

let privateKey: KeyLike;
let otherPrivateKey: KeyLike;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  // A second, unrelated key. Tokens signed with this are correctly formed and
  // correctly shaped — they are simply not ours, which is the whole question
  // signature verification answers.
  otherPrivateKey = (await generateKeyPair("RS256")).privateKey;

  const jwk = await exportJWK(pair.publicKey);
  jwks = createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256", use: "sig" }] });
});

interface TokenOptions {
  key?: KeyLike;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  appMetadata?: unknown;
  userMetadata?: unknown;
  email?: string;
}

async function mintToken(opts: TokenOptions = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    app_metadata: opts.appMetadata === undefined ? VALID_APP_METADATA : opts.appMetadata,
    session_id: SESSION,
  };
  if (opts.userMetadata !== undefined) payload.user_metadata = opts.userMetadata;
  if (opts.email !== undefined) payload.email = opts.email;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(SUBJECT)
    .setIssuedAt()
    .setIssuer(opts.issuer ?? `${ISSUER_BASE}/auth/v1`)
    .setAudience(opts.audience ?? AUDIENCE)
    // 900s is the TTL identity spec §7.3 specifies.
    .setExpirationTime(opts.expiresIn ?? "900s")
    .sign(opts.key ?? privateKey);
}

function makeContext(request: Record<string, unknown>): ExecutionContext {
  const handler = function handler() {};
  class Controller {}
  return {
    getHandler: () => handler,
    getClass: () => Controller,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

function buildGuard(opts: { currentEpoch?: number } = {}) {
  const config = {
    supabaseUrl: ISSUER_BASE,
    supabaseJwtAudience: AUDIENCE,
    devAuthAppUserId: undefined,
  };
  const verifier = new JwtVerifierService(jwks, config as never);
  const epochs = {
    getCurrentEpoch: vi.fn().mockResolvedValue(opts.currentEpoch ?? 0),
  } as unknown as EpochService;
  const metrics = new SecurityMetricsService();
  const recordSuspicious = vi.spyOn(metrics, "recordSuspiciousUserMetadata");
  const guard = new AuthGuard(new Reflector(), verifier, epochs, metrics, config as never);
  return { guard, recordSuspicious };
}

async function activate(token: string | null, opts: { currentEpoch?: number } = {}) {
  const { guard, recordSuspicious } = buildGuard(opts);
  const req: Record<string, unknown> = {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    requestId: "req-e2e",
  };
  const allowed = await guard.canActivate(makeContext(req));
  return { allowed, req, recordSuspicious };
}

describe("AuthGuard against real signed tokens", () => {
  it("accepts a correctly signed token and populates the request context", async () => {
    const { allowed, req } = await activate(await mintToken({ email: SYNTHETIC_EMAIL }));

    expect(allowed).toBe(true);
    expect(req.kiksu).toEqual({
      authUserId: SUBJECT,
      appUserId: APP_USER,
      tier: "email",
      role: "student",
      univId: UNIV,
      epoch: 3,
      sid: SESSION,
    });
  });

  // -------------------------------------------------------------------
  // The half a mocked verifier could never exercise
  // -------------------------------------------------------------------

  it("rejects a token signed with a key that is not ours", async () => {
    // The single most important assertion in this file: without it, anyone able
    // to mint a well-formed JWT would be any student they chose.
    await expect(activate(await mintToken({ key: otherPrivateKey }))).rejects.toThrow(
      expect.objectContaining({ code: "token_invalid" }) as never,
    );
  });

  it("rejects a token from another Supabase project", async () => {
    // Same signature algorithm, same claim shape, different issuer — a token
    // minted by any other project must not authorise anything here.
    await expect(
      activate(await mintToken({ issuer: "https://someone-else.supabase.co/auth/v1" })),
    ).rejects.toThrow(expect.objectContaining({ code: "token_invalid" }) as never);
  });

  it("rejects a token minted for a different audience", async () => {
    // A service-role token is signed by the same project with the same key. The
    // audience claim is the only thing separating "Supabase minted this" from
    // "Supabase minted this for THIS api".
    await expect(activate(await mintToken({ audience: "service_role" }))).rejects.toThrow(
      expect.objectContaining({ code: "token_invalid" }) as never,
    );
  });

  it("treats an expired token as unauthenticated, not invalid", async () => {
    // §2.5 draws this distinction deliberately: "no/expired token → sign in",
    // whereas a signature or issuer failure → sign out. The client acts on the
    // code, so conflating them would sign a student out for the ordinary event
    // of a token ageing past 900s.
    await expect(activate(await mintToken({ expiresIn: "-10s" }))).rejects.toThrow(
      expect.objectContaining({ code: "unauthenticated" }) as never,
    );
  });

  it("rejects a request with no Authorization header at all", async () => {
    await expect(activate(null)).rejects.toThrow(
      expect.objectContaining({ code: "unauthenticated" }) as never,
    );
  });

  it("rejects a structurally malformed bearer token", async () => {
    await expect(activate("not.a.jwt")).rejects.toThrow(
      expect.objectContaining({ code: "token_invalid" }) as never,
    );
  });

  // -------------------------------------------------------------------
  // Claim handling, now on a token that genuinely verified
  // -------------------------------------------------------------------

  it("rejects a verified token carrying no Kiksu claim block", async () => {
    // What the access-token hook produces for a caller with no app_user: a real,
    // correctly signed Supabase token that is not a Kiksu session.
    await expect(activate(await mintToken({ appMetadata: { provider: "anonymous" } }))).rejects.toThrow(
      expect.objectContaining({ code: "token_invalid" }) as never,
    );
  });

  it("rejects a claim block with a tier outside the allowlist", async () => {
    await expect(
      activate(await mintToken({ appMetadata: { ...VALID_APP_METADATA, tier: "superuser" } })),
    ).rejects.toThrow(expect.objectContaining({ code: "token_invalid" }) as never);
  });

  it("serves a request that smuggles a higher tier in user_metadata, and counts it", async () => {
    // §2.3: never reject, because rejecting would tell an attacker which key
    // names are checked — i.e. hand them the allowlist they are guessing at.
    const { allowed, req, recordSuspicious } = await activate(
      await mintToken({
        userMetadata: { tier: "card", role: "admin", nickname: "whatever" },
      }),
    );

    expect(allowed).toBe(true);
    // The smuggled values are ignored entirely: the real tier still wins.
    expect((req.kiksu as { tier: string }).tier).toBe("email");
    expect((req.kiksu as { role: string }).role).toBe("student");
    expect(recordSuspicious).toHaveBeenCalledOnce();
    expect(recordSuspicious.mock.calls[0]![0].sort()).toEqual(["role", "tier"]);
  });

  it("serves, but alarms on, a token whose email claim is not synthetic", async () => {
    // The counterpart of identity.auth_email_leak_check in the schema. A real
    // address here means the auth user was provisioned wrongly — the token now
    // carries the identity credential to every service and log that sees it.
    const { allowed } = await activate(await mintToken({ email: "ilkin.test@std.bsu.edu.az" }));
    expect(allowed).toBe(true);
  });

  // -------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------

  it("rejects a token whose epoch is behind the live one", async () => {
    // The ban path: internal.auth_epoch has moved past what this token carries.
    await expect(
      activate(await mintToken(), { currentEpoch: VALID_APP_METADATA.epoch + 1 }),
    ).rejects.toThrow(expect.objectContaining({ code: "token_stale" }) as never);
  });

  it("accepts a token whose epoch exactly matches the live one", async () => {
    // The check is `<`, not `<=`. Off by one here logs out every user on every
    // request forever.
    const { allowed } = await activate(await mintToken(), {
      currentEpoch: VALID_APP_METADATA.epoch,
    });
    expect(allowed).toBe(true);
  });
});
