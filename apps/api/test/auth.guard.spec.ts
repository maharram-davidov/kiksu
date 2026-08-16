import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { AuthGuard } from "../src/common/auth/auth.guard";
import type { EpochService } from "../src/common/auth/epoch.service";
import type { JwtVerifierService, SupabaseJwtClaims } from "../src/common/auth/jwt-verifier.service";
import type { SecurityMetricsService } from "../src/common/auth/security-metrics.service";
import { AppError } from "../src/common/errors/app-error";

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

const VALID_APP_METADATA = {
  app_user_id: "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa",
  tier: "email",
  role: "student",
  univ_id: "0193f2c1-a0b2-7c44-8e21-4f7a1d2b3c55",
  epoch: 3,
  sid: "0193f2c1-b1c3-7d55-9f32-5a8b2e3c4d66",
};

function buildGuard(claims: SupabaseJwtClaims, opts?: { recordSuspicious?: ReturnType<typeof vi.fn> }) {
  const jwtVerifier = { verify: vi.fn().mockResolvedValue(claims) } as unknown as JwtVerifierService;
  const epochs = { getCurrentEpoch: vi.fn().mockResolvedValue(0) } as unknown as EpochService;
  const recordSuspiciousUserMetadata = opts?.recordSuspicious ?? vi.fn();
  const securityMetrics = { recordSuspiciousUserMetadata } as unknown as SecurityMetricsService;
  const guard = new AuthGuard(new Reflector(), jwtVerifier, epochs, securityMetrics);
  return { guard, securityMetrics, recordSuspiciousUserMetadata };
}

describe("AuthGuard — the user_metadata trap (05-api-conventions.md §2.3)", () => {
  it("populates request context from app_metadata only, even when user_metadata claims a higher tier", async () => {
    const recordSuspicious = vi.fn();
    const { guard } = buildGuard(
      {
        sub: "11111111-1111-4111-8111-111111111111",
        app_metadata: VALID_APP_METADATA, // real tier: "email"
        // Client-writable. Attempts to self-award "card" (the ANONİM KART badge).
        user_metadata: { tier: "card", verification_status: "card", nickname: "whatever" },
      },
      { recordSuspicious },
    );

    const req: Record<string, unknown> = { headers: { authorization: "Bearer x" }, requestId: "req-1" };
    const ctx = makeContext(req);

    const allowed = await guard.canActivate(ctx);

    expect(allowed).toBe(true);
    // The request context reflects app_metadata's real tier, NOT user_metadata's claimed one.
    expect(req["kiksu"]).toMatchObject({ tier: "email", appUserId: VALID_APP_METADATA.app_user_id });
  });

  it("records suspicious user_metadata keys as a security metric instead of rejecting the request", async () => {
    const recordSuspicious = vi.fn();
    const { guard } = buildGuard(
      {
        sub: "11111111-1111-4111-8111-111111111111",
        app_metadata: VALID_APP_METADATA,
        user_metadata: { tier: "card", karma: 999999, unrelated_field: "fine" },
      },
      { recordSuspicious },
    );

    const req: Record<string, unknown> = { headers: { authorization: "Bearer x" }, requestId: "req-2" };
    const ctx = makeContext(req);

    // Must NOT throw — a rejection would disclose which key names are checked.
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    expect(recordSuspicious).toHaveBeenCalledTimes(1);
    const [keys] = recordSuspicious.mock.calls[0] as [string[], string | undefined];
    expect(keys.sort()).toEqual(["karma", "tier"]);
    // unrelated_field is not on the allowlist-shaped watch list and must not be reported.
    expect(keys).not.toContain("unrelated_field");
  });

  it("does not record anything when user_metadata is empty or absent", async () => {
    const recordSuspicious = vi.fn();
    const { guard } = buildGuard(
      { sub: "11111111-1111-4111-8111-111111111111", app_metadata: VALID_APP_METADATA },
      { recordSuspicious },
    );

    const req: Record<string, unknown> = { headers: { authorization: "Bearer x" }, requestId: "req-3" };
    await guard.canActivate(makeContext(req));

    expect(recordSuspicious).not.toHaveBeenCalled();
  });

  it("rejects with token_invalid when app_metadata is missing the trusted claim shape", async () => {
    const { guard } = buildGuard({
      sub: "11111111-1111-4111-8111-111111111111",
      app_metadata: { tier: "card" }, // missing app_user_id, role, univ_id, epoch, sid
    });

    const req: Record<string, unknown> = { headers: { authorization: "Bearer x" }, requestId: "req-4" };

    await expect(guard.canActivate(makeContext(req))).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("rejects with unauthenticated when no bearer token is present", async () => {
    const { guard } = buildGuard({ sub: "x", app_metadata: VALID_APP_METADATA });
    const req: Record<string, unknown> = { headers: {}, requestId: "req-5" };

    await expect(guard.canActivate(makeContext(req))).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("returns token_stale when the token's epoch is behind the current one", async () => {
    const jwtVerifier = {
      verify: vi.fn().mockResolvedValue({
        sub: "11111111-1111-4111-8111-111111111111",
        app_metadata: { ...VALID_APP_METADATA, epoch: 1 },
      }),
    } as unknown as JwtVerifierService;
    const epochs = { getCurrentEpoch: vi.fn().mockResolvedValue(5) } as unknown as EpochService;
    const securityMetrics = { recordSuspiciousUserMetadata: vi.fn() } as unknown as SecurityMetricsService;
    const guard = new AuthGuard(new Reflector(), jwtVerifier, epochs, securityMetrics);

    const req: Record<string, unknown> = { headers: { authorization: "Bearer x" }, requestId: "req-6" };

    await expect(guard.canActivate(makeContext(req))).rejects.toMatchObject({ code: "token_stale" });
  });

  it("bypasses verification entirely for @Public() routes", async () => {
    const jwtVerifier = { verify: vi.fn() } as unknown as JwtVerifierService;
    const epochs = { getCurrentEpoch: vi.fn() } as unknown as EpochService;
    const securityMetrics = { recordSuspiciousUserMetadata: vi.fn() } as unknown as SecurityMetricsService;
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockReturnValue(true);
    const guard = new AuthGuard(reflector, jwtVerifier, epochs, securityMetrics);

    const req: Record<string, unknown> = { headers: {}, requestId: "req-7" };
    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
    expect(jwtVerifier.verify).not.toHaveBeenCalled();
  });
});

describe("AppError shape used by the guard", () => {
  it("carries the closed code so callers can assert on .code directly", () => {
    const err = new AppError("unauthenticated");
    expect(err.code).toBe("unauthenticated");
  });
});
