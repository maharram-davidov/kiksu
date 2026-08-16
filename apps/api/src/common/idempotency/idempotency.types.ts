export interface IdempotencyRecord {
  state: "in_flight" | "completed";
  requestBodyHash: string;
  statusCode?: number;
  body?: unknown;
  createdAt: number; // epoch ms — retention is 24h (§6.2)
}

export type BeginOutcome =
  /** No prior record for this key: caller should run the handler. */
  | { kind: "proceed" }
  /** A completed record with a matching body hash: replay it verbatim. */
  | { kind: "replay"; record: IdempotencyRecord }
  /** A completed (or in-flight) record with a DIFFERENT body hash: client bug (§6.2). */
  | { kind: "key_reused" }
  /** The first request with this key is still running (§6.2: 409, Retry-After: 1). */
  | { kind: "in_flight" };

export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
