# Schema notes

Companion to `01-schema.sql`. Written after the schema was validated by
executing it end to end against a real PostgreSQL server (see *Validation*).

## Status

| | |
|---|---|
| Tables | 96 across 7 schemas |
| Indexes | 263 |
| Functions | 44 |
| Triggers | 27 |
| RLS policies | 45, on all 45 public tables |
| Applies cleanly | Yes — 0 errors |

## Validation

The schema was executed against PostgreSQL 16 with Supabase's `auth` schema
and the `anon` / `authenticated` / `service_role` roles stubbed. It applied
with zero errors, and the four architectural invariants were then asserted
against the built database rather than merely reviewed:

1. `authenticated` has **no** `usage` on `identity`, `career` or `internal`.
2. **No** foreign key exists from `career.*` to `public.app_user` — the
   Layer 4 silo is structurally intact, not merely conventionally respected.
3. **No** RLS policy references a sealed schema.
4. Every public table with RLS enabled has at least one policy, so no table
   is accidentally locked out entirely.

These four should become CI assertions. They are cheap to run and they are
exactly the properties a well-meaning future change will quietly break.

### Bugs found and fixed during validation

Four defects were caught that no amount of reading would reliably have found.
All four are recorded because each represents a class of mistake, not a typo:

1. **`handle_change_allowed_at` was a stored generated column** computed as
   `handle_changed_at + interval '14 days'`. `timestamptz + interval` is
   STABLE, not IMMUTABLE — the result depends on session `TimeZone` across a
   DST boundary — so Postgres rejects it. Replaced with a plain column
   maintained by `trg_app_user_handle_cooldown`. *This single line caused 212
   cascading errors: every object depending on `app_user` failed to create.*
2. **`enum::text` inside four generated columns.** Postgres declares
   `enum_out()` STABLE, so casting an enum to text is not immutable and
   cannot appear in a stored generated column or index expression. Added
   `util.locale_text()`, a CASE-based immutable converter. Never write
   `lang::text` in a generated column.
3. **`round(double precision, integer)` in `util.hot_rank`.** `sign(integer)`
   resolves to `double precision` (float8 is the preferred type in the
   numeric category), which poisoned the whole expression — and `round/2`
   exists only for `numeric`. Fixed with an explicit `::numeric` cast.
4. **`for r, v_sign in ...`** in `tg_review_summaries`. PL/pgSQL cannot mix a
   record variable with a scalar in a `FOR` target. Restructured to carry the
   pair as one composite row and unpack it at the top of the loop.

Lesson for every later migration: **run it before you commit it.** Three of
these four are invisible to review and instant to catch by execution.

## The access model

Layered, and deliberately not dependent on RLS alone.

**Layer 0 — schema grants.** `identity`, `career` and `internal` have
`usage` revoked from `anon`, `authenticated` and `service_role`. This is the
primary control for Layers 1, 3 and 4. A policy can be mis-written; a missing
schema grant cannot be worked around.

**Layer 1 — RLS.** All 45 public tables have RLS enabled and forced, deny by
default. Policies grant `authenticated` read access along three axes:

- *own row* — `app_user_id = current_app_user_id()` for votes, saves,
  enrollment, notifications, devices, blocks, RSVPs.
- *campus scope* — boards, posts, reviews, listings, clubs and events are
  visible when the row's university matches the caller's, with national
  boards (`university_id is null`) visible to everyone.
- *participation* — deals and chat are visible to their parties only.

**Layer 2 — the server layer.** `kiksu_app` holds `bypassrls` and authorises
in code. This is deliberate: feed assembly, moderation and notification
fan-out legitimately read across users, and forcing them through RLS would
push us toward `SECURITY DEFINER` wrappers everywhere, which is strictly
worse. `kiksu_app` still has no `usage` on the sealed schemas.

`authenticated` has **no INSERT, UPDATE or DELETE on anything.** Every write
goes through the server layer, because writes are where alias allocation,
karma, counters and the review contribution wall are enforced, and none of
those are expressible as a CHECK constraint.

### What RLS deliberately does *not* enforce

- **The review contribution wall.** Deciding whether a user has written a
  review this semester requires `internal.review_author`, which policies may
  not touch. Server layer only.
- **"My posts".** Authorship of an anonymous post lives in
  `internal.post_author`. `public.post.author_app_user_id` is NULL for every
  anonymous post and is populated only when the author deliberately posted
  under their handle. It is *rendered identity, not authorship*, and must
  never be treated as the latter.
- **The k-anonymity floor.** Applied at projection time, per
  `02-identity-spec.md` §5.

## Index strategy

263 indexes. The ones that carry the product:

| Query path | Index shape |
|---|---|
| Week timetable | `enrollment(app_user_id, state)` → `section_meeting(section_id, weekday)`; the grid is one join, no per-cell lookups |
| Campus hot feed | `post(university_id, hot_rank desc)` partial on visible moderation states; `hot_rank` is trigger-maintained, never computed at read |
| Board feed | keyset pagination on `post(board_id, created_at desc, id)` — offset pagination degrades badly once a board is active |
| Post comments | `post_comment(post_id, created_at)`, with `parent_id` for reply threading |
| Review aggregates | pre-aggregated into three summary tables; the review list itself never aggregates at read time |
| Marketplace browse | `listing(university_id, category_id, status, bumped_at desc)` partial on active rows |
| Vacancy feed | `vacancy(status, apply_deadline)` with a GIN index on `target_university_ids` |
| Search | GIN on `search_vector` per searchable table, plus trigram indexes on folded name/handle columns |

**Azerbaijani search** is handled by `util.fold_text()`, which maps
`ə→e ğ→g ı→i ö→o ş→s ü→u ç→c ё→е` and strips U+0307. `unaccent` is
deliberately *not* relied on: its rules file does not cover U+0259 (ə), the
single most important character in this product. Queries must be built with
`util.tsq()` so query text is folded identically to indexed text — folding
one side and not the other is the classic way to break this.

## Counters

Every count the design renders is materialised, because `COUNT(*)` on a live
board does not hold up. Trigger-maintained: post score and hot rank, comment
counts, board follower and post counts, poll votes, absence counters, review
summaries, trade ratings, RSVP attendance, conversation counters.

Recomputed on a schedule rather than by trigger: seller response rate and
median response time (needs a window over message timestamps), instructor
`course_count`, complaint counts, and absence limits when policy changes.
These are either too expensive per-write or tolerate lag.

## Migration ordering

Split as: extensions and roles → util functions → enums → `util.locale_text`
→ ref → identity → app_user and internal → academic → forum → reviews →
marketplace → careers → events → moderation → notifications → counter
triggers → RLS → grants → pg_cron schedules.

Two ordering constraints that bite: `util.locale_text` must come **after** the
enum declarations because it takes `public.locale_code` as a parameter, and
all counter triggers must come after every table they touch.

## Public profile projection (section 20)

The karma-delta oracle is closed by removing the oracle, not by guarding it.

**The attack.** The profile screen shows an exact karma integer. If any
surface lets you read another user's karma on demand, you poll a target
before and after a post appears, and a +1 delta links that stable pseudonym
to that specific anonymous post with certainty. No exploit needed — just
documented API surface and a clock.

**The resolution, three parts:**

1. **Exact karma is own-row only.** It lives in `public.app_user_card`,
   which is `security_invoker = on` and therefore RLS-confined to your own
   row. The design's `312 KARMA` still renders on your own profile because
   it is yours. It appears in no cross-user surface.
2. **Others see `contributor_level`** — a coarse badge on super-linear
   buckets (50 / 250 / 1000 / 5000). At level 3 a user needs 750 more karma
   to advance, so no realistic amount of posting moves the badge inside an
   observation window.
3. **The badge is materialised and refreshed on a delay**, by
   `public.refresh_contributor_levels()` running daily off-peak, and never
   within 24h of the karma change that caused it. Computing the level live
   would restore the oracle at the bucket boundary: an observer watching a
   user near 250 karma would still see the badge flip on a known post.
   **The delay is the security control — never call this from a trigger.**

**`public.public_profiles`** is now the only cross-user read of another
person. It exposes six columns: `id`, `handle`, `avatar_id`, `university_id`
(only when the user opted in *and* their cohort is ≥ 20, per the k-anonymity
floor), `verification_status` (coarse: card / email / none), and
`contributor_level`. It carries no karma, no `created_at` (account age
correlates with cohort), no counts, and no `card_review_state` — a pending
card review is a real-world event with a knowable timestamp.

The view is `security_invoker = off` deliberately: it must read across users,
which `app_user`'s own-row RLS forbids. **Safety comes from the column list,
not from RLS, so adding a column to this view is a security change** and must
be reviewed as one.

Behind that, `authenticated` holds column-level `SELECT` on `app_user` for
only seven safe columns. Even if a policy were later widened by mistake,
karma, `created_at`, `card_review_state`, `auth_user_id`, `complaint_count`,
`last_active_at` and `handle_changed_at` remain unreachable.

### avatar_id rotates with the handle

`avatar_id` is a generated column derived from the folded handle, not a
stored random value. This is an anonymity property, not a cosmetic one: an
avatar that persisted across a rename would link the old handle to the new
one and defeat the entire point of the 14-day handle change. Verified — the
same row moved from avatar 1 to avatar 10 when its handle changed.

### Verified against the built database

- `authenticated` may select exactly seven columns of `app_user`.
- None of the sensitive columns are among them.
- `public_profiles` contains no karma and no `created_at`.
- Bucket boundaries land where intended.
- `avatar_id` changes when the handle changes.

## Open questions

1. ~~Are pseudonymous profiles publicly viewable by handle?~~ **RESOLVED.**
   See *Public profile projection* below.
2. **Timetable course colours.** The design uses at least six, two appearing
   once. Should these be a defined palette in `ref`, cycled deterministically?
3. **National board moderation.** Campus boards can have campus moderators;
   national boards have no obvious constituency to recruit from.
4. **Listing visibility** is currently same-university. The design mentions
   city-wide meetup points, which implies a cross-campus mode that does not
   exist in the schema yet.
