import { Injectable, Logger } from "@nestjs/common";

/**
 * Where the "counted as a security metric" half of §2.3 lands. A request whose
 * `user_metadata` contains an allowlisted-looking key is never rejected (that would
 * disclose the allowlist) but must still be observable — this is how someone would
 * notice a client, or an attacker, probing `user_metadata.tier`.
 *
 * Scaffold implementation logs a structured line. Swap for a real counter (statsd/
 * Prometheus/whatever this deploys with) before shipping — the log line is a floor,
 * not the intended long-term destination, because a log line nobody dashboards is not
 * a metric.
 */
@Injectable()
export class SecurityMetricsService {
  private readonly logger = new Logger("SecurityMetrics");

  /**
   * NEVER logs the `user_metadata` values themselves — only which allowlisted-looking
   * key names showed up. The values are attacker-controlled and arbitrary; logging
   * them would make this log line exactly the kind of thing log hygiene (identity spec
   * assertion 32, §8.3) exists to prevent.
   */
  recordSuspiciousUserMetadata(keys: string[], requestId: string | undefined): void {
    this.logger.warn(
      `suspicious_user_metadata_keys request_id=${requestId ?? "unknown"} keys=${keys.join(",")}`,
    );
  }
}
