/** Matches `components.schemas.PageInfo` in `05-openapi.yaml` exactly. No `total_count` — see §4.2. */
export interface PageInfo {
  next_cursor: string | null;
  has_more: boolean;
}

/** `limit` clamping per §4.1: "A larger value is clamped, not rejected." Never throws. */
export function clampLimit(requested: unknown, { min = 1, max = 50, fallback = 20 } = {}): number {
  const n = typeof requested === "number" ? requested : Number.parseInt(String(requested ?? ""), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
