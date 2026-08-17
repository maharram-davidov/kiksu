import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One verified person, one app_user.
 *
 * The brief originally said "salted credential hash". That cannot work: a
 * per-row random salt means the same credential hashes differently every time,
 * so uniqueness becomes unenforceable — which is the entire point of the
 * column. This uses a KEYED hash instead: HMAC-SHA256 under a server-held
 * pepper, so the same credential always produces the same digest while an
 * attacker who steals the table still cannot enumerate student emails offline.
 *
 * The pepper NEVER leaves the server and is never stored beside the digests.
 * Rotating it invalidates every binding, so it is versioned: digests carry a
 * `v1:` prefix and a future rotation writes `v2:` alongside rather than
 * breaking every existing account at once.
 */

/**
 * The pepper generation. The identity schema stores this in a `key_version`
 * smallint column beside each digest rather than as a string prefix, so a
 * rotation writes new rows at version 2 while version 1 rows stay verifiable.
 */
export const CREDENTIAL_KEY_VERSION = 1;

/**
 * Azerbaijani has a dotted/dotless i distinction: I/ı and İ/i are four
 * separate letters. Under an `az` locale, "I".toLowerCase() returns "ı"
 * (dotless), not "i".
 *
 * That matters because a student verifying on a phone set to Azerbaijani would
 * otherwise produce a different digest than the same student on an English
 * phone, or than the server. The failure is bidirectional and both directions
 * are bad: the same person gets two accounts (breaking one-person-one-account),
 * and two different credentials can collide onto one digest (locking a real
 * student out of their own account).
 *
 * `toLowerCase()` with no locale argument uses the *invariant* Unicode mapping
 * in Node regardless of host locale, which is what we want — but relying on
 * that implicitly is exactly the sort of thing a later refactor "tidies" into
 * `toLocaleLowerCase()`. Normalising through an explicit invariant helper, with
 * this comment attached, makes the requirement visible.
 */
export function normaliseCredential(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/İ/g, "i")   // İ -> i  (dotted capital I)
    .replace(/ı/g, "i")   // ı -> i  (dotless small i)
    .toLowerCase()             // invariant mapping, never toLocaleLowerCase
    .trim();
}

export type CredentialKind = "university_email" | "student_card" | "phone";

/**
 * Deterministic keyed digest of a credential, as raw bytes for the schema's
 * `bytea` columns. Stable across devices and locales.
 */
export function hashCredentialBytes(kind: CredentialKind, raw: string, pepper: string): Buffer {
  if (!pepper || pepper.length < 32) {
    // Fail loudly at the call site rather than silently hashing under a weak
    // key: a short pepper is brute-forceable and would make the digests
    // reversible to anyone holding the table.
    throw new Error("credential pepper must be at least 32 characters");
  }
  const normalised = normaliseCredential(raw);
  return createHmac("sha256", pepper)
    .update(`${CREDENTIAL_KEY_VERSION}:${kind}:${normalised}`)
    .digest();
}

/** Hex form, for logs and tests. Never store this — the columns are bytea. */
export function hashCredential(kind: CredentialKind, raw: string, pepper: string): string {
  return `v${CREDENTIAL_KEY_VERSION}:${hashCredentialBytes(kind, raw, pepper).toString("hex")}`;
}

/** HMAC of a one-time code. The code itself is never stored. */
export function hashChallenge(code: string, pepper: string): Buffer {
  return createHmac("sha256", pepper).update(`otp:${code}`).digest();
}

/** Constant-time comparison, so digest checks do not leak via timing. */
export function credentialMatches(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
