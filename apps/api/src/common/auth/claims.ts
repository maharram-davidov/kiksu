import { z } from "zod";

/**
 * The trusted claim allowlist, verbatim from `05-api-conventions.md` §2.2 and identity
 * spec §7.1. These are the ONLY fields this service ever reads from a token, and they
 * are read from `app_metadata` (server-written by the `custom_access_token_hook`) or
 * the registered top-level claim set — never from `user_metadata`.
 */
export const TrustedAppMetadataSchema = z.object({
  app_user_id: z.string().uuid(),
  tier: z.enum(["provisional", "email", "card", "graduate", "expired"]),
  role: z.enum(["student", "moderator", "admin"]),
  univ_id: z.string().uuid(),
  epoch: z.number().int().nonnegative(),
  sid: z.string().uuid(),
});

export type TrustedAppMetadata = z.infer<typeof TrustedAppMetadataSchema>;

/**
 * §2.3's list of `user_metadata` keys that would grant something if we ever trusted
 * them — most importantly `tier`, which is the exact vector §2.3 calls out:
 * "`user_metadata.tier = 'card'` awarding the `ANONİM KART` badge and every
 * card-gated write." A request carrying any of these is served normally with the
 * values ignored; occurrence is a security metric, never a rejection (see
 * `auth.guard.ts` for why rejecting would itself leak the allowlist).
 */
export const SUSPICIOUS_USER_METADATA_KEYS = [
  "tier",
  "role",
  "app_user_id",
  "univ_id",
  "epoch",
  "verification_status",
  "karma",
  "contributor_level",
] as const;

export function findSuspiciousKeys(userMetadata: unknown): string[] {
  if (typeof userMetadata !== "object" || userMetadata === null) return [];
  const present = new Set(Object.keys(userMetadata));
  return SUSPICIOUS_USER_METADATA_KEYS.filter((key) => present.has(key));
}

/**
 * The Supabase auth email must always be the synthetic internal address — the
 * university address lives only in the sealed store as a keyed hash (identity spec
 * §7.2 trap 1). A token whose `email` claim doesn't match this shape is a defect in
 * the auth anchor, not a value to render or use.
 */
export const SYNTHETIC_EMAIL_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@users\.kiksu\.invalid$/i;

/**
 * Validates and narrows the raw `app_metadata` claim block down to exactly the
 * allowlisted shape. Returns `null` on any mismatch — missing field, wrong type, extra
 * shape mismatch — which the guard treats as `token_invalid`: a token that verifies
 * cryptographically but doesn't carry a well-formed Kiksu claim set isn't a valid
 * session for this API, whatever else it might be.
 */
export function parseTrustedAppMetadata(rawAppMetadata: unknown): TrustedAppMetadata | null {
  const result = TrustedAppMetadataSchema.safeParse(rawAppMetadata);
  return result.success ? result.data : null;
}
