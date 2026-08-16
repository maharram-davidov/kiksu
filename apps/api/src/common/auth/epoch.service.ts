import { Injectable, Logger } from "@nestjs/common";

/**
 * Answers "what is `app_user_id`'s current epoch" — the revocation primitive from
 * identity spec §7.4: `token.epoch < current_epoch(app_user_id)` is the entire
 * revocation check, and it must be a hot-path, sub-millisecond lookup (an in-process
 * LRU fronting Redis, invalidated by Postgres `LISTEN/NOTIFY` on epoch bumps, per the
 * spec). Wiring that cache is out of scope for this scaffold — no Redis/DB connection
 * is configured here — so this interface exists as the seam an endpoint-implementing
 * agent wires up, and the guard already calls it correctly on every request.
 */
export abstract class EpochService {
  abstract getCurrentEpoch(appUserId: string): Promise<number>;
}

/**
 * Scaffold default: always reports the token's own epoch, i.e. never stale. This is
 * intentionally NOT a real revocation check — bans, suspensions, and tier changes will
 * NOT take effect on already-issued tokens until this is replaced with the Redis+
 * LISTEN/NOTIFY-backed implementation identity spec §7.4 describes. Fine for local
 * dev and for this scaffold's tests, which supply their own stub; wrong for
 * production. Flagged in the README.
 */
@Injectable()
export class NoopEpochService extends EpochService {
  private readonly logger = new Logger("NoopEpochService");
  private warned = false;

  async getCurrentEpoch(_appUserId: string): Promise<number> {
    if (!this.warned) {
      this.logger.warn(
        "NoopEpochService is active: token.epoch is never checked against a live value. " +
          "Bans/suspensions/tier changes will not revoke existing tokens. Replace before production.",
      );
      this.warned = true;
    }
    return Number.NEGATIVE_INFINITY; // token.epoch is always >= this, so the check never trips.
  }
}
