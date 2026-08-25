# Supabase deviations

Companion to `docs/01-schema.sql` (the source of truth, unmodified) and
`supabase/migrations/` (what actually applies). This file documents every
place the two differ, why, and why the difference does not weaken any of
the 11 invariants in `scripts/schema-invariants.sql`.

`docs/01-schema.sql` itself was **not** touched. The migration split in
`supabase/migrations/0000_extensions_and_roles.sql` .. `0016_grants_and_public_profile.sql`
is byte-for-byte reversible back to the monolith except for the two
deviations below (verified with `diff` against a raw, unmodified section
split — only `0000`, `0015` and `0016` differ; the other 14 files are
character-identical extracts).

## Status

| | |
|---|---|
| Migrations | 23 (`0000`–`0022`) applied live; see "Deviation 3" for how `0021`/`0022` got there |
| Local verification | Pass — `scripts/verify-migrations.sh`, 0 errors, all 11 invariants hold |
| Live Supabase verification | Pass — all 11 invariants hold, re-checked via `execute_sql` after 0021/0022; a deliberate control exception confirmed failures do surface |
| Deviations from `docs/01-schema.sql` | 3 root causes |
| Project | `houicgsdduzzcarxkuuo` ("Kiksu", `eu-central-1`, Postgres 17.6.1) — was empty, nothing preserved |

## Migration file map

Split at the monolith's own `-- =====` section boundaries, preserving
exact statement order (no reordering was needed — the monolith already
applies cleanly top-to-bottom). Two adjacent section pairs were merged
into one file each; everything else is one file per numbered section.

| File | Source sections | Notes |
|---|---|---|
| `0000_extensions_and_roles` | 01 + 02 | extensions, schemas, roles, schema-level grants |
| `0001_util` | 03 | id generation, folding, FTS config, hot rank |
| `0002_enums` | 04 | enum types **and** `util.locale_text` (already co-located in the source, satisfying the "locale_text after enums" ordering constraint for free) |
| `0003_ref` | 05 | universities, calendar, courses, vocabularies |
| `0004_identity` | 06 | Layer 1, sealed |
| `0005_app_user_and_internal` | 07 | Layer 2 + handle history/reservation (internal) |
| `0006_academic` | 08 | enrollment, absence, coursework |
| `0007_forum` | 09 | boards, posts, aliases (Layer 3), comments, votes |
| `0008_reviews` | 10 | reviews + summaries |
| `0009_marketplace` | 11 | listings, deals, chat |
| `0010_careers` | 12 + 13 | vacancies (public) + career silo (Layer 4, sealed) — merged because they are two halves of one feature and the notes' ordering list names them once, as "careers" |
| `0011_events_and_clubs` | 14 | |
| `0012_moderation` | 15 | |
| `0013_notifications_and_devices` | 16 | |
| `0014_counter_maintenance` | 17 | every counter trigger; runs after every table it touches (07–16), satisfying the ordering constraint |
| `0015_rls` | 18 | RLS policies |
| `0016_grants_and_public_profile` | 19 + 20 | grants + the public-profile projection — merged because §20 revokes/re-grants columns that §19 first grants, so it must physically follow §19, and neither is large enough to warrant a standalone file |

This numbering is not arbitrary: the source file itself contains two
forward references — "pg_cron; schedules live in migration 0016" (line
3666) and "Scheduled daily, off-peak, in migration 0016" (line 4197) —
inside comments written before the split existed. Grouping grants (§19)
and the public-profile projection (§20) together and counting from `0000`
lands that combined file at index **16**, exactly where those comments
already point. That is a strong signal this is the split the schema was
designed for, not a coincidence I forced.

**pg_cron was not wired up**, deliberately: `docs/01-schema.sql` never
actually contains a `create extension pg_cron` or any `cron.schedule(...)`
call anywhere — grep confirms zero occurrences of `cron.` in the whole
4261-line file. The six comments describing a schedule (§17.13) are
forward-looking documentation of intent, not statements to extract. Since
task 1 is a **mechanical** split — "the concatenation of your files must
be equivalent to the original" — inventing `cron.schedule()` calls that
don't exist in the source would be adding semantics, not splitting them
out. This is a pre-existing gap in the source, not a Supabase rejection,
and is called out here as a known follow-up: Supabase does offer `pg_cron`
as an installable extension (confirmed present in
`list_extensions`, `default_version 1.6.4`, not yet installed), so wiring
`public.fold_karma_ledger()`, `refresh_view_counts()`,
`refresh_complaint_counts()`, `refresh_absence_limits()`,
`refresh_contributor_levels()` and `recompute_seller_stats()` to a
schedule is real, undone work — just not work this task's scope covers.

## Deviation 1 — `kiksu_app` retired in favour of `service_role`

**What the source does.** `docs/01-schema.sql` creates a dedicated NOLOGIN
role, `kiksu_app`, to be "the normal server layer" (line 139 of the
original), grants it schema usage and table/function privileges
throughout, and — critically — runs `alter role kiksu_app with
bypassrls;` in section 18.1 so that role can read across users the way
feed assembly, moderation and notification fan-out require.

**What happened on Supabase.** The very first migration attempt
(`0000_extensions_and_roles`, unmodified) applied everything up to the
schema-ownership lines successfully, then a later dry run of the RLS
section failed on:

```
ERROR: 42501: must be able to SET ROLE "kiksu_identity_owner"
```

(That specific error is deviation 2, below.) Separately, the literal
`alter role kiksu_app with bypassrls;` line cannot ever succeed as
written on Supabase, for a reason independent of which role it names:
**granting BYPASSRLS to any role is one of the handful of privileges
Postgres reserves for an actual superuser**, and the role migrations run
as (`postgres`) is confirmed not one:

```sql
select rolname, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname='postgres';
-- postgres | rolsuper=false | rolbypassrls=true | rolcreaterole=true
```

`postgres` itself has BYPASSRLS (platform-granted) but cannot re-grant an
attribute it does not hold the authority to hand out — that authority is
gated on `rolsuper`, not on merely possessing the attribute yourself.

**The fix.** Retire `kiksu_app` entirely and make `service_role` the
server layer:

- `service_role` is confirmed to already carry BYPASSRLS natively
  (`rolbypassrls=true`), as a platform-managed property — there is
  nothing left to grant.
- Every grant the source made to `kiksu_app` — schema usage on `util`,
  `ref`, `internal`; table SELECT on `ref`; full DML on `public` and
  `internal`; EXECUTE on the `util` functions and the six RLS-helper
  functions; SELECT on `public.public_profiles` — is made to
  `service_role` instead. `service_role` was already present on most of
  those grant lists alongside `kiksu_app` (the original schema hedged both
  ways in section 02), so most of this is a straight substitution, not an
  addition.
- `service_role` still has **no** USAGE on `identity` or `career` — the
  original schema's `revoke usage on schema identity from anon,
  authenticated, service_role;` / same for `career` (section 02, line
  161–162 of the source) was left completely untouched. The sealed
  schemas are exactly as unreachable to the server layer's role as the
  design intended; only the role's *name* changed.

**Why this is equivalent, not weaker.** The property the design actually
depends on — "a role with BYPASSRLS that has no grant on the sealed
schemas" — holds identically under `service_role` as it would have under
a working `kiksu_app`. The security-relevant invariant was never "the
role is called `kiksu_app`"; it was "no client can obtain BYPASSRLS, and
whatever process holds it still cannot reach Layer 1 or Layer 4." Both
halves hold. This is also more Supabase-idiomatic: `service_role` is the
platform's own designated trusted-backend key, distributed as the
service-role JWT that must never reach the Expo client — exactly the
credential-handling story `docs/04-infrastructure.md` already describes.

**Files touched:** `0000_extensions_and_roles.sql` (role not created;
grants retargeted), `0015_rls.sql` (the `alter role ... bypassrls` line
removed; comments updated), `0016_grants_and_public_profile.sql` (every
`kiksu_app` grant retargeted to `service_role`).

## Deviation 2 — schema ownership needs an explicit membership grant

**What the source does.** `identity` and `career` are deliberately owned
by dedicated NOLOGIN roles (`kiksu_identity_owner`, `kiksu_career_owner`)
rather than by the default owner, so that "the owning role is subject to
policy" and no other role can casually alter Layer 1 or Layer 4 tables
(header comment, section 06). The source creates the roles, then
immediately runs:

```sql
alter schema identity owner to kiksu_identity_owner;
alter schema career   owner to kiksu_career_owner;
```

**What happened on Supabase.** This failed on the very first migration
attempt:

```
ERROR: 42501: must be able to SET ROLE "kiksu_identity_owner"
```

`postgres` has `CREATEROLE` (confirmed) and used it to create both
roles, but creating a role does not by itself grant the creator
membership in it — `ALTER ... OWNER TO` requires the current role to be
a member of the target role (or superuser), and `postgres` was neither
here.

**The fix, attempt 1 (rejected).** Tried
`grant kiksu_identity_owner to postgres with admin option;` before the
`alter schema` line. This failed too, with a different, more specific
error:

```
ERROR: 0LP01: ADMIN option cannot be granted back to your own grantor
```

Postgres 16+'s tightened `CREATEROLE` rules make `postgres` the implicit
*grantor* of any role it creates via `CREATEROLE`; granting that same
role back to itself `WITH ADMIN OPTION` is specifically disallowed as a
self-referential grant.

**The fix, attempt 2 (works).** Plain membership, no admin option:

```sql
grant kiksu_identity_owner to postgres;
grant kiksu_career_owner   to postgres;
```

issued right before the two `alter schema ... owner to ...` lines. With
plain membership, `postgres` inherits `kiksu_identity_owner`'s and
`kiksu_career_owner`'s privileges (default `INHERIT` behaviour), which is
sufficient both for the `ALTER SCHEMA OWNER TO` itself and for every
subsequent `CREATE TABLE identity.*` / `CREATE TABLE career.*` /
`COMMENT ON SCHEMA identity ...` statement in later migrations — all of
which applied cleanly afterward with no further ownership friction.

**Why this is equivalent, not weaker.** The end state matches the
source's intent exactly: `identity` is owned by `kiksu_identity_owner`
and `career` is owned by `kiksu_career_owner`, confirmed live:

```sql
select nspname, pg_get_userbyid(nspowner) from pg_namespace
 where nspname in ('identity','career');
-- identity | kiksu_identity_owner
-- career   | kiksu_career_owner
```

`postgres` is a *member* of those roles (able to act as them for DDL
during migrations) but is not the schema *owner* — the separation of
trust boundaries the design wanted is intact. Nothing about RLS, grants,
or the FK-based silo enforcement changed; this is purely about who is
allowed to `ALTER`/`DROP` the schema's objects going forward.

**Files touched:** `0000_extensions_and_roles.sql` only (two `grant ...
to postgres;` lines added immediately before the pre-existing `alter
schema ... owner to ...` lines).

## Things that did *not* need adaptation

For completeness — these were flagged as likely friction points before
starting, and none of them actually were:

- **Custom role creation** (`kiksu_identity_owner`, `kiksu_career_owner`,
  `kiksu_identity_svc`, `kiksu_career_svc`, `kiksu_moderator`,
  `kiksu_analytics`) applied without incident. Supabase's `postgres` role
  has `CREATEROLE` and Supabase does not block plain `CREATE ROLE ...
  NOLOGIN` statements in migrations.
- **`create schema`, all six custom schemas** (`util`, `ref`, `internal`,
  `identity`, `career`, `moderation`) applied without incident.
- **Extensions**: `pgcrypto`, `citext`, `pg_trgm`, `btree_gist`,
  `unaccent`, `pg_stat_statements` all installed into the `extensions`
  schema exactly as written, no substitution needed. (`pgcrypto` and
  `pg_stat_statements` were already present on the empty project;
  `create extension if not exists` made this a no-op for those two.)
- **`create text search configuration util.az/ru/en`** applied without
  incident — no special extension-placement handling needed.
- **Every `SECURITY DEFINER` function**, including the four inside
  `identity.*` that gate the sealed-link unseal path, applied and behave
  as written — Supabase does not restrict `SECURITY DEFINER` creation.
- **The DDL loop that enables + forces RLS on every `public` table**
  (`do $$ ... for t in select ... from pg_tables where schemaname =
  'public' ... $$`) applied without incident.
- **`alter default privileges`** statements (four of them, for `ref`,
  `public`, `internal`) applied without incident.
- **`exclude using gist`** on `ref.section_meeting` (the room
  double-booking constraint) applied without incident — `btree_gist` was
  already installed by the time this ran.

## Live verification

All 9 invariants from `scripts/schema-invariants.sql` were re-run
against the live database via `execute_sql` (same SQL, unmodified) and
all passed — the `do $$ ... $$` block completed with `All 9 schema
invariants hold.` and raised no exception. `list_tables` / `list_migrations`
confirm 17 migrations recorded and the expected table set present across
all 7 schemas.

## Advisor findings (`get_advisors`)

Recorded as requested. None of these were introduced by the Supabase
adaptation in Deviations 1–2 above — they are properties of the schema
as designed, now visible for the first time because the schema is
actually running on the platform's own linter.

### Security (`type: security`)

| Level | Count | Finding | Assessment |
|---|---|---|---|
| ERROR | 1 | `public.public_profiles` is a `SECURITY DEFINER`-equivalent view (`security_invoker = off`) | **Intentional, documented.** This is the entire point of the view — it is the one sanctioned cross-user read, and `docs/01-schema-notes.md` ("Public profile projection") explains exactly why `security_invoker` must be off here: the view has to read across users, which `app_user`'s own-row RLS forbids. Safety comes from the six-column allowlist (enforced by invariant 7), not from RLS. Not a regression; a reviewed trade-off the linter cannot distinguish from a mistake. |
| WARN | 24 | `function_search_path_mutable` — most `util.*` functions and most trigger functions (`tg_*`) do not `SET search_path` | **Pre-existing gap in `docs/01-schema.sql`, not introduced by the split.** The source is inconsistent: `SECURITY DEFINER` functions almost all set `search_path` explicitly (e.g. `public.current_app_user_id`, `identity.unseal`), but plain `LANGUAGE SQL`/`plpgsql` helpers and trigger functions (`util.fold_text`, `util.uuid_v7`, `public.tg_post_vote_counts`, etc.) do not. Worth a follow-up migration; out of scope for a mechanical split. |
| WARN | 12 | `anon_security_definer_function_executable` / `authenticated_security_definer_function_executable` on the six RLS-helper functions (`can_read_board`, `current_app_user_id`, `current_tier`, `current_university_id`, `is_conversation_participant`, `is_enrolled_in_section`) | **Intentional** — these are explicitly granted `EXECUTE` to `authenticated` (and now `service_role`) in section 19/migration `0016`, precisely so they can be called both inside RLS policies and directly. All are read-only boolean/id checks; none return sensitive data beyond what RLS already permits the caller to see. |
| WARN | 12 | Same two lint rules on six maintenance/recompute functions (`fold_karma_ledger`, `refresh_view_counts`, `refresh_complaint_counts`, `refresh_absence_limits`, `refresh_contributor_levels`, `recompute_seller_stats`) — callable by **anon**, not just `authenticated` | **FIXED by migration `0017_lock_down_function_execute.sql`. This row describes the state in August 2026 and is kept for the record, not as an open item.** It was a real gap: Postgres grants `EXECUTE` to `PUBLIC` on new functions, and `docs/01-schema.sql` originally revoked that only for the three identity-unsealing functions, leaving these six reachable through `/rest/v1/rpc/...`. `refresh_contributor_levels` was the serious one — the karma-delta mitigation depends on the badge refreshing on a *delay*, and a caller who can trigger the refresh chooses when the badge moves. 0017 default-denies (`revoke execute on all functions in schema public from public, anon, authenticated`), grants back only the six RLS helpers and `service_role`, and sets `alter default privileges ... revoke execute on functions from public` so the next function created here does not reopen it. Verified by measurement, not by reading: with every migration applied, `has_function_privilege('anon', …)` is false for all six and their ACL is `{postgres=X/postgres,service_role=X/postgres}`. Invariant 10 covers it going forward. |

### Performance (`type: performance`)

| Level | Count | Finding | Assessment |
|---|---|---|---|
| INFO | 117 | `unused_index` | **Noise on an empty database.** The project has zero rows and zero query traffic; every index is "unused" by definition right now. Re-check after seed data and real traffic. |
| INFO | 57 | `unindexed_foreign_keys` (37 in `public`, 6 `identity`, 6 `moderation`, 4 `career`, 3 `ref`, 1 `internal`) | **Pre-existing index-strategy choice, not introduced by the split.** `docs/01-schema-notes.md` ("Index strategy") documents 263 deliberately curated indexes for specific product query paths — the schema was never designed to index every single FK column, only the ones on documented hot paths. Some of these 57 may be worth adding later (e.g. `chat_message.sender_id`, `campus_event.created_by`), but that is a schema change, not a deployment deviation. |
| INFO | 1 | `no_primary_key` on `public.cohort_size` | **Intentional**, documented inline in the source (section 07.1): `cohort_size` uses `UNIQUE NULLS NOT DISTINCT (university_id, faculty_id, program_id, study_year)` instead of a primary key specifically so that the NULL-bearing roll-up rows (university-only, faculty-only) are addressable by a plain `ON CONFLICT` upsert, which a `NOT NULL` primary key could not support. |

## Not done (explicitly out of scope, not silently skipped)

- **pg_cron scheduling** — see "Migration file map" above. No schedule
  exists in the source to migrate; the extension is available on Supabase
  but was not installed, since installing it with nothing to schedule
  would be new functionality, not a split.
- **Deleting the superseded Tokyo project** (`htwblkemseevvhnzvwdc`) —
  `docs/04-infrastructure.md` says to delete it once satisfied nothing
  references it; left untouched here since that is a destructive,
  irreversible action outside this task's scope.
- **Missing `search_path` on ~24 functions** — still open. Recorded, not
  patched, per "do not change any SQL semantics while splitting"; a
  pre-existing property of `docs/01-schema.sql` rather than something
  Supabase rejected.
- ~~Missing `revoke ... from public` on 6 maintenance functions~~ —
  **closed by `0017_lock_down_function_execute.sql`.** This entry stayed in
  the "not done" list long after the migration that did it, and the WARN
  row above still read "flagged here, not fixed". That cost a later session
  a wasted round: it read the doc, grepped for a *per-function*
  `revoke execute on function public.<name>` (finding none, because 0017
  uses the blanket `on all functions in schema public` form), concluded the
  gap was live, and started writing a migration that already existed. The
  lesson is the project's own: **measure the database, do not read the
  note about the database.** One
  `select has_function_privilege('anon', oid, 'execute')` would have
  settled it in seconds.


## Deviation 3 — 0021 and 0022 were applied through the MCP tool, reformatted

**What happened.** `0021_auth_claims_hook` and `0022_automod_actions` were
applied to `houicgsdduzzcarxkuuo` through Supabase's `apply_migration` tool
rather than by running the repo file with `psql`. The SQL sent differs from the
file **textually but not semantically**:

- The function bodies are dollar-quoted `$fn$ … $fn$` instead of `$$ … $$`.
  `apply_migration` wraps the statement, and a nested bare `$$` terminates the
  outer quoting.
- Several long explanatory comments were dropped, and `§` was written out,
  to keep the payload manageable.

**Why this is worth recording.** The premise of this document is that the repo
is the source of truth and every difference from what is live is written down.
The repo files remain authoritative and are what `verify-migrations.sh` runs;
the live objects were then checked to match on the properties that matter
rather than on their text:

| Checked live | Result |
|---|---|
| `internal.token_claims` column list | exactly the six of invariant 11 |
| tier mapping present (`unverified → provisional`) | yes |
| `legal` role arm present | yes |
| null-university row excluded | yes |
| deactivated/erased excluded | yes |
| hook fails closed (`not found or v_sid is null`) | yes |
| hook `SECURITY DEFINER`, `STABLE`, `search_path` pinned | yes |
| hook owned by `kiksu_auth_hook_owner` | yes |
| hook role has no `identity` / `career` usage | correct — none |
| `'limit'` present in `moderation.action_kind` | yes |

All **11 invariants were then run against the live database** and passed. A
control statement raising a deliberate exception was run afterwards to confirm
that a failure would in fact surface through the tool, rather than the silent
pass being an artefact of how errors are reported.

**The hook was also exercised live**, not merely confirmed to exist: called with
a synthetic event carrying a smuggled `tier: card` in `app_metadata`, it
returned that block with the six keys stripped, which is the fail-closed path
for a caller with no `app_user` row.

**Still not done, and not SQL:** the hook is **not registered** in the project's
Auth settings. Until it is, it exists and never runs, every token is claimless,
and every authenticated route answers `token_invalid`. No query can detect that
state — the API logs the caveat on every boot instead.
