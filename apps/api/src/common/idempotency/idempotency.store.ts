import { Injectable } from "@nestjs/common";
import { type BeginOutcome, IDEMPOTENCY_RETENTION_MS, type IdempotencyRecord } from "./idempotency.types";

/**
 * Storage seam for idempotency records, scoped by the caller to
 * `(app_user_id, method, path, key)` per §6.2. `InMemoryIdempotencyStore` is correct
 * for a single process only — same caveat as `RateLimitStore`: a multi-instance
 * deployment needs a shared backend (Redis, with `SET NX` for `begin` and a TTL for
 * the 24h retention) or two instances can both think they "won" a concurrent request
 * with the same key. Swap before shipping; see `IDEMPOTENCY_STORE` in `.env.example`.
 */
export abstract class IdempotencyStore {
  /**
   * Atomically decides what to do with `(scopeKey, requestBodyHash)`:
   * - no record yet → `proceed` (and marks the key `in_flight`)
   * - completed record, same hash → `replay`
   * - any record, different hash → `key_reused` (§6.2: 422 `idempotency_key_reused`)
   * - in_flight record, same hash → `in_flight` (§6.2: 409, `Retry-After: 1`)
   */
  abstract begin(scopeKey: string, requestBodyHash: string): Promise<BeginOutcome>;

  /** Marks an in-flight record completed with the response that will be replayed on retry. */
  abstract complete(scopeKey: string, statusCode: number, body: unknown): Promise<void>;

  /**
   * Releases an in-flight record WITHOUT storing it as completed — used when the
   * handler failed with a server error (5xx). This is a deliberate reading beyond the
   * doc's literal text: caching a *transient* server failure forever under a key would
   * permanently brick a legitimate retry after the transient condition clears, which
   * seems clearly not the intent of "first request wins" (that guarantee exists to
   * stop duplicate *side effects*, not to freeze a 503 in amber). 4xx responses ARE
   * cached via `complete()` — a validation failure is deterministic for the same body,
   * so replaying it is both correct and cheap. Noted in the README as a documented
   * implementation choice, not a spec quote.
   */
  abstract release(scopeKey: string): Promise<void>;
}

@Injectable()
export class InMemoryIdempotencyStore extends IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async begin(scopeKey: string, requestBodyHash: string): Promise<BeginOutcome> {
    this.sweepIfStale(scopeKey);
    const existing = this.records.get(scopeKey);

    if (!existing) {
      this.records.set(scopeKey, { state: "in_flight", requestBodyHash, createdAt: Date.now() });
      return { kind: "proceed" };
    }

    if (existing.requestBodyHash !== requestBodyHash) {
      return { kind: "key_reused" };
    }

    if (existing.state === "in_flight") {
      return { kind: "in_flight" };
    }

    return { kind: "replay", record: existing };
  }

  async complete(scopeKey: string, statusCode: number, body: unknown): Promise<void> {
    const existing = this.records.get(scopeKey);
    if (!existing) return; // release() or an expiry raced us; nothing to complete.
    existing.state = "completed";
    existing.statusCode = statusCode;
    existing.body = body;
  }

  async release(scopeKey: string): Promise<void> {
    this.records.delete(scopeKey);
  }

  private sweepIfStale(scopeKey: string): void {
    const existing = this.records.get(scopeKey);
    if (existing && Date.now() - existing.createdAt > IDEMPOTENCY_RETENTION_MS) {
      this.records.delete(scopeKey);
    }
  }
}
