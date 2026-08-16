-- =====================================================================
-- Kiksu — database schema (Postgres 17 / Supabase)
-- Deliverable A of stage 1. Companion prose: docs/01-schema-notes.md
--
-- READ THIS HEADER BEFORE CHANGING ANYTHING BELOW.
--
-- The schema is split into SEVEN Postgres schemas. The split is not
-- cosmetic: it is the enforcement mechanism for the four identity layers
-- described in docs/00-project-brief.md. Grants, RLS and an event trigger
-- hang off the schema boundaries.
--
--   util        Generic helpers (uuid v7, text folding, FTS config,
--               updated_at). No data.
--   ref         Reference / catalogue data: universities, faculties,
--               departments, programmes, terms, rooms, courses, sections,
--               meetings, instructors, vocabularies, settings. Globally
--               readable, staff-written.
--   public      LAYER 2 (app_user) + every pseudonymous, user-facing
--               domain: forum, reviews, marketplace, vacancies, events,
--               clubs, notifications. Client gets SELECT here (RLS-gated)
--               and NOTHING else.
--   internal    LAYER 3 machinery + attribution maps. This is where
--               "which app_user wrote this anonymous thing" lives. No
--               client grants of any kind, ever.
--   identity    LAYER 1, SEALED. verified_identity + evidence + the
--               subject <-> app_user binding. Forced RLS, separate owner
--               role, every read audited, no grants to anon /
--               authenticated / service_role.
--   career      LAYER 4, SILOED. Real name + CV + job applications.
--               Reachable only via a keyed pointer that the database
--               itself cannot compute (see career.career_profile).
--   moderation  Cases, actions, staff, appeals. Moderator role only.
--
-- HARD INVARIANTS, and where each one is actually enforced:
--
--   I1  career_profile has NO traversable FK to app_user.
--       -> career.career_profile is keyed by subject_key = HMAC over the
--          auth user id with a pepper held OUTSIDE the database. There is
--          no column, no FK and no view that lets SQL walk from a career
--          row to an app_user row. Enforced additionally by the DDL event
--          trigger util.guard_identity_invariants() which rejects any
--          FK into public/internal from career, and rejects any column in
--          the career schema whose name looks like a user pointer.
--
--   I2  verified_identity is isolated; only the verification and
--       legal-request services may join it to app_user.
--       -> The binding lives in identity.app_user_link, which (a) is in
--          the sealed schema, (b) deliberately has NO foreign key to
--          public.app_user so no relationship exists in pg_constraint and
--          no cascade path exists, (c) has FORCE ROW LEVEL SECURITY with
--          a policy that only passes when a transaction-local GUC is set,
--          and (d) the only thing that sets that GUC is a SECURITY
--          DEFINER function that writes identity.access_log first.
--
--   I3  k-anonymity floor of 20.
--       -> ref.university.k_anon_min is CHECKed >= 20 (it cannot be
--          configured below the floor). public.cohort_size carries counts
--          only (never identifiers) and is pushed from the identity
--          service. public.app_user.display_* columns are nulled by
--          trigger when the cohort is too small.
--
--   I4  One verified person = one app_user.
--       -> identity.credential_binding UNIQUE (kind, credential_hmac)
--          plus identity.app_user_link UNIQUE on both columns.
--
-- CONVENTIONS
--   * ID VERSION IS A SECURITY BOUNDARY, not a performance preference:
--       - EXPOSED schemas (public, ref, career) use UUIDv4 from
--         gen_random_uuid(). A v7 id embeds a millisecond timestamp, so
--         returning one leaks the row's exact creation instant to anyone
--         holding it. That defeats the coarse-time bucketing the API
--         applies to visible timestamps, and re-opens threat T11
--         (creation-order -> join cohort -> freshman status).
--       - SEALED schemas (internal, identity) keep util.uuid_v7(). They
--         are never exposed, and they carry the append-heavy alias and
--         attribution tables where btree locality genuinely matters.
--     Enforced by invariant 9 in scripts/schema-invariants.sql.
--   * All wall-clock instants are timestamptz. Academic calendar dates
--     are date. Class meeting times are `time` interpreted in
--     ref.university.timezone.
--   * Money is integer minor units (qəpik) + an explicit currency code.
--   * Native ENUM for closed structural sets; a lookup TABLE in ref for
--     product vocabularies that will grow (tags, report reasons,
--     categories, notification kinds).
--   * Soft delete via deleted_at where content must survive moderation;
--     hard delete elsewhere.
--   * "Counter cache" columns are named *_count / *_sum and are listed in
--     docs/01-schema-notes.md with their maintenance strategy.
-- =====================================================================


-- =====================================================================
-- 01. EXTENSIONS
-- =====================================================================

create extension if not exists pgcrypto      with schema extensions;  -- gen_random_uuid, digest, hmac
create extension if not exists citext        with schema extensions;  -- case-insensitive domains/emails
create extension if not exists pg_trgm       with schema extensions;  -- fuzzy / substring search
create extension if not exists btree_gist    with schema extensions;  -- room double-booking exclusion
create extension if not exists unaccent      with schema extensions;  -- long tail of Latin diacritics
create extension if not exists pg_stat_statements with schema extensions;

-- Note: we do NOT rely on unaccent for Azerbaijani. Its rules file does
-- not cover U+0259 SCHWA (ə), which is the single most important
-- character in this product. Folding is done by util.fold_text below.


-- =====================================================================
-- 02. SCHEMAS AND ROLES
-- =====================================================================

create schema if not exists util;
create schema if not exists ref;
create schema if not exists internal;
create schema if not exists identity;
create schema if not exists career;
create schema if not exists moderation;

comment on schema internal is
  'Attribution maps and alias machinery. NEVER grant to anon/authenticated. Not in PostgREST db-schemas.';
comment on schema identity is
  'LAYER 1 SEALED. Reads only through identity.* SECURITY DEFINER accessors, which audit. Owned by kiksu_identity_owner.';
comment on schema career is
  'LAYER 4 SILO. No traversable path to public.app_user exists or may be added.';

-- Service roles. Supabase ships anon / authenticated / service_role.
-- We add one login role per trust boundary so that a credential leak in
-- one service does not hand over another layer. These are created
-- NOLOGIN here; passwords are set out of band during provisioning.
-- SUPABASE DEVIATION (see docs/07-supabase-deviations.md #1): the original
-- schema also created a `kiksu_app` NOLOGIN role here to serve as "the
-- normal server layer", later granted BYPASSRLS in section 18. Supabase's
-- managed Postgres only allows a superuser to grant BYPASSRLS, and the
-- connection migrations run as (`postgres`) is not one (see deviation #2).
-- Supabase's own `service_role` already carries BYPASSRLS and is exactly
-- what a trusted server layer should authenticate as, so `kiksu_app` is
-- dropped entirely and every grant that would have gone to it goes to
-- `service_role` instead. No table/column/RLS semantics change.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kiksu_identity_owner') then
    create role kiksu_identity_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kiksu_career_owner') then
    create role kiksu_career_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kiksu_identity_svc') then
    create role kiksu_identity_svc nologin; -- verification service only
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kiksu_career_svc') then
    create role kiksu_career_svc nologin;   -- career/applications service only
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kiksu_moderator') then
    create role kiksu_moderator nologin;    -- moderation console
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kiksu_analytics') then
    create role kiksu_analytics nologin;    -- recompute jobs, read-mostly
  end if;
end$$;

-- SUPABASE DEVIATION (see docs/07-supabase-deviations.md #2): the migration
-- role (`postgres`) has CREATEROLE but is not a member of the roles it just
-- created, so `alter schema ... owner to ...` fails with "must be able to
-- SET ROLE" (Postgres requires membership in the target role, not merely
-- having created it). Granting plain membership here is the Supabase-native
-- fix: postgres inherits owner-level privileges on the sealed schemas so
-- future migrations can still alter them, while the schemas remain owned by
-- their dedicated roles rather than by postgres directly — the separation
-- of trust boundaries the original design wanted is preserved. (`WITH ADMIN
-- OPTION` was tried first and rejected by Postgres 16+'s rule that ADMIN
-- OPTION cannot be granted back to your own grantor — postgres is already
-- the implicit grantor by virtue of CREATEROLE, so plain membership is both
-- sufficient and all that is allowed.)
grant kiksu_identity_owner to postgres;
grant kiksu_career_owner   to postgres;

alter schema identity owner to kiksu_identity_owner;
alter schema career   owner to kiksu_career_owner;

-- Nobody gets anything by default. Grants are handed out explicitly in
-- section 19.
revoke all on schema identity, career, internal, moderation from public;
revoke usage on schema identity from anon, authenticated, service_role;
revoke usage on schema career   from anon, authenticated, service_role;
revoke usage on schema internal from anon, authenticated;

grant usage on schema util, ref to anon, authenticated, service_role;
grant usage on schema internal to service_role;
grant usage on schema identity to kiksu_identity_svc;
grant usage on schema career   to kiksu_career_svc;
grant usage on schema moderation to kiksu_moderator, service_role;


