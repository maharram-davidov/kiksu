import { Injectable } from "@nestjs/common";
import { SqlProvider } from "../db/sql.provider";
import { AppError } from "../errors/app-error";
import type { KiksuRequestContext } from "../auth/request-context";

/** What the caller's account currently permits. */
export interface SanctionState {
  status: string;
  /** Null for a permanent sanction or none at all. */
  suspended_until: string | null;
  may_write: boolean;
}

/**
 * Whether the caller is allowed to write.
 *
 * Four things about the shape here, and each of them is a decision rather than
 * an implementation detail.
 *
 * 1. THIS IS A PER-REQUEST LOOKUP, NOT A TOKEN CLAIM. Putting `status`
 *    alongside `tier` in the access token would be cheaper and is wrong:
 *    identity spec §7.1 closes with "That is the complete list. Anything not
 *    on it is not in the token", and invariant 11 asserts the claims
 *    projection is exactly six columns. A seventh is a security change to
 *    every token the product has ever issued. It is also the same argument
 *    StaffGuard makes about moderator membership — a claim is only as fresh
 *    as the last mint, and a ban has to bite now, not in fifteen minutes.
 *
 * 2. WRITES ONLY. Reads stay open to a suspended student, deliberately: they
 *    have to be able to sign in and find out what happened and why. That is
 *    the same reasoning that keeps suspended and shadowbanned accounts inside
 *    `internal.token_claims` instead of stripping their claims.
 *
 * 3. EXPIRY IS EVALUATED HERE, not by a scheduled job. `suspended_until` in
 *    the past means active again, computed at the moment it is asked. A job
 *    that flips statuses back would leave a window — however short — where a
 *    lapsed suspension still refuses someone, and would be one more thing
 *    that can silently stop running.
 *
 * 4. A SHADOWBANNED CALLER IS NOT REFUSED. Telling them would defeat the
 *    entire point of the sanction. Their writes succeed; what changes is the
 *    moderation_state their content lands in — see ModerationService.
 */
@Injectable()
export class SanctionsService {
  constructor(private readonly db: SqlProvider) {}

  /**
   * @throws AppError('account_banned')     — permanent sanction, no expiry.
   * @throws AppError('account_suspended')  — timed sanction still running.
   */
  async assertMayWrite(user: KiksuRequestContext): Promise<void> {
    const state = await this.stateOf(user.appUserId);
    if (state.may_write) return;

    // Distinguished because the two say different things to a student and the
    // catalogue gives both `contact_support`: one ends on a date, the other
    // does not, and a person deciding whether to appeal needs to know which.
    throw new AppError(state.suspended_until ? "account_suspended" : "account_banned", {
      details: state.suspended_until ? { until: state.suspended_until } : {},
    });
  }

  /** The caller's own sanction state. Safe to show them; it is their own row. */
  async stateOf(appUserId: string): Promise<SanctionState> {
    const [row] = await this.db.sql<Array<{
      status: string; suspended_until: Date | null; expired: boolean;
    }>>`
      select status::text,
             suspended_until,
             -- Computed in SQL so "has it lapsed" uses the database clock, not
             -- the API server's. Two instances with skewed clocks must not
             -- disagree about whether someone is still suspended.
             (suspended_until is not null and suspended_until <= now()) as expired
        from public.app_user
       where id = ${appUserId}
    `;

    // No row is not a sanction — it is a caller whose app_user has gone. Every
    // write path resolves the author anyway and will fail on its own terms.
    if (!row) return { status: "unknown", suspended_until: null, may_write: true };

    const lapsed = row.expired;
    const blocking = new Set(["muted", "suspended"]);

    return {
      status: row.status,
      suspended_until: lapsed ? null : (row.suspended_until?.toISOString() ?? null),
      // 'shadowbanned' is deliberately absent from the blocking set.
      // 'deactivated' and 'erased' are absent too: those callers hold no token
      // claims at all, so they never reach a write path to be refused here.
      may_write: lapsed || !blocking.has(row.status),
    };
  }
}
