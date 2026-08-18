# Kiksu — API conventions

Stage 1 contract document. Owner: API Contract Author.
Binding on every endpoint in `docs/05-openapi.yaml` and on every endpoint added later.

Companions, in precedence order when they disagree:
`00-project-brief.md` (authoritative) → `02-identity-spec.md` (constrains the API surface) →
`01-schema-notes.md` / `01-schema.sql` (what is servable) → this file (how it is served).

Where this document and the identity spec appear to conflict, the identity spec wins and the
conflict is recorded in `## Open questions`.

No application code appears here.

---

## 0. What this API is

A **server layer**, not PostgREST. `01-schema-notes.md` is explicit: `authenticated` holds
`SELECT` only, on a filtered subset of `public`, and **no `INSERT`, `UPDATE` or `DELETE` on
anything**. Every write in Kiksu passes through this API because writes are where alias
allocation, karma, counter maintenance and the review contribution wall are enforced, and none of
those are expressible as a `CHECK` constraint or an RLS policy.

Two consequences that shape everything below:

1. **The client never holds the service-role key** (`04-infrastructure.md`). It holds a Supabase
   user access token and talks to this API.
2. **A read that PostgREST could serve directly is still routed through this API** whenever the
   response would otherwise carry a column that the k-anonymity floor, the alias projection or the
   karma-oracle mitigations require us to suppress or transform. The forum feed is the clearest
   case: `public.post.created_at` exists and is readable, and it must never reach a client (§8).

---

## 1. Base URL, versioning, and shipping a breaking change to an app store

### 1.1 Base URL

```
https://api.kiksu.site/v1
```

Region `eu-central-1`, per `04-infrastructure.md`. The Supabase project ref is an implementation
detail and never appears in a client-facing URL.

The version is a **path segment**, not a header and not a query parameter. It is the only form of
versioning a URL that survives being copied into a log, a curl reproduction and a store review
build without being lost.

### 1.2 Every request identifies its client

```
X-Kiksu-Client: kiksu-ios/1.4.2 (build 187)
X-Kiksu-Client: kiksu-android/1.4.2 (build 187)
```

Required on every request, including unauthenticated ones. A request without it is served, but is
treated as the oldest supported client for gating purposes and is counted separately in telemetry.

The header carries **no device identifier**. Per T23, no Kiksu identifier and no rotating install
id may appear in it.

### 1.3 The cold-start contract: `GET /v1/bootstrap`

Because the app is distributed through the App Store and Google Play, **we cannot force an
upgrade and cannot assume any version has disappeared**. A student on a two-year-old build with
auto-update disabled is a supported user until we deliberately cut them off.

The app therefore calls `GET /v1/bootstrap` on every cold start, before rendering anything that
depends on server behaviour. It returns:

| Field | Purpose |
|---|---|
| `min_supported_client` | Below this, the app must show a hard upgrade wall |
| `recommended_client` | Below this, a dismissible upgrade prompt |
| `api_versions` | Which major versions are live, and each one's `sunset_at` if set |
| `store_urls` | Where to send the user (per platform) |
| `locales` | Supported locales and the default |
| `flags` | Server-owned feature flags (§1.6) |
| `copy_overrides` | Server-owned copy the client must prefer over its bundled strings (§1.6) |

`bootstrap` is unauthenticated, cacheable for 300 s, and must be the single cheapest endpoint in
the product. If it fails, the client proceeds with its bundled defaults rather than blocking — a
bootstrap outage must never brick the app.

### 1.4 Change classes

| Class | Examples | Allowed inside a major version? |
|---|---|---|
| **Additive** | New endpoint; new optional request field; new response field; new optional query parameter; new member of a *declared-open* enum | Yes, without notice |
| **Behavioural, compatible** | Tightening a rate limit; changing a server-authored label string; changing a sort within an already-unstable order | Yes, with a changelog entry |
| **Breaking** | Removing or renaming a field; changing a field's type or nullability; adding a required request field; removing an endpoint; changing an HTTP status for an existing condition; adding a member to a *closed* enum; changing the meaning of an existing field | **No.** New major version |

**Closed enums** — a client may assume the set is exhaustive and may `switch` without a default:
`error.code`, `verification_status` (`card` / `email` / `none`), `author.display_mode`,
`alias_state`, `review_wall.state`, `attendance.state`, `page_info` shape.

**Open enums** — a client MUST tolerate unknown values and MUST have a rendering fallback:
`moderation_state`, `post_kind`, `absence_kind`, `coursework_kind`, `meeting_kind`,
`board_scope`, `enrollment_state`, `time_bucket`, `report_reason_key`, `review_tag_key`,
`notification_kind_key`, `accent_color`. Every open enum is marked in the OpenAPI document with
`x-kiksu-enum: open`. A client that crashes on an unknown open-enum value is a client bug, and it
is the reason this list exists in the contract rather than in a wiki.

### 1.5 Rolling out a breaking change

1. **`/v2` is published alongside `/v1`.** Both are live. No flag day exists.
2. **`/v1` is served unchanged for a minimum of 180 days** after `/v2` ships — two academic
   semesters, chosen so that a student who only opens the app during term still gets one full term
   of overlap.
3. From the moment `/v2` ships, every `/v1` response carries:
   ```
   Deprecation: @1767225600
   Sunset: Sat, 20 Jun 2026 00:00:00 GMT
   Link: <https://docs.kiksu.site/api/v1-sunset>; rel="deprecation"; type="text/html"
   ```
   (`Deprecation` per RFC 9745, `Sunset` per RFC 8594.)
4. **The 180 days is a floor, not a trigger.** `/v1` is not actually retired until telemetry shows
   under 2% of 30-day-active installs still calling it, *and* `min_supported_client` has been
   raised past the last `/v1`-only build for at least 30 days.
5. **After sunset, `/v1` returns `410 client_version_unsupported`** — never a 404, never a network
   error, never a malformed body. The error carries a localised message and the correct store URL
   so the oldest possible build can still render a working upgrade wall. This is the one error a
   client must be able to handle correctly *forever*, so its shape is frozen for all time:
   `{"error":{"code":"client_version_unsupported","message":"…","store_url":"…"}}`.
6. **Migration of a single field never justifies a major version.** Add the new field, populate
   both, mark the old one `deprecated: true` in the schema, and remove it at the next major. The
   180-day clock exists for shape changes, not for renames.

### 1.6 Why some "copy" is an API response and not a bundled string

`02-identity-spec.md` §2.1 and §2.2 impose an **honesty rule**: when the measured p95 for a
university's email verification exceeds 120 s for two consecutive hours, the onboarding copy for
that university must stop claiming `2 dəqiqə`; the same applies to `24 saata qədər` for card
review. A string baked into an app-store binary cannot be changed within two hours.

Therefore the SLA labels are **server-authored**: `GET /v1/universities/{id}/verification-routes`
returns `sla_label` already localised and already flag-gated. The client renders what it is given.
The same mechanism carries `copy_overrides` from `bootstrap` for any other string that a privacy
or legal decision may need to change without a release.

The client keeps bundled fallbacks for every server-authored string, used only when `bootstrap`
fails.

---

## 2. Authentication and authorisation

### 2.1 Presenting the token

```
Authorization: Bearer <supabase access token>
```

A Supabase-issued JWT, TTL 900 s, refresh-token rotation on with reuse detection
(identity spec §7.3). Nothing else authenticates a request: no API key, no cookie, no query
parameter. **A token must never appear in a URL** — it would land in access logs, in the
Referer header and in crash reports.

### 2.2 Claims the server trusts

Exactly the identity spec §7.1 allowlist, and only when read from `app_metadata` (server-written)
or from the registered-claim set:

| Claim | Location | Used for |
|---|---|---|
| `sub` | top level | Auth subject. Never rendered, never returned to any client. |
| `app_user_id` | `app_metadata` | Ownership on every non-identity table |
| `tier` | `app_metadata` | Write gating and badge selection |
| `role` | `app_metadata` | `student` / `moderator` / `admin`, coarse only |
| `univ_id` | `app_metadata` | Campus scoping |
| `epoch` | `app_metadata` | Revocation (§2.4) |
| `sid` | `app_metadata` | Session-scoped log correlation without a user identifier |
| `exp`, `iat`, `iss`, `aud` | top level | Standard validation |

Per-board moderator scope is deliberately **not** in the token; it is looked up server-side,
because board assignments change more often than tokens are minted.

### 2.3 Claims the server must NOT trust — and the `user_metadata` trap

> **`user_metadata` (`raw_user_meta_data`) is client-writable.**
> Any signed-in user can set it to anything through the standard Supabase `updateUser` call, and
> whatever they set lands in the next access token, correctly signed.

A signed JWT proves the token was minted by Supabase. It does **not** prove that a claim inside it
was written by us. `user_metadata` is the claim block written by the user.

Hard rules:

- **No authorisation decision, anywhere in this API, may read `user_metadata`.** Not for tier, not
  for role, not for university, not for a feature flag, not for a locale preference that gates
  content, not "just for logging".
- A request whose `user_metadata` contains any of `tier`, `role`, `app_user_id`, `univ_id`,
  `epoch`, `verification_status`, `karma`, `contributor_level` is served normally with those values
  **ignored**, and the occurrence is counted as a security metric. It is not an error: making it an
  error would tell an attacker which key names we check for.
- The concrete attack this prevents: `user_metadata.tier = 'card'` awarding the `ANONİM KART`
  badge and every card-gated write. Identity spec assertion 52 tests exactly this.

Also never trusted, regardless of location:

- **`email` and `phone`.** Per identity spec §7.2 trap 1, the Supabase auth email is a synthetic
  address (`<uuid>@users.kiksu.invalid`); the university address lives only in the sealed store as
  a keyed hash. Any request that appears to carry a real university address in a token claim is a
  **defect in the auth anchor**, and is alarmed on, not used.
- **Any claim naming faculty, entry year, study year, expected graduation, handle, karma,
  `career_profile` reference, evidence reference, device id, or a k-anonymity level.** These are
  not in the allowlist; if one appears, it is ignored and alarmed on. `identity.auth_email_leak_check`
  in the schema is the database-side counterpart of the same check.
- **Any client-supplied header or body field naming a user.** No endpoint accepts `app_user_id`,
  `user_id`, `author_id`, `subject_id`, `handle` or a thread alias as an *input* identifying the
  caller. The caller is always the token. This is not a convention — identity spec assertion 17
  fuzzes every route by substituting a thread alias where an identifier is expected and requires
  4xx with no handle and no `app_user_id` in the body.

### 2.4 Epoch and revocation

Per identity spec §7.4, the hot path is one integer comparison:

- If `token.epoch < current_epoch(app_user_id)` → **`401 token_stale`**.
- `token_stale` is a *normal* condition, not an error state. The client refreshes silently, retries
  the request once, and shows nothing to the user. A client that surfaces `token_stale` in the UI
  is a client bug.
- The distinction the client must make: `token_stale` → refresh and retry; `token_invalid` /
  `unauthenticated` → sign out; `account_suspended` / `account_banned` → show the sanction screen
  and do not retry.
- Effective revocation target ≤ 60 s. On ban or suspension the refresh token family is revoked, so
  the refresh itself fails and the retry cannot succeed.

### 2.5 Authorisation layers a client can observe

| HTTP | Code | Meaning to the client |
|---|---|---|
| 401 | `unauthenticated` | No/expired token → sign in |
| 401 | `token_stale` | Refresh and retry once, silently |
| 401 | `token_invalid` | Signature/issuer/audience failure → sign out |
| 403 | `verification_required` | Tier `provisional`, action needs a verified tier |
| 403 | `verification_expired` | Grant lapsed; read retained, write refused |
| 403 | `tier_insufficient` | Board or action requires `card`; caller holds `email` |
| 403 | `sanction_active` | Mute / review ban / listing ban in force |
| 403 | `account_suspended`, `account_banned` | Terminal for this session |
| 403 | `not_campus_member` | Cross-university read/write attempt |
| 403 | `forbidden` | Ownership failure, generic and deliberately uninformative |

`forbidden` is uninformative on purpose: a distinguishable "this exists but is not yours" is an
existence oracle. For resources whose existence is itself sensitive (another user's post save,
another user's enrollment, a review author) the API returns **`404 not_found`**, not 403.

---

## 3. Error taxonomy

### 3.1 Envelope

Every non-2xx response, without exception, has this body and `Content-Type: application/json`:

```json
{
  "error": {
    "code": "tier_insufficient",
    "message": "Bu lövhədə yazmaq üçün tələbə kartı doğrulaması lazımdır.",
    "message_key": "err.tier_insufficient",
    "action": "verify_card",
    "action_label": "Kartı doğrula",
    "details": {},
    "request_id": "01JAV2H0S8QK5T7ZC9WX3M4B6D"
  }
}
```

- `code` — machine-readable, from the **closed set** in §3.3. A client may `switch` on it.
- `message` — localised, student-facing, actionable. Never raw. Never a stack trace, a SQL error, a
  constraint name, an internal service name, a host, or an identifier.
- `message_key` — stable key into the client's own string catalogue. The client prefers its own
  localisation when it knows the key, and falls back to `message` when it does not. This is what
  makes adding an error code inside a major version non-breaking for old builds.
- `action` — closed enum telling the client what affordance to offer:
  `none`, `retry`, `retry_after`, `sign_in`, `refresh_token`, `verify_email`, `verify_card`,
  `upgrade_app`, `open_settings`, `wait_cooldown`, `contact_support`.
- `action_label` — localised label for that affordance.
- `details` — code-specific, documented per code, and subject to §8. It carries **no counts of
  people**, ever (identity spec assertion 35).
- `request_id` — echoed in `X-Request-Id`. The support path. It resolves to a log line that
  contains `sid` and never `app_user_id` alongside a content id (assertion 32).

Validation failures add `details.fields`:

```json
"details": { "fields": [ { "path": "overall_rating", "rule": "range", "min": 1, "max": 5 } ] }
```

### 3.2 Localisation

- Negotiated from `Accept-Language`, restricted to `az`, `ru`, `en`. Default **`az`** (the brief's
  default language). Unknown or absent → `az`.
- Response carries `Content-Language`.
- A signed-in caller's `app_user.locale` is the tie-breaker when `Accept-Language` is absent or
  ambiguous; an explicit `Accept-Language` always wins, because a student may be showing the screen
  to someone else.
- Messages live in a **server-side catalogue**, so wording can be corrected without an app-store
  release (§1.6). Every code has all three locales; a missing translation falls back to `az`, never
  to a key name and never to English-by-accident.
- **Errors students see must be actionable.** The rule applied to every message in the catalogue:
  it names what happened in the student's terms and what they can do next. Concretely —
  not `"constraint review_author_one_per_key violated"` but
  `"Bu fənn və müəllim üçün bu semestrdə artıq rəy yazmısan."` with `action: none`;
  not `"429"` but `"Çox sürətli göndərirsən. 3 dəqiqədən sonra yenidən cəhd et."` with
  `action: retry_after`.
- Messages must not be *specific where specificity is an oracle*. Uniform-response codes (§3.4) use
  one message for several underlying causes, deliberately.

### 3.3 The closed code set

Adding a code inside a major version is allowed (old clients fall back to `message`). Removing or
repurposing one is a breaking change.

**Transport / client**

| Code | HTTP | Notes |
|---|---|---|
| `client_version_unsupported` | 410 | Shape frozen forever (§1.5) |
| `malformed_request` | 400 | Unparseable body |
| `validation_failed` | 422 | `details.fields` |
| `cursor_invalid` | 400 | Tampered, foreign or expired cursor (§4) |
| `unsupported_media_type` | 415 | |
| `payload_too_large` | 413 | `details.max_bytes` |
| `not_found` | 404 | Also used where existence is sensitive |
| `conflict` | 409 | Generic optimistic-concurrency failure |
| `precondition_failed` | 412 | `If-Match` mismatch |
| `rate_limited` | 429 | §5 |

**Auth / account**

`unauthenticated` 401 · `token_stale` 401 · `token_invalid` 401 · `forbidden` 403 ·
`verification_required` 403 · `verification_expired` 403 · `tier_insufficient` 403 ·
`sanction_active` 403 · `account_suspended` 403 · `account_banned` 403 · `not_campus_member` 403

**Onboarding / verification**

| Code | HTTP | Notes |
|---|---|---|
| `verification_route_unavailable` | 409 | University does not offer this route |
| `verification_domain_not_allowed` | 422 | Address domain ∉ allowlist for the selected university |
| `verification_challenge_invalid` | 400 | Wrong **or** expired OTP. `details.attempts_remaining` |
| `verification_challenge_locked` | 429 | 5 wrong codes; `Retry-After` |
| `verification_in_progress` | 409 | A live attempt already exists on this route |
| `credential_unavailable` | 409 | **Uniform response** — see §3.4 |
| `invite_code_invalid` | 400 | **Uniform response** — see §3.4 |
| `invite_quota_exhausted` | 409 | Caller already holds the maximum live codes |
| `invite_not_permitted` | 403 | Issuer does not meet age/karma/tier requirements |
| `card_submission_limit_reached` | 429 | Max 3 submissions per 30 days |
| `card_review_pending` | 409 | A submission is already queued or in review |

**Identity / profile**

| Code | HTTP | Notes |
|---|---|---|
| `handle_cooldown_active` | 409 | `details.available_at` (a timestamp the caller already owns) |
| `handle_space_exhausted` | 503 | Generator failure; pages on-call |
| `discovery_disabled` | 404 | Never distinguishable from "no such handle" (§3.4) |

**Forum**

| Code | HTTP | Notes |
|---|---|---|
| `board_archived` | 409 | |
| `post_locked` | 409 | Design: kilidli mövzu |
| `content_removed` | 410 | Post/comment removed by moderation |
| `alias_reservation_expired` | 409 | The previewed ordinal is gone; client re-previews (§7) |
| `poll_closed` | 409 | |
| `poll_choice_limit` | 422 | `details.max_choices` |
| `attachment_rejected` | 422 | `details.reason`: `too_large`, `bad_type`, `decode_failed` |
| `daily_post_quota` | 429 | Provisional tier's 3/day, and every tier's ceiling |

**Timetable**

| Code | HTTP | Notes |
|---|---|---|
| `already_enrolled` | 409 | |
| `not_enrolled` | 403 | Coursework/materials require enrollment |
| `section_full` | 409 | `capacity` reached |
| `term_closed` | 409 | Past `add_drop_ends_on` |
| `absence_already_recorded` | 409 | One record per class occurrence |
| `grade_scale_unknown` | 422 | Letter not in this university's `ref.grade_scale` |

**Reviews**

| Code | HTTP | Notes |
|---|---|---|
| `review_wall_active` | 403 | Backstop only — the wall is a **queryable state**, §7.4 |
| `review_already_written` | 409 | One per course × instructor × term |
| `review_term_not_reviewable` | 409 | Term outside the reviewable window |
| `review_tag_unknown` | 422 | Not in `ref.review_tag`, or inactive |

**Server**

`internal_error` 500 · `service_unavailable` 503 · `dependency_timeout` 504.
All three carry a generic localised message and `action: retry`. None of them ever carries a
detail describing the failing dependency.

### 3.4 Codes that are deliberately uniform

These exist because a *precise* error is an oracle. Each is a single code with a single message
covering several distinct causes, and each must be **byte-identical and time-equalised** across
those causes.

| Code | Covers | Why |
|---|---|---|
| `invite_code_invalid` | wrong code · expired · already consumed · wrong university | Identity spec §2.3 / T13. Distinguishing them turns the 6-digit space into an oracle. Assertion 60 requires identical bodies *and* identical timings. |
| `credential_unavailable` | credential already bound to a live account · credential in the ban set | Identity spec §6.3, assertions 31 and 49. Distinguishing them lets anyone test whether an address belongs to a banned account. Returned **only after the OTP succeeds** (§2.1 anti-enumeration ordering). |
| `verification_challenge_invalid` | wrong OTP · expired OTP | Merged so a burned code and a wrong code look the same. |
| `discovery_disabled` / `not_found` on handle lookup | no such handle · handle exists but `privacy_discoverable` is off · handle is quarantined | Identity spec §4.6 and assertion 41: the body must be byte-identical and response times within 2σ. **The API therefore returns `404 not_found` for all three** and `discovery_disabled` is reserved for the *caller's own* setting. |

Three further uniformity rules that are not error codes at all:

- **Reporting is always a success.** `POST /v1/reports` returns `202` whether or not the caller has
  already reported that target. The schema's `report_once_per_target` unique constraint is absorbed
  server-side; a duplicate must never surface as `409`. Identity spec T8 and assertion 25 —
  "you have already reported this" is a cross-surface confirmation oracle.
- **Pre-OTP responses are identical.** `POST /v1/verification/email/start` returns the same `202`
  and the same body for a fresh address, an already-registered address and a banned address.
- **k-anonymity suppression is never an error.** When the floor coarsens a label, the response is
  `200` with a coarser label. There is no error code, no flag, no hint, and no count. A client
  cannot tell suppression from a genuinely absent attribute — which is the point (identity spec
  §5.2: the L5 fallback is a fixed string precisely so that falling to it is not itself a signal).

---

## 4. Pagination

**Keyset, never offset.** `01-schema-notes.md` states it directly for the board feed: offset
pagination degrades badly once a board is active. It is also *wrong* rather than merely slow — with
a live feed, offset paging duplicates and drops rows as items are inserted ahead of the cursor.

There is no `page`, `offset` or `skip` parameter anywhere in this API. `limit` exists;
`total_count` does not (a total is both an expensive scan and, on people-shaped collections, a
cohort count).

### 4.1 Request

```
GET /v1/boards/{board_id}/posts?tab=new&limit=20
GET /v1/boards/{board_id}/posts?tab=new&limit=20&cursor=eyJ2IjoxLCJrIjoi…
```

- `limit` — default 20, maximum 50. A larger value is clamped, not rejected.
- `cursor` — **opaque**. Present it back exactly as received.
- Passing `cursor` together with any parameter that changes the sort or the filter
  (`tab`, `sort`, `q`, `instructor_id`, …) is `400 cursor_invalid`. The cursor binds its query.

### 4.2 Response

```json
{
  "items": [ … ],
  "page_info": {
    "next_cursor": "eyJ2IjoxLCJrIjoi…",
    "has_more": true
  }
}
```

`next_cursor` is `null` exactly when `has_more` is `false`. The client's loop condition is
`has_more`; it must never infer the end from an empty `items` array, because a page can legitimately
come back short after moderation filtering.

### 4.3 Cursor shape

The client sees one string. Internally it is:

```
cursor = base64url( payload_json ) + "." + base64url( HMAC-SHA256(K_cursor, base64url(payload_json)) )
```

`payload_json` is compact and never contains a user identifier:

```json
{
  "v": 1,
  "q": "b3a1c0…",
  "k": ["2025-10-27T14:00:00Z", "0193f2c1-9f4e-7a11-bd3c-6a2f0f1e77aa"],
  "d": "desc",
  "x": 1761580800
}
```

| Key | Meaning |
|---|---|
| `v` | Cursor format version. Bumping it invalidates outstanding cursors gracefully (`cursor_invalid`, client restarts the list). |
| `q` | Query fingerprint — a hash of the endpoint plus every sort/filter parameter. This is what makes §4.1's binding rule enforceable. |
| `k` | The keyset tuple: the sort key(s) of the last row, then the tiebreaker id. Always ends in an id, so the ordering is total and no row can be skipped or repeated. |
| `d` | Sort direction. |
| `x` | Expiry (epoch seconds). Cursors live 15 minutes. |

**Why it is opaque, in the enforceable sense.** Opacity here is not a request that clients behave;
it is the HMAC. A modified or hand-crafted cursor fails signature verification and returns
`400 cursor_invalid`. This matters for three reasons beyond tidiness:

1. **It stops cursor-crafting as a scan primitive.** Without a signature, `k` is an arbitrary
   `WHERE created_at < ?` that an attacker can binary-search — which, on the forum, is exactly the
   sub-minute publication-time recovery that identity spec T9 exists to prevent.
2. **It lets us change the sort key later** (adding `hot_rank` to a tie-break, switching a feed to a
   different index) without a client change, because no client ever parsed the cursor.
3. **It prevents cross-endpoint cursor reuse** via `q`, which would otherwise leak the shape of one
   query into another's result set.

**Quantisation.** For forum feeds, the timestamp component of `k` is **quantised to 60 s** before
signing, matching the ≥60 s feed cache in identity spec T9(ii). Continuous polling with a fresh
cursor therefore cannot recover sub-minute ordering. The id tiebreaker keeps the ordering total
inside a quantum.

**Note on ids.** The cursor's tiebreaker is a primary key and the schema currently mints
UUIDv7 (`util.uuid_v7`), which embeds a millisecond timestamp. That is a direct conflict with
identity spec T11 and assertion 8, which require externally visible ids to be UUIDv4. Keyset
pagination works either way, but *cursor opacity does not compensate for the ids themselves being
time-ordered*, because every id also appears in the response body. Flagged in
`## Open questions` — it is not the API contract's decision to make.

---

## 5. Rate limiting

### 5.1 Response headers

On every rate-limited endpoint, success or failure (RFC 9331 draft naming, which is what the
Supabase edge stack and most CDNs already emit):

```
RateLimit-Policy: "forum-write";q=15;w=86400
RateLimit-Limit: 15
RateLimit-Remaining: 11
RateLimit-Reset: 43127
```

On `429`, additionally `Retry-After: <seconds>`.

Rules:

- Headers describe **the bucket that was consumed**, named by policy, never by principal. No header
  ever contains an `app_user_id`, a handle, a device id or an IP.
- When several buckets apply, the headers describe the **scarcest remaining** one.
- `RateLimit-Reset` is a delta in seconds, not an absolute time — an absolute reset time on an
  identity-scoped bucket is a weak account-age signal.
- The client backs off on `429` using `Retry-After` and never busy-retries. A client that ignores
  `Retry-After` will be tarpitted.

### 5.2 The buckets

Keyed by, in order of preference: `app_user_id` (signed in), device attestation id (onboarding),
IP (anonymous). Never keyed by handle.

**Onboarding — fixed, not tier-scaled** (identity spec §2.1, §2.3):

| Bucket | Limit |
|---|---|
| `auth.otp.send` | 60 s cooldown; 3/address/hour; 10/address/day; 5 distinct addresses/device/day |
| `auth.otp.verify` | 5 attempts per challenge, then burned; 60 min lockout |
| `auth.invite.redeem` | 5/device/hour; 10/IP/hour; device lockout after 10 failures in 24 h |
| `auth.card.submit` | 3 per 30 days, then appeal only |

**Product surfaces — scaled by tier and account age.** This is the brigading mitigation: a
brand-new account is the cheapest thing an attacker can produce, so a new account's throughput must
be a fraction of an established one's.

The effective limit is:

```
effective = floor( base(tier, bucket) × age_multiplier(account_age) )      -- minimum 1
```

| Account age | `age_multiplier` |
|---|---|
| < 24 h | 0.25 |
| 24 h – 7 d | 0.50 |
| 7 d – 30 d | 0.75 |
| ≥ 30 d | 1.00 |

| Bucket | `provisional` | `email` | `card` | Window |
|---|---|---|---|---|
| `forum.post.create` | 3 | 15 | 25 | 24 h |
| `forum.comment.create` | 10 | 100 | 150 | 24 h |
| `forum.vote` | 0 | 300 | 400 | 1 h |
| `forum.alias_preview` | 1 per thread per 3 s, 30 total | same | same | 1 min |
| `reviews.create` | 0 | 5 | 5 | 24 h |
| `reports.create` | 5 | 20 | 20 | 24 h |
| `profile.handle_lookup` | 10 | 10 | 10 | 1 h |
| `profile.handle_change` | 0 | 1 | 1 | 14 d (also a hard server rule) |
| `search.*` | 30 | 120 | 120 | 1 h |
| `timetable.freebusy` | 0 | 20 | 20 | 24 h |

Notes that are contract, not tuning:

- **`provisional` zeros are permission, not throttling.** A provisional account attempting a review
  or a vote gets `403 verification_required`, not `429`. The zero appears in this table only so the
  table is complete.
- **`profile.handle_lookup` does not scale.** Enumeration resistance (T11, assertion 41) must not
  improve with tier or age; a card-verified 3rd-year is exactly the attacker the spec models.
- **`forum.alias_preview` is rate-limited per thread** because preview is one of only two readers of
  the alias map (identity spec §3.3) and each call consumes an ordinal.
- **Sanctions compose with limits, they do not replace them.** A muted user's `forum.post.create`
  returns `403 sanction_active`, not a quota error.
- The numeric values above are **tunable through `ref.app_setting`** without a deploy. The *shape*
  — which buckets exist, that they scale by tier and age, that onboarding buckets do not — is
  contract.

### 5.3 Feed caching, which is a limit by another name

Board feeds and campus feeds are served from a cache with **TTL ≥ 60 s**, per identity spec
T9(ii), and carry:

```
Cache-Control: private, max-age=60
ETag: "…"
```

Poll results carry the same ≥ 60 s TTL (T19). A conditional request that hits the cache returns
`304` and does **not** consume a rate-limit token. Aggressive polling therefore costs the attacker
requests but gains no resolution — which is the intended shape.

---

## 6. Idempotency for writes

### 6.1 Which methods

- `PUT` and `DELETE` are idempotent by construction and take no key. Votes, saves, follows,
  helpful-marks and privacy toggles are all modelled as `PUT`/`DELETE` for this reason: `PUT
  /v1/posts/{id}/vote {"value": 1}` twice is one upvote, with no client bookkeeping.
- `POST` that creates or consumes something **requires** an `Idempotency-Key`:
  posts, comments, reviews, reports, enrollments, absences, coursework, invite issuance, and every
  verification step.
- `POST` that is a pure query (none currently) and `GET` never take a key.

### 6.2 Mechanics

```
Idempotency-Key: 6f8b0f1c-8f2a-4c73-9e5b-1a2d3c4e5f60
```

- Client-generated **UUIDv4**, one per logical user intent — generated when the composer opens, not
  when the request fires, so that a retry after a network failure reuses it.
- Scoped to `(app_user_id, method, path, key)`. Retained **24 h**.
- **First request wins.** A replay with the same key and the same request body returns the stored
  status and the stored body, plus `Idempotency-Replayed: true`.
- A replay with the same key and a *different* body → `422 validation_failed` with
  `details.reason: "idempotency_key_reused"`. It is a client bug, and silently serving the first
  response would hide it.
- A replay while the first is still in flight → `409 conflict` with `Retry-After: 1`.
- Missing key on an endpoint that requires one → `422 validation_failed`.

### 6.3 Idempotency and thread aliases — the case that matters

A retried `POST /v1/posts/{id}/comments` must not allocate a second ordinal. Three mechanisms
stack, and all three are required:

1. The idempotency record short-circuits the retry before any allocation runs.
2. If it does not (cache miss, different node, expired record), `internal.thread_alias`'s
   `PRIMARY KEY (post_id, app_user_id)` makes allocation return the *existing* ordinal —
   identity spec §3.4 P2, and the reason allocation is written as insert-and-handle-conflict rather
   than check-then-insert.
3. Allocation happens **inside the same transaction as the content insert** (identity spec §3.4).
   A rolled-back insert frees the ordinal; there is no orphaned allocation to leak as a permanent
   gap.

Explicitly forbidden: implementing allocation with `ON CONFLICT DO NOTHING` on the ordinal
(identity spec §3.7). It silently drops the write.

### 6.4 Idempotency and the uniform-response rules

`POST /v1/reports` is idempotent *by outcome* as well as by key: a second report of the same target
by the same reporter, with or without a key, returns the same `202` and the same body (§3.4).

---

## 7. Surface-specific rules that are contract, not implementation

### 7.1 Time on forum content

**No forum read endpoint returns a raw `created_at` for a post or a comment.** It returns a bucket
(identity spec T9(i)):

| Age | `time_bucket` | `time_label` (az) |
|---|---|---|
| < 15 min | `just_now` | `indicə` |
| 15–45 min | `min_30` | `~30 dəq` |
| 45–90 min | `hour_1` | `1 saat` |
| 90 min – 24 h | `hours_n` | `N saat` |
| 1–7 days | `days_n` | `N gün` |
| > 7 days | `date` | `27 okt` (no time of day) |

The label is server-rendered and localised; the bucket is machine-readable so the client can style
it. The design's 5-minute resolution (`25 dəq`, `40 dəq`) is finer than this and is a real leak
against timetable correlation — flagged in `## Open questions` as a copy conflict, resolved here in
favour of the identity spec pending a product ruling.

Raw timestamps **are** returned where they are properties of a scheduled thing rather than of a
person's activity: `poll.closes_at`, `coursework.due_at`, `term.starts_on`, `section_meeting`
times, `handle_change_allowed_at`, `invite.expires_at`, `alias_preview.expires_at`.

### 7.2 Alias preview — the reserve-with-TTL contract

`POST /v1/posts/{post_id}/alias-preview` implements identity spec §3.3.

- **It takes no user parameter.** The caller is the token. There is no form of this call that
  answers "what ordinal does someone else have."
- It **reserves** an ordinal (state `reserved`, `expires_at` set) and returns it, so the composer's
  `ANONİM 5 KİMİ YAZ` is a promise, not a prediction.
- It is **idempotent**: re-calling it for the same thread extends the existing reservation rather
  than consuming another ordinal. The composer re-issues it on app resume and on typing heartbeats.
- If the caller already has an *active* alias in that thread (they have already commented), it
  returns that ordinal with `is_existing: true` and `expires_at: null` — nothing is consumed, per
  §3.3.
- `DELETE /v1/posts/{post_id}/alias-preview` releases the reservation when the composer is
  dismissed. Releasing is optional; the sweep handles abandonment.
- If a reservation lapses and the ordinal is gone by the time the write lands, the write **still
  succeeds** with a freshly allocated ordinal, and the response carries the *actual*
  `author.alias_number`. The client renders what the response says. `alias_reservation_expired`
  (409) is reserved for the case where the client explicitly asked to commit a specific
  reservation.
- The response includes the composer string already localised (`composer_cta`), because
  `ANONİM 5 KİMİ YAZ` is grammar, not concatenation, and Russian and English do not build it the
  same way.

### 7.3 Boards, feeds, posts, comments

- Forum content responses carry `author` as an **alias object only**:
  `{display_mode, alias_number, alias_label, tier_badge, is_op}`. There is no `handle`, no
  `app_user_id`, no `avatar_id`, no profile link. See §8.
- `tier_badge` is one of `card` / `email` / `none`, **frozen at write time** (`public.post.author_tier`)
  and subject to the scope-wide k-anonymity substitution of identity spec §5.4: when a scope has
  fewer than 20 card-verified users, every `card` in that scope renders as `email`-equivalent
  neutral verification. The client never learns that a substitution happened.
- Deleted comments are returned **in place**, retaining their ordinal, with
  `moderation_state: "removed"` and a `deleted_label` (`silinib`) and no body. Removing them from
  the sequence would turn `1,2,4,5` into evidence (identity spec T16, assertion 46).
- Vote state is per-caller (`my_vote`), served from the caller's own row. Poll vote *identities* are
  not exposed at any privilege level in this API (T19).
- `view_count` is returned; there is no endpoint that reveals *who* viewed anything, and none may be
  added — `internal.view_delta` is deliberately subject-free.

### 7.4 The review contribution wall is a state, not a 403

This is a requirement, not a nicety. The wall must be **queryable before the user hits it**:

`GET /v1/reviews/access` returns

```json
{
  "state": "walled",
  "term": { "id": "…", "label": "2025/26 Payız" },
  "required_contributions": 1,
  "written_contributions": 0,
  "reviewable_sections": [ { "section_id": "…", "course_code": "CS 214", "instructor_name": "dos. Nigar Əliyeva" } ],
  "unlocked_until": null
}
```

`state` is a closed enum: `granted` · `walled` · `blocked`.
`blocked` means a `review_ban` sanction, which is not liftable by contributing.

Consequences for every reviews endpoint:

- `GET /v1/instructors/{id}` and the course/instructor **summaries are always readable** — the
  aggregate ratings, histogram and top tags are not walled. `01-schema.sql` §18.8 makes the summary
  tables readable to every authenticated caller (`using (true)`), so walling them would be a lie the
  client could route around.
- `GET /v1/reviews` (the list of *written* reviews) returns `200` with `items: []` and the same
  `access` object embedded when the caller is walled. **It does not return 403.** The client renders
  the contribution prompt from the response it already has, with no extra round trip and no error
  path.
- `POST /v1/reviews` is the only reviews endpoint that returns `403 review_wall_active`, and only as
  a backstop for a client that ignored the state.

Rationale: `01-schema-notes.md` states the wall cannot live in RLS because it needs
`internal.review_author`, which policies may not touch. A rule enforced only in the server layer and
surfaced only as a 403 becomes a surprise; surfacing it as state makes it a product feature.

### 7.5 Reviews carry no author field at all

Not `null`, not `"anonymous"` — **absent**. The design renders `ANONİM · DOĞRULANMIŞ` and nothing
else (identity spec §0, surface 07). The response carries
`is_enrollment_verified: true|false`, and that flag is itself gated: it is only ever `true` when
`public.review.verified_cohort_size >= ref.university.k_anon_min`. On a small section, an enrolled
verified reviewer *is* identifiable, so the badge is suppressed and the API returns `false` with no
indication that suppression occurred.

The `term` label on an individual written review is subject to the same treatment via `k_review`
(identity spec T17) — the value of `k_review` is unresolved and is flagged.

### 7.6 Cross-user reads go through one shape

Any read of another user, on any surface, returns exactly `PublicProfile`:

```
{ id, handle, avatar_id, university_id, verification_status, contributor_level }
```

That is `public.public_profiles`, whole and unmodified. `university_id` is already null unless the
user opted in *and* their cohort is ≥ 20. `verification_status` is already coarse
(`card` / `email` / `none`). `contributor_level` is already delayed and bucketed.

There is no "expanded" variant, no `?include=`, and no second endpoint that returns more. Adding a
field to this shape is a **security change** and must be reviewed as one, exactly as adding a column
to the view is.

---

## 8. The rule: no endpoint may return a field that links identity layers

This section is the one every downstream agent should be able to quote. It is enforceable
field-by-field, not as a principle.

### 8.1 The rule

> **No single API response may contain identifiers or attributes from two different identity
> layers for the same person, and no sequence of API calls available to a normal account may
> reconstruct such a pairing.**

Layers, per `00-project-brief.md`: 1 `verified_identity` (sealed) · 2 `app_user` (handle) ·
3 `thread_alias` (`ANONİM N`) · 4 `career_profile`.

### 8.2 Prohibitions, field by field

**P1 — Alias and handle never co-occur.**
A response containing any of `alias_number`, `alias_label`, `composer_cta` MUST NOT contain
`handle`, `avatar_id`, `contributor_level`, `app_user_id`, or an embedded `PublicProfile`, for any
subject. Identity spec rule S-1 and assertion 21. The forum renders aliases; the marketplace and
profile render handles; reviews render neither. **No surface renders both, and therefore no
endpoint does.**

**P2 — Forum content never carries an author identifier.**
`post` and `post_comment` responses MUST NOT include `author_app_user_id`, even when the underlying
column is non-null, and MUST NOT include any field derived from `internal.post_author`,
`internal.comment_author` or `internal.thread_alias`. The one exception is the caller's own
`alias-preview` response, which is scoped to the caller by the token.
(Handle-attributed posts — `author_display_mode: "handle"`, used for staff and club notices — return
a `PublicProfile` and **no alias fields**, which is P1 read the other way.)

**P3 — Cross-user reads never carry own-row columns.**
For any subject other than the caller, no response may contain: `karma`, `post_count`,
`comment_count`, `review_count`, `created_at`, `last_active_at`, `handle_changed_at`,
`handle_change_allowed_at`, `card_review_state`, `complaint_count`, `auth_user_id`,
`display_cohort_size`, `verification_tier` (the fine-grained enum — only the coarse
`verification_status` may cross), `privacy_*` toggles, `feed_languages`, `suspended_until`,
`status`. These are precisely the columns `authenticated` cannot select from `public.app_user`, and
the API must not re-introduce them.
Karma specifically: identity spec T5 and assertions 22–23. A cross-user karma read is a
deterministic de-anonymiser via polling. `contributor_level` is the only permitted substitute, and
it is served from the materialised, delayed column — never recomputed at read time.

**P4 — No raw activity timestamps on anonymous content.** §7.1. Bucket labels only.

**P5 — No cohort counts, ever.**
No response body, no error `details`, no header, no debug field may contain `cohort_size`,
`display_cohort_size`, `verified_cohort_size`, a follower count below 1,000, a count of
card-verified users, or any "you are one of N" hint. Identity spec §5.3 and assertion 35. Board
follower counts are returned **only above 1,000** (`9 214` is fine); below that the field is absent,
not rounded — a rounded count still moves.

**P6 — No sealed attributes.**
No response may contain faculty name or id, department, programme, entry year, expected graduation,
email address, student number, national id, verification evidence path, perceptual hash, credential
hash, or `identity.*` row ids — for *anyone*, including the caller. The caller's **own** coarse,
already-k-anonymised projection (`university_id`, `display_study_year`, and a display faculty label
only when the trigger left it non-null) is the single exception, and it is served from
`public.app_user_card`, which is own-row by RLS.

**P7 — No career layer, at all.**
This contract defines **zero** career endpoints, and no response defined here contains a
`career_profile` id, `subject_ref`, application id, CV path, or a real name. Identity spec
assertion 3 has no allowlist for this one: no file may contain both identifiers. That includes this
API's response schemas.

**P8 — No invite graph.**
No endpoint returns an inviter, an invitee, or a relationship between them. `POST /v1/invites`
returns a code the caller just created and nothing about who redeems it. Identity spec T12 and
assertion 64.

**P9 — Block lists render snapshot handles.**
`GET /v1/blocks` returns the handle **as it was at block time**, never resolved live. A live
resolution turns the block list into a rename oracle: block many people, watch your own list, learn
the entire rename mapping. Unblocking is by list-entry id, never by handle. Identity spec §4.6 and
assertion 46.

**P10 — Notifications carry ids and ordinals, never handles.**
`notification.payload` may contain `alias_number`, `board_id`, `post_id` and an excerpt. It may
contain a handle **only** when the actor deliberately acted under their handle. The client renders
the copy; the server does not ship rendered strings containing an actor name.

**P11 — Storage URLs are opaque.**
Every media URL returned by this API points at a ≥128-bit random object key in a flat namespace. No
URL may encode an `app_user_id`, a handle, a `post_id`, a `thread_id`, or share a prefix with
another object uploaded by the same user. Identity spec T7 and assertion 28. Card-verification
evidence is uploaded to a *separate* bucket via a one-shot signed target and is never readable
through this API at any tier.

**P12 — No search or filter parameter may take an identity value.**
No endpoint accepts a query parameter that filters content by author. There is no
`?author=`, no `?app_user_id=`, no `?alias=`. "My posts" is served from the caller's token
(`GET /v1/me/posts`), reading `internal.post_author` server-side, and returns the caller's own
content only.

**P13 — Realtime obeys the same projection.**
Any realtime channel the client subscribes to delivers **server-authored broadcast payloads whose
schema is exactly the corresponding REST projection**. `postgres_changes` is not available to
`authenticated` on forum, marketplace or identity tables, and no presence channel exists on any
forum surface. Identity spec T6 and assertion 30. A realtime payload that carries a field this
document forbids in REST is the same bug, delivered faster.

### 8.3 How this is enforced rather than believed

- **Response-schema allowlist snapshot.** The property names of every client-facing response schema
  are snapshotted and committed. Any diff that introduces a name on the P1–P13 lists fails CI.
  This is the API-level twin of identity spec assertion 7.
- **Paired-field assertion.** For every endpoint, over a full fixture database: assert no response
  contains an alias field and a handle field (assertion 21), and no response contains a
  `career_profile` identifier and an `app_user_id` (assertion 26).
- **Log hygiene.** Assertion 32 applies to this API's own logs: no log line may contain a handle, an
  email, a student id, a JWT, or an `app_user_id` co-occurring with a thread alias or a content id.
  `sid` is the correlation key, which is why it is in the token allowlist.

---

## 9. Conventions checklist for a new endpoint

Before an endpoint is added to `05-openapi.yaml`:

1. Every response field traces to a column, a view or a documented server computation in
   `01-schema.sql`. No invented fields.
2. If it returns another user, it returns `PublicProfile` and nothing more (§7.6).
3. If it returns forum content, it returns a bucket label, not a timestamp (§7.1), and an alias
   object, not an author (§8.2 P1/P2).
4. It reads the caller from the token, never from a parameter (§2.3).
5. If it is a collection, it is keyset-paginated with a signed cursor (§4) and returns no total.
6. If it writes, it takes an `Idempotency-Key` or is a `PUT`/`DELETE` (§6).
7. Its failure modes map onto the closed code set (§3.3), and any failure that could act as an
   oracle uses a uniform code (§3.4).
8. Its rate-limit bucket is named in §5.2, or a new one is added there in the same change.
9. It is checked against §8.2 field by field, not by impression.

---

## Open questions

Nothing below should be guessed at. Items marked **identity semantics** must be answered by the
Identity Architect or by product before implementation; the API cannot resolve them by choosing a
convenient default.

### Conflicts between documents that the API cannot arbitrate

1. **UUIDv7 vs UUIDv4 for externally visible ids — identity semantics.**
   `01-schema.sql` §03.1 mints `util.uuid_v7()` as the default primary key for `app_user`, `post`,
   `post_comment`, `review` and everything else, and justifies it by index write amplification.
   `02-identity-spec.md` T11 and assertion 8 require every externally exposed identifier to be
   **UUIDv4**, explicitly failing for UUIDv7, because a v7 id embeds a millisecond timestamp and
   therefore leaks account creation order (join cohort, freshman status) and exact content creation
   time — the latter defeating the coarse-time mitigation of T9 that this contract implements in
   §7.1. Every `id` this API returns is affected. Options: (a) v4 for externally exposed tables and
   v7 for internal/append-heavy ones; (b) v7 internal surrogate + a separate v4 public id per
   externally visible entity; (c) accept the leak and drop T9's time bucketing as pointless. This
   needs deciding before any client ships, because it changes every id in every response.

2. **Alias free-list reclaim vs "numbers are not recycled" — identity semantics.**
   `02-identity-spec.md` §3.2/§3.5 specifies a **free list**: ordinals from expired reservations are
   reclaimed so that the rendered sequence has no permanent gaps (property P3, "Absolute"), with the
   ordinal↔arrival-order break treated as a privacy gain.
   `01-schema.sql` §09.2 says the opposite in a comment — "Expired reservations are deleted but
   their numbers are NOT recycled … Gaps in the numbering are expected and intentional" — and
   `internal.allocate_thread_alias` implements monotonic `alias_high_water` with no free list.
   These cannot both be right. This contract's §7.2 is written to be neutral (the client renders
   what the response says), but the choice is observable to users and to T14/T16 analysis.

3. **Alias hold TTL.** Identity spec §3.3 says 5 minutes, extended to a maximum of 30 by composer
   heartbeats. `internal.allocate_thread_alias` defaults to 15 minutes. The API returns `expires_at`
   rather than a constant, so no client depends on the number — but the number must be settled.

4. **Relative-time granularity** (identity spec open question 5). The design renders `25 dəq` /
   `40 dəq`; T9 requires the coarser buckets implemented in §7.1. This contract follows the identity
   spec. If product overrules it, §7.1 changes and the leak is accepted knowingly.

### Surfaces the schema cannot currently serve as designed

5. **The university badge on an anonymous post — identity semantics.**
   Identity spec §5.2 lists a post badge rendering `BDU` when `Postlarımda universitet nişanı` is
   on. `public.post` has a `university_id`, but it is denormalised **from the board**, not from the
   author. On a university-scoped board the two coincide; on a **national** board they do not, and
   rendering the board's university as an author attribute would be wrong. Serving a true
   author-university badge needs a new frozen-at-write-time column on `public.post` (like
   `author_tier`), and that column is itself a k-anonymity decision — on a national board, "BDU"
   next to `ANONİM 4` is a real narrowing. This contract therefore returns the board's
   `university_id` as **board scope context only** and defines no author-university field. Product
   must decide whether the badge exists on national boards at all.

6. **`k_review` for review cohorts — identity semantics** (identity spec open question 9). The
   value gates two things this contract already models: whether `is_enrollment_verified` may be
   `true`, and whether the `term` label appears on an individual written review. Proposed 5; k=20
   would suppress most course reviews. Until it is set, `GET /v1/reviews` cannot be finalised on
   whether `term` is nullable in practice or merely in principle.

7. **What the review contribution wall actually requires.** `01-schema-notes.md` says the wall needs
   "whether a user has written a review this semester", which this contract models as
   `required_contributions: 1` per current term. Unspecified: does an *edited* prior review count;
   does a review of a dropped course count; does the wall apply to reading a single review deep-link
   from a notification; and does a `graduate` user (who per identity spec §2.4 may not write new
   course reviews) get read access permanently, or lose it? The last one is identity semantics —
   permanently walling graduates and permanently unwalling them are both defensible and they leak
   different things.

8. **Is `2-Cİ KURS` derived or self-declared** (identity spec open question 10). `public.app_user`
   has `display_study_year` written by the verification service, which reads as derived — but the
   privacy toggle `privacy_show_year` suggests a user-facing control. If any part of it is
   self-declared, `PATCH /v1/me/profile` needs a write path that does not currently exist, and the
   k-anonymity treatment of the field changes.

### API-shaped questions the source documents do not settle

9. **Invite code state visibility — identity semantics.** `GET /v1/invites` returns the caller's own
   live codes so the client can enforce the "3 live codes" cap. Returning a per-code
   `consumed` / `live` / `expired` state tells the inviter *that* their code was redeemed and
   roughly when. T12 forbids using the invite edge for any product feature and forbids "your friend
   joined" notifications; a state field is weaker than that but is not nothing. Options: return only
   an aggregate `live_count` and `remaining_issuable`; or return per-code state and accept the
   signal. This contract currently returns per-code state and it should be reviewed.

10. **Does `card` tier gate anything in the Phase 1 spine?** (identity spec open question 3.)
    `public.board.min_tier_to_post` exists and defaults to `email_verified`, so a board *can*
    require `card`. Whether any launch board does is a product decision, and it determines whether
    `tier_insufficient` is a live error path at launch or dead contract surface.

11. **Provisional-tier post visibility on expiry** (identity spec open question 4). §2.3 proposes
    hiding a provisional user's posts when the 7-day window lapses, restoring them on verification.
    `public.post.moderation_state` has no value for "hidden pending verification" — `limited` and
    `removed` both mean something else to moderation, and reusing either makes the moderation queue
    lie. If hiding is confirmed, the enum needs a new member, which is an open-enum addition here
    and a migration there.

12. **Attachment upload flow.** `public.post_attachment` records `storage_path` and
    `exif_stripped`, and identity spec T7 requires a **server-side re-encode** (not a tag strip)
    before the object is durable. That implies upload → quarantine → re-encode → attach, so a post
    cannot reference an attachment that has not finished processing. This contract models a
    one-shot signed upload target followed by attaching opaque `upload_id`s to the post, but the
    processing SLA, the client's behaviour while re-encode is in flight, and what happens when
    re-encode fails after the post is composed are unspecified.

13. **Graduate tier in the API** (identity spec open question 2). `public.verification_tier` has
    only `unverified` / `email_verified` / `card_verified`; there is no `graduate` value in the
    schema, while the identity spec's tier machine has one and gates surfaces on it. Until that is
    reconciled, this contract's `verification_status` (`card` / `email` / `none`) cannot represent a
    graduate, and `403` reasons for graduate-restricted actions have no distinct code.

14. **Does `MÜƏLLİF` appear on the author's comments as well as the OP** (identity spec open
    question 14)? `public.post_comment.is_op` exists, so the schema assumes yes. It links ordinal 1
    to those comments, which is intended — but it should be a stated decision, because this
    contract returns `is_op` on every comment.
