/**
 * Placeholder pseudonymous identity for the drawer header.
 *
 * There is no backend in this stage (see brief scope), so this stands in for
 * what `docs/02-identity-spec.md` §5.3 calls the "public profile projection":
 * a small set of *already-generalised* strings that a real identity service
 * would compute server-side (handle, tier, and a k-anonymity-safe location
 * label) and hand to the client pre-rendered. The client never computes or
 * checks the k-anonymity floor itself — per the spec, the read path performs
 * "zero counts and zero joins".
 *
 * Deliberately NOT routed through i18next: this is user data, not UI copy.
 * `locationLabel` in particular is a pre-composed, grammatically-inflected
 * Azerbaijani string ("2-Cİ KURS") of exactly the kind the identity service
 * would emit — it wouldn't be reassembled client-side from a generic
 * translation key + number in production either. See README Open Questions.
 *
 * Per docs/03-navigation.md: never render faculty or real name here.
 */
export type VerificationTier = 'provisional' | 'email' | 'card';

export interface MockIdentity {
  handle: string;
  avatarSeed: string;
  tier: VerificationTier;
  /** University + study year only, already at the k-anonymity floor's L3 generalisation. No faculty. */
  locationLabel: string;
}

export const mockIdentity: MockIdentity = {
  handle: 'sakit-pərvanə-37',
  avatarSeed: '37',
  tier: 'email',
  locationLabel: 'BDU · 2-Cİ KURS',
};
