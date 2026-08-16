/**
 * What the server trusts about the caller for the lifetime of one request — populated
 * by `AuthGuard` from the JWT's `app_metadata` (server-written) claims ONLY, per
 * `05-api-conventions.md` §2.2 / identity spec §7.1.
 *
 * Deliberately does NOT contain: email, phone, handle, karma, faculty, entry year,
 * study year, or anything from `user_metadata`. If a field isn't in this interface,
 * no authorisation decision downstream should need it from the token — look it up
 * server-side instead (per-board moderator scope is the example the conventions doc
 * gives: it changes more often than tokens are minted, so it's a server lookup, never
 * a claim).
 */
export interface KiksuRequestContext {
  /** Supabase auth subject (`sub`). Never rendered, never returned to any client. */
  authUserId: string;
  /** Ownership key on every non-identity table. */
  appUserId: string;
  tier: "provisional" | "email" | "card" | "graduate" | "expired";
  /** Coarse only. Per-board moderator scope is looked up server-side, not carried here. */
  role: "student" | "moderator" | "admin";
  /** Campus scoping. */
  univId: string;
  /** Revocation counter — already checked against the live value by the time this exists. */
  epoch: number;
  /** Session-scoped log correlation id. Use this in logs, never `appUserId` alongside content ids. */
  sid: string;
}
