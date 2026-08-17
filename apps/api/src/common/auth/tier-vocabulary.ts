/**
 * The two verification-tier vocabularies, and the translation between them.
 *
 * They are genuinely different sets, not a naming inconsistency to be tidied
 * away:
 *
 *   database  `public.verification_tier`   unverified | email_verified | card_verified
 *   token     identity spec §7.1           provisional | email | card | graduate | expired
 *
 * Before this module nothing mapped between them, and the two leaked into each
 * other: `buildDevContext` emitted the token vocabulary while
 * `OnboardingService.confirmEmailVerification` returned the database one to the
 * mobile client, so the app saw a different tier string depending on whether it
 * had just signed up or just restarted.
 *
 * The authoritative mapping lives in SQL, in `internal.token_claims` (migration
 * `0021_auth_claims_hook.sql`), because that is what actually stamps a live
 * token. This module is its twin for the paths that never pass through the
 * hook — the development bypass, and the onboarding response that tells the app
 * what it just became. `tier-vocabulary.spec.ts` asserts the two agree; if you
 * change one, the test fails until you change the other.
 */

/** Values of the `public.verification_tier` enum. */
export const DB_TIERS = ["unverified", "email_verified", "card_verified"] as const;
export type DbTier = (typeof DB_TIERS)[number];

/** The `tier` claim allowlist from identity spec §7.1. Mirrors `claims.ts`. */
export const TOKEN_TIERS = ["provisional", "email", "card", "graduate", "expired"] as const;
export type TokenTier = (typeof TOKEN_TIERS)[number];

/**
 * Database tier to token tier.
 *
 * Total over `DbTier` — every row in the table can produce a claim.
 */
const DB_TO_TOKEN: Record<DbTier, TokenTier> = {
  unverified: "provisional",
  email_verified: "email",
  card_verified: "card",
};

export function dbTierToToken(tier: DbTier): TokenTier {
  return DB_TO_TOKEN[tier];
}

/**
 * Token tier back to a database tier, where one exists.
 *
 * DELIBERATELY PARTIAL. `graduate` and `expired` return null because nothing in
 * the schema can represent them: there is no graduation transition and no
 * credential-expiry job, so no `app_user` row produces either value and no
 * write should invent one.
 *
 * They stay in the allowlist rather than being deleted because identity spec
 * §7.3 names both as epoch-bump triggers, so the API should not need changing
 * when the job that produces them is eventually written.
 *
 * Resist the temptation to map them onto `app_user_status` or
 * `suspended_until`. Suspension is not expiry — a suspended student is still a
 * verified student — and collapsing the two would silently downgrade the badge
 * of everyone serving a temporary sanction, which is a visible, public
 * punishment the moderation flow never decided to impose.
 */
export function tokenTierToDb(tier: TokenTier): DbTier | null {
  switch (tier) {
    case "provisional":
      return "unverified";
    case "email":
      return "email_verified";
    case "card":
      return "card_verified";
    case "graduate":
    case "expired":
      return null;
  }
}

/**
 * Token tiers that no current code path can produce, and why.
 *
 * Exported so the test can assert the list rather than restating it, and so a
 * future graduation job has one obvious place to delete from.
 */
export const UNREACHABLE_TOKEN_TIERS = ["graduate", "expired"] as const satisfies readonly TokenTier[];
