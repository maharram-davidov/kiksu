/**
 * The cursor payload shape, verbatim from `05-api-conventions.md` §4.3. Field names
 * are deliberately the terse single letters from the doc — the payload is embedded in
 * every cursor string, so its serialised size is part of the URL/header budget, and
 * matching the doc's own naming means anyone diffing this against the spec doesn't
 * have to mentally rename fields.
 */
export interface CursorPayload {
  /** Cursor format version. Bumping it invalidates outstanding cursors gracefully. */
  v: 1;
  /** Query fingerprint — hash of the endpoint plus every sort/filter parameter (§4.1's binding rule). */
  q: string;
  /**
   * The keyset tuple: the sort key(s) of the last row, then the tiebreaker id.
   * Always ends in an id so the ordering is total and no row can be skipped or repeated.
   * Kept as strings (ISO timestamps, UUIDs) — the signer/verifier never interprets
   * these, only the caller assembling/consuming the next query does.
   */
  k: string[];
  /** Sort direction. */
  d: "asc" | "desc";
  /** Expiry, epoch seconds. Cursors live 15 minutes (§4.3). */
  x: number;
}

export const CURSOR_TTL_SECONDS = 15 * 60;

/** Quantisation window for forum feed timestamps in a cursor's `k`, per §4.3. */
export const CURSOR_TIMESTAMP_QUANTUM_SECONDS = 60;
