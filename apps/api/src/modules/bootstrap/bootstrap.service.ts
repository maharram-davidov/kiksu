import { Injectable } from "@nestjs/common";
import { ConfigService } from "../../config/config.service";
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../../common/locale/locale";
import type { BootstrapResponse } from "./bootstrap.types";

/**
 * `GET /v1/bootstrap` — the cold-start contract (§1.3). This is the one endpoint this
 * scaffold implements end to end as the worked example for later agents.
 *
 * Deliberately does the absolute minimum amount of work: no DB call, no auth, no
 * per-caller branching. §1.3 is explicit that this must be "the single cheapest
 * endpoint in the product" and that a bootstrap outage must never brick the app — the
 * fewer things this depends on, the less there is that can make it fail.
 */
@Injectable()
export class BootstrapService {
  constructor(private readonly config: ConfigService) {}

  getBootstrap(): BootstrapResponse {
    return {
      min_supported_client: this.config.minSupportedClient,
      recommended_client: this.config.recommendedClient,
      // Only /v1 exists in this scaffold. When /v2 ships alongside it (§1.5), this
      // array gains a second entry and /v1's `sunset_at` moves from null to the
      // announced date — no other change to this endpoint's shape.
      api_versions: [{ version: "v1", sunset_at: null }],
      store_urls: this.config.storeUrls,
      locales: { supported: [...SUPPORTED_LOCALES], default: DEFAULT_LOCALE },
      // Extension points for later work, not unused fields: `flags` is where a
      // server-owned feature flag would appear (§1.6); `copy_overrides` is how the
      // verification SLA honesty rule (§1.6, identity spec §2.1/§2.2) reaches the
      // client without an app-store release once that mechanism is wired to real
      // measurements. Both are legitimately empty until something populates them.
      flags: {},
      copy_overrides: {},
    };
  }
}
