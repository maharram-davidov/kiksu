import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { CursorService } from "../src/common/pagination/cursor.service";
import type { ConfigService } from "../src/config/config.service";
import { AppError } from "../src/common/errors/app-error";

const SECRET = "a".repeat(32);

function buildCursorService(secret = SECRET): CursorService {
  const config = { cursorHmacSecret: secret } as unknown as ConfigService;
  return new CursorService(config);
}

/** Builds a cursor by hand, replicating cursor.service.ts's exact HMAC scheme, so tests can construct payloads (like an already-expired one) that `sign()` would never produce on its own. */
function handSignCursor(payload: unknown, secret = SECRET): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

describe("CursorService — signed keyset cursors (05-api-conventions.md §4.3)", () => {
  let cursors: CursorService;

  beforeEach(() => {
    cursors = buildCursorService();
  });

  it("round-trips a signed cursor and returns the original keyset", () => {
    const fingerprint = cursors.fingerprintQuery("/v1/boards/abc/posts", { tab: "new", limit: 20 });
    const signed = cursors.sign({
      queryFingerprint: fingerprint,
      keyset: ["2025-10-27T14:00:00.000Z", "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa"],
      direction: "desc",
    });

    const decoded = cursors.verify(signed, fingerprint);

    expect(decoded.k).toEqual(["2025-10-27T14:00:00.000Z", "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa"]);
    expect(decoded.d).toBe("desc");
    expect(decoded.v).toBe(1);
  });

  it("is opaque: two dot-separated base64url segments, nothing a client is meant to parse", () => {
    const fingerprint = cursors.fingerprintQuery("/v1/boards/abc/posts", { tab: "new" });
    const signed = cursors.sign({ queryFingerprint: fingerprint, keyset: ["x"], direction: "asc" });
    expect(signed.split(".")).toHaveLength(2);
  });

  it("rejects a cursor whose payload was tampered with after signing", () => {
    const fingerprint = cursors.fingerprintQuery("/v1/boards/abc/posts", { tab: "new" });
    const signed = cursors.sign({
      queryFingerprint: fingerprint,
      keyset: ["2025-10-27T14:00:00.000Z", "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa"],
      direction: "desc",
    });

    const [payloadB64, signature] = signed.split(".") as [string, string];
    const tamperedPayload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    // An attacker tries to binary-search publication time by editing the keyset directly,
    // keeping the original (now-invalid) signature attached.
    tamperedPayload.k = ["2099-01-01T00:00:00.000Z", "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa"];
    const tamperedPayloadB64 = Buffer.from(JSON.stringify(tamperedPayload)).toString("base64url");
    const tamperedCursor = `${tamperedPayloadB64}.${signature}`;

    let caught: unknown;
    try {
      cursors.verify(tamperedCursor, fingerprint);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("cursor_invalid");
  });

  it("rejects a cursor signed with a different secret (e.g. after key rotation)", () => {
    const fingerprint = cursors.fingerprintQuery("/v1/boards/abc/posts", { tab: "new" });
    const signedByOther = buildCursorService("b".repeat(32)).sign({
      queryFingerprint: fingerprint,
      keyset: ["x"],
      direction: "asc",
    });

    expect(() => cursors.verify(signedByOther, fingerprint)).toThrow(AppError);
  });

  it("rejects a cursor bound to a different query (§4.1: cursor binds tab/sort/filter)", () => {
    const newTabFingerprint = cursors.fingerprintQuery("/v1/boards/abc/posts", { tab: "new" });
    const hotTabFingerprint = cursors.fingerprintQuery("/v1/boards/abc/posts", { tab: "hot" });
    const signed = cursors.sign({ queryFingerprint: newTabFingerprint, keyset: ["x"], direction: "desc" });

    expect(() => cursors.verify(signed, hotTabFingerprint)).toThrow(AppError);
  });

  it("rejects a structurally malformed cursor without an unhandled exception", () => {
    expect(() => cursors.verify("not-a-real-cursor", "fingerprint")).toThrow(AppError);
    expect(() => cursors.verify("", "fingerprint")).toThrow(AppError);
    expect(() => cursors.verify("onlyonepart", "fingerprint")).toThrow(AppError);
  });

  it("rejects an expired cursor even with a valid signature", () => {
    const fingerprint = cursors.fingerprintQuery("/v1/x", {});
    const expiredPayload = {
      v: 1,
      q: fingerprint,
      k: ["x"],
      d: "asc",
      x: Math.floor(Date.now() / 1000) - 10, // 10s in the past
    };
    const expiredCursor = handSignCursor(expiredPayload);

    let caught: unknown;
    try {
      cursors.verify(expiredCursor, fingerprint);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("cursor_invalid");
  });

  it("quantises timestamps to the 60s forum feed window (§4.3)", () => {
    const t1 = cursors.quantiseTimestamp(new Date("2025-10-27T14:00:12.000Z"));
    const t2 = cursors.quantiseTimestamp(new Date("2025-10-27T14:00:59.999Z"));
    const t3 = cursors.quantiseTimestamp(new Date("2025-10-27T14:01:00.000Z"));

    expect(t1).toBe("2025-10-27T14:00:00.000Z");
    expect(t2).toBe("2025-10-27T14:00:00.000Z"); // same 60s bucket as t1
    expect(t3).toBe("2025-10-27T14:01:00.000Z"); // next bucket
  });

  it("fingerprintQuery is deterministic regardless of key order and ignores undefined values", () => {
    const a = cursors.fingerprintQuery("/v1/x", { tab: "new", q: undefined, limit: 20 });
    const b = cursors.fingerprintQuery("/v1/x", { limit: 20, tab: "new" });
    expect(a).toBe(b);
  });
});
