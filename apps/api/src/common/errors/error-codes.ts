/**
 * The closed error-code set, verbatim from `docs/05-api-conventions.md` §3.3.
 *
 * This is a *closed* enum in the client's terms (§1.4): a client may `switch` on
 * `error.code` without a `default` case for any value in this union. Adding a member
 * here inside a major API version is allowed (old clients fall back to `message`).
 * Removing or repurposing one is a breaking change and needs a new major version.
 *
 * Do not add a code here without also adding it to `HTTP_STATUS_BY_CODE` and to every
 * locale table in `error-catalogue.ts` — `ErrorCode` is intentionally the type both of
 * those are keyed by, so a missing entry is a compile error, not a runtime gap.
 */
export const ERROR_CODES = [
  // Transport / client
  "client_version_unsupported",
  "malformed_request",
  "validation_failed",
  "cursor_invalid",
  "unsupported_media_type",
  "payload_too_large",
  "not_found",
  "conflict",
  "precondition_failed",
  "rate_limited",

  // Auth / account
  "unauthenticated",
  "token_stale",
  "token_invalid",
  "forbidden",
  "verification_required",
  "verification_expired",
  "tier_insufficient",
  "sanction_active",
  "account_suspended",
  "account_banned",
  "not_campus_member",

  // Onboarding / verification
  "verification_route_unavailable",
  "email_domain_not_recognised",
  "verification_domain_not_allowed",
  "verification_challenge_invalid",
  "verification_challenge_locked",
  "verification_in_progress",
  "credential_unavailable",
  "invite_code_invalid",
  "invite_quota_exhausted",
  "invite_not_permitted",
  "card_submission_limit_reached",
  "card_review_pending",

  // Identity / profile
  "handle_cooldown_active",
  "handle_space_exhausted",
  "discovery_disabled",

  // Forum
  "board_archived",
  "post_locked",
  "content_removed",
  "alias_reservation_expired",
  "poll_closed",
  "poll_choice_limit",
  "attachment_rejected",
  "daily_post_quota",

  // Timetable
  "already_enrolled",
  "not_enrolled",
  "section_full",
  "term_closed",
  "absence_already_recorded",
  "grade_scale_unknown",

  // Reviews
  "review_wall_active",
  "review_already_written",
  "review_term_not_reviewable",
  "review_tag_unknown",

  // Server
  "internal_error",
  "service_unavailable",
  "dependency_timeout",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Codes covering several distinct underlying causes on purpose (§3.4). Each MUST
 * produce a byte-identical body and an equalised response time across every cause it
 * covers — a precise error here is an enumeration oracle. Enforced by convention at
 * every call site: never attach a `details` field to these that would let a client (or
 * an attacker) tell the causes apart, and never special-case the timing.
 *
 * - `invite_code_invalid`      — wrong code · expired · already consumed · wrong university
 * - `credential_unavailable`   — credential already bound to a live account · credential in the ban set
 * - `verification_challenge_invalid` — wrong OTP · expired OTP
 * - `discovery_disabled` / `not_found` on handle lookup — no such handle · handle exists but
 *   not discoverable · handle is quarantined (the API returns `not_found` for all three;
 *   `discovery_disabled` is reserved for the *caller's own* setting)
 */
export const UNIFORM_ERROR_CODES = [
  "invite_code_invalid",
  "credential_unavailable",
  "verification_challenge_invalid",
] as const satisfies readonly ErrorCode[];

/** The closed `action` enum from §3.1 — what affordance the client should offer. */
export const ERROR_ACTIONS = [
  "none",
  "retry",
  "retry_after",
  "sign_in",
  "refresh_token",
  "verify_email",
  "verify_card",
  "upgrade_app",
  "open_settings",
  "wait_cooldown",
  "contact_support",
] as const;

export type ErrorAction = (typeof ERROR_ACTIONS)[number];

/** HTTP status for every code. `client_version_unsupported`'s 410 shape is frozen forever (§1.5). */
export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  client_version_unsupported: 410,
  malformed_request: 400,
  validation_failed: 422,
  cursor_invalid: 400,
  unsupported_media_type: 415,
  payload_too_large: 413,
  not_found: 404,
  conflict: 409,
  precondition_failed: 412,
  rate_limited: 429,

  unauthenticated: 401,
  token_stale: 401,
  token_invalid: 401,
  forbidden: 403,
  verification_required: 403,
  verification_expired: 403,
  tier_insufficient: 403,
  sanction_active: 403,
  account_suspended: 403,
  account_banned: 403,
  not_campus_member: 403,

  verification_route_unavailable: 409,
  email_domain_not_recognised: 400,
  verification_domain_not_allowed: 422,
  verification_challenge_invalid: 400,
  verification_challenge_locked: 429,
  verification_in_progress: 409,
  credential_unavailable: 409,
  invite_code_invalid: 400,
  invite_quota_exhausted: 409,
  invite_not_permitted: 403,
  card_submission_limit_reached: 429,
  card_review_pending: 409,

  handle_cooldown_active: 409,
  handle_space_exhausted: 503,
  discovery_disabled: 404,

  board_archived: 409,
  post_locked: 409,
  content_removed: 410,
  alias_reservation_expired: 409,
  poll_closed: 409,
  poll_choice_limit: 422,
  attachment_rejected: 422,
  daily_post_quota: 429,

  already_enrolled: 409,
  not_enrolled: 403,
  section_full: 409,
  term_closed: 409,
  absence_already_recorded: 409,
  grade_scale_unknown: 422,

  review_wall_active: 403,
  review_already_written: 409,
  review_term_not_reviewable: 409,
  review_tag_unknown: 422,

  internal_error: 500,
  service_unavailable: 503,
  dependency_timeout: 504,
};

/** The default `action` for each code, per §3.1/§2.5. Overridable per-throw when a call site needs to. */
export const DEFAULT_ACTION_BY_CODE: Record<ErrorCode, ErrorAction> = {
  client_version_unsupported: "upgrade_app",
  malformed_request: "none",
  validation_failed: "none",
  cursor_invalid: "retry",
  unsupported_media_type: "none",
  payload_too_large: "none",
  not_found: "none",
  conflict: "retry",
  precondition_failed: "retry",
  rate_limited: "retry_after",

  unauthenticated: "sign_in",
  token_stale: "refresh_token",
  token_invalid: "sign_in",
  forbidden: "none",
  verification_required: "verify_email",
  verification_expired: "verify_email",
  tier_insufficient: "verify_card",
  sanction_active: "contact_support",
  account_suspended: "contact_support",
  account_banned: "contact_support",
  not_campus_member: "none",

  verification_route_unavailable: "none",
  // The student can do something about it: pick a different address, or use
  // the card route. Not "none".
  email_domain_not_recognised: "retry",
  verification_domain_not_allowed: "none",
  verification_challenge_invalid: "retry",
  verification_challenge_locked: "wait_cooldown",
  verification_in_progress: "none",
  credential_unavailable: "none",
  invite_code_invalid: "retry",
  invite_quota_exhausted: "none",
  invite_not_permitted: "none",
  card_submission_limit_reached: "wait_cooldown",
  card_review_pending: "none",

  handle_cooldown_active: "none",
  handle_space_exhausted: "retry",
  discovery_disabled: "open_settings",

  board_archived: "none",
  post_locked: "none",
  content_removed: "none",
  alias_reservation_expired: "retry",
  poll_closed: "none",
  poll_choice_limit: "none",
  attachment_rejected: "retry",
  daily_post_quota: "wait_cooldown",

  already_enrolled: "none",
  not_enrolled: "none",
  section_full: "none",
  term_closed: "none",
  absence_already_recorded: "none",
  grade_scale_unknown: "none",

  review_wall_active: "none",
  review_already_written: "none",
  review_term_not_reviewable: "none",
  review_tag_unknown: "none",

  internal_error: "retry",
  service_unavailable: "retry",
  dependency_timeout: "retry",
};
