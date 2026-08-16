import { Injectable, Logger } from "@nestjs/common";

/**
 * Answers "how old is this app_user's account" — the input to `age_multiplier()`
 * (§5.2). Not carried in the JWT (identity spec §7.1's claim list has no
 * `created_at`), so it has to be a lookup, and it's a separate seam from
 * `EpochService` because it comes from a different store (`app_user.created_at`,
 * which `authenticated` cannot even select — §01-schema-notes.md's "seven safe
 * columns" — so this has to go through the server layer, not a client-visible view).
 */
export abstract class AccountAgeService {
  abstract getAccountAgeMs(appUserId: string): Promise<number>;
}

/**
 * Scaffold default: reports age 0 (brand-new) for every account, which lands every
 * caller in the strictest `age_multiplier` bracket (0.25×) until this is wired to a
 * real lookup. This is the fail-SAFE direction for a security control — the cost is
 * over-throttling real established accounts, not under-throttling an attacker's fresh
 * one. Replace before production; over-throttling legitimate users will be very
 * noticeable very quickly, which is the point (it fails loud, not silent).
 */
@Injectable()
export class NoopAccountAgeService extends AccountAgeService {
  private readonly logger = new Logger("NoopAccountAgeService");
  private warned = false;

  async getAccountAgeMs(_appUserId: string): Promise<number> {
    if (!this.warned) {
      this.logger.warn(
        "NoopAccountAgeService is active: every account is treated as < 24h old for rate-limit " +
          "scaling (the strictest bracket). Replace before production.",
      );
      this.warned = true;
    }
    return 0;
  }
}
