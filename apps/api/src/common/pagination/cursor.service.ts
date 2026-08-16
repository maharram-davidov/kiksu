import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "../../config/config.service";
import { AppError } from "../errors/app-error";
import {
  CURSOR_TIMESTAMP_QUANTUM_SECONDS,
  CURSOR_TTL_SECONDS,
  type CursorPayload,
} from "./cursor.types";

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

/**
 * Signs and verifies keyset-pagination cursors per `05-api-conventions.md` §4.3.
 *
 * **Why HMAC and not just base64.** An unsigned cursor is an arbitrary
 * `WHERE created_at < ?` an attacker can hand-craft and binary-search — on the forum
 * that is exactly the sub-minute publication-time recovery T9 exists to prevent. The
 * signature is what makes "opaque" enforceable rather than a request that clients
 * behave: a modified or hand-crafted cursor fails verification and returns
 * `400 cursor_invalid`, full stop. Opacity also lets us change the sort key later
 * (§4.3 point 2) without a client change, and `q` prevents cross-endpoint cursor reuse
 * (§4.3 point 3) — both properties depend on no client ever having parsed a cursor, so
 * nothing in this API should ever describe the internal shape of `k` outside this file.
 */
@Injectable()
export class CursorService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Builds the `q` query fingerprint: a hash of the endpoint plus every sort/filter
   * parameter that must be identical between the request that minted a cursor and the
   * request that presents it back (§4.1: "Passing cursor together with any parameter
   * that changes the sort or the filter … is 400 cursor_invalid — the cursor binds its
   * query"). Deterministic regardless of key order; `undefined` values are dropped so
   * an omitted optional filter fingerprints identically whether it's absent or
   * explicitly undefined.
   */
  fingerprintQuery(endpoint: string, params: Record<string, string | number | boolean | undefined>): string {
    const normalised = Object.keys(params)
      .filter((key) => params[key] !== undefined)
      .sort()
      .map((key) => `${key}=${String(params[key])}`)
      .join("&");
    return createHash("sha256").update(`${endpoint}?${normalised}`).digest("hex").slice(0, 16);
  }

  /** Quantises a timestamp to the forum feed's 60 s bucket before it goes into a cursor's `k` (§4.3). */
  quantiseTimestamp(date: Date, quantumSeconds: number = CURSOR_TIMESTAMP_QUANTUM_SECONDS): string {
    const ms = date.getTime();
    const quantumMs = quantumSeconds * 1000;
    const quantised = Math.floor(ms / quantumMs) * quantumMs;
    return new Date(quantised).toISOString();
  }

  /** Mints an opaque, signed cursor string for the given keyset position. */
  sign(input: { queryFingerprint: string; keyset: string[]; direction: "asc" | "desc" }): string {
    const payload: CursorPayload = {
      v: 1,
      q: input.queryFingerprint,
      k: input.keyset,
      d: input.direction,
      x: Math.floor(Date.now() / 1000) + CURSOR_TTL_SECONDS,
    };
    const payloadB64 = base64url(JSON.stringify(payload));
    const signature = this.hmac(payloadB64);
    return `${payloadB64}.${signature}`;
  }

  /**
   * Verifies and decodes a cursor, binding it to the expected query fingerprint.
   * Throws `AppError("cursor_invalid")` for every failure mode — tampered signature,
   * malformed structure, wrong `v`, expired `x`, or `q` mismatch — deliberately
   * undifferentiated (same reasoning as §3.4's uniform codes): a distinguishable
   * failure reason would help an attacker iterate toward a forged cursor.
   */
  verify(cursor: string, expectedQueryFingerprint: string): CursorPayload {
    const parts = cursor.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new AppError("cursor_invalid");
    }
    const [payloadB64, signature] = parts as [string, string];

    const expectedSignature = this.hmac(payloadB64);
    if (!constantTimeEqual(signature, expectedSignature)) {
      throw new AppError("cursor_invalid");
    }

    let payload: CursorPayload;
    try {
      payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as CursorPayload;
    } catch {
      throw new AppError("cursor_invalid");
    }

    if (!isWellFormedPayload(payload)) {
      throw new AppError("cursor_invalid");
    }
    if (payload.v !== 1) {
      throw new AppError("cursor_invalid");
    }
    if (payload.q !== expectedQueryFingerprint) {
      throw new AppError("cursor_invalid");
    }
    if (payload.x < Math.floor(Date.now() / 1000)) {
      throw new AppError("cursor_invalid");
    }

    return payload;
  }

  private hmac(payloadB64: string): string {
    return createHmac("sha256", this.config.cursorHmacSecret).update(payloadB64).digest("base64url");
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function isWellFormedPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.v === "number" &&
    typeof v.q === "string" &&
    Array.isArray(v.k) &&
    v.k.every((entry) => typeof entry === "string") &&
    (v.d === "asc" || v.d === "desc") &&
    typeof v.x === "number"
  );
}
