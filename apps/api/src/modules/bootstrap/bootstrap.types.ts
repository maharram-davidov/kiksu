import type { Locale } from "../../common/locale/locale";

/** Matches `components.schemas.Bootstrap` in `05-openapi.yaml` field for field. */
export interface BootstrapResponse {
  min_supported_client: { ios: string; android: string };
  recommended_client: { ios: string; android: string };
  api_versions: Array<{ version: string; sunset_at: string | null }>;
  store_urls: { ios: string; android: string };
  locales: { supported: Locale[]; default: Locale };
  /** Server-owned feature flags (§1.6). Never anything user-specific. */
  flags: Record<string, unknown>;
  /** Strings the client must prefer over its bundled copy (§1.6). Empty until a live SLA-honesty override exists. */
  copy_overrides: Record<string, string>;
}
