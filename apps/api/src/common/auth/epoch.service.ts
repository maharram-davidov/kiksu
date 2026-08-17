import { Injectable, Logger } from "@nestjs/common";
import { SqlProvider } from "../db/sql.provider";

/**
 * The eight events that revoke a live token, from identity spec §7.3, plus the
 * row's initial state. Kept in step with the check constraint on
 * `internal.auth_epoch.reason` — a value missing from either side is a failed
 * write, which is the point: a bump with an unrecognised reason would be a hole
 * in the only record of why someone was logged out.
 */
export const EPOCH_BUMP_REASONS = [
  "provisioned",
  "tier_grant",
  "tier_expiry",
  "graduation",
  "suspension",
  "ban",
  "unban",
  "role_change",
  "forced_logout",
] as const;

export type EpochBumpReason = (typeof EPOCH_BUMP_REASONS)[number];

/**
 * Answers "what is `app_user_id`'s current epoch" — the revocation primitive
 * from identity spec §7.4. `token.epoch < current_epoch(app_user_id)` is the
 * entire revocation check, and it runs on every authenticated request, so it
 * has to be cheap enough that nobody is ever tempted to skip it.
 */
export abstract class EpochService {
  abstract getCurrentEpoch(appUserId: string): Promise<number>;

  /**
   * Increments the counter, invalidating every token already issued to this
   * user. Returns the new value.
   */
  abstract bump(appUserId: string, reason: EpochBumpReason): Promise<number>;
}

/** How long a cached epoch may be trusted. See the staleness note on the class. */
const CACHE_TTL_MS = 30_000;

/** Entries above this are evicted oldest-first. Bounds memory on a long-lived process. */
const CACHE_MAX_ENTRIES = 10_000;

/**
 * Epoch lookups backed by `internal.auth_epoch`, fronted by an in-process cache.
 *
 * WHAT THIS IS NOT: identity spec §7.4 describes an in-process LRU fronting
 * Redis, invalidated by Postgres `LISTEN/NOTIFY` on every bump, for sub-second
 * revocation across instances. **The Redis layer and the LISTEN/NOTIFY
 * invalidation are not built.** This is the cache and the indexed lookup only.
 *
 * WHY THAT IS STILL CORRECT: the spec's stated requirement is an "effective
 * revocation latency target: ≤ 60 s". A bump writes to Postgres immediately and
 * clears the local entry, so the instance that handled the ban revokes at once.
 * Other instances keep serving a stale epoch until their own entry expires,
 * which bounds the worst case at {@link CACHE_TTL_MS} — 30 s, inside the
 * target with room to spare. What is lost against the full design is the
 * sub-second cross-instance figure, not correctness.
 *
 * The cost of the miss path is one primary-key lookup on a table with one row
 * per user, so a cold cache is not a cliff.
 */
@Injectable()
export class DbEpochService extends EpochService {
  private readonly logger = new Logger(DbEpochService.name);

  /**
   * Insertion-ordered, which is what makes the eviction below oldest-first
   * without a separate structure: `Map` iterates in insertion order, and every
   * write deletes before setting so a refreshed key moves to the end.
   */
  private readonly cache = new Map<string, { epoch: number; expiresAt: number }>();

  constructor(private readonly db: SqlProvider) {
    super();
  }

  async getCurrentEpoch(appUserId: string): Promise<number> {
    const hit = this.cache.get(appUserId);
    if (hit && hit.expiresAt > Date.now()) return hit.epoch;

    const [row] = await this.db.sql<Array<{ epoch: number }>>`
      select epoch from internal.auth_epoch where app_user_id = ${appUserId}
    `;

    // No row means nobody has ever bumped this user, so no token of theirs can
    // be stale. 1 matches the coalesce in internal.token_claims, and
    // bump_auth_epoch seeds at 2, so a first bump still outranks whatever a
    // live token is carrying.
    const epoch = row?.epoch ?? 1;
    this.remember(appUserId, epoch);
    return epoch;
  }

  async bump(appUserId: string, reason: EpochBumpReason): Promise<number> {
    const [row] = await this.db.sql<Array<{ epoch: number }>>`
      select internal.bump_auth_epoch(${appUserId}, ${reason}) as epoch
    `;
    const epoch = row?.epoch ?? 1;

    // Write through rather than merely invalidating: the caller that just
    // granted a tier usually mints or refreshes a token immediately, and a
    // delete would send that request straight back to the database for a value
    // this method already knows.
    this.remember(appUserId, epoch);

    this.logger.log(`epoch bumped to ${epoch} for app_user ${appUserId} (${reason})`);
    return epoch;
  }

  private remember(appUserId: string, epoch: number): void {
    // Delete first so a refreshed key moves to the end of the insertion order
    // and is not evicted as though it were old.
    this.cache.delete(appUserId);
    this.cache.set(appUserId, { epoch, expiresAt: Date.now() + CACHE_TTL_MS });

    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}
