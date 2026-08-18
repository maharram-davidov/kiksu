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
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kiksu_identity_owner') then
    create role kiksu_identity_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kiksu_career_owner') then
    create role kiksu_career_owner nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kiksu_app') then
    create role kiksu_app nologin;          -- the normal server layer
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

alter schema identity owner to kiksu_identity_owner;
alter schema career   owner to kiksu_career_owner;

-- Nobody gets anything by default. Grants are handed out explicitly in
-- section 19.
revoke all on schema identity, career, internal, moderation from public;
revoke usage on schema identity from anon, authenticated, service_role;
revoke usage on schema career   from anon, authenticated, service_role;
revoke usage on schema internal from anon, authenticated;

grant usage on schema util, ref to anon, authenticated, service_role, kiksu_app;
grant usage on schema internal to service_role, kiksu_app;
grant usage on schema identity to kiksu_identity_svc;
grant usage on schema career   to kiksu_career_svc;
grant usage on schema moderation to kiksu_moderator, service_role;


-- =====================================================================
-- 03. UTIL — id generation, timestamps, text folding, FTS configuration
-- =====================================================================

-- --------------------------------------------------------------------
-- 03.1 UUID v7 — SEALED SCHEMAS ONLY
-- Postgres 17 has no native uuidv7 (that lands in 18).
--
-- Time-ordered keys reduce index write amplification on append-heavy
-- tables, which is why this exists. But a v7 id is a timestamp anyone can
-- read, so it must NEVER back a row whose id is returned to a client. Use
-- it only in internal.* and identity.*; everything in public/ref/career
-- uses gen_random_uuid(). See the conventions note above.
-- --------------------------------------------------------------------
create or replace function util.uuid_v7() returns uuid
language sql volatile parallel safe as $$
  select encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
          from 1 for 6
        ),
      52, 1),
    53, 1), 'hex')::uuid;
$$;

comment on function util.uuid_v7() is
  'RFC 9562 UUIDv7. Replace with the built-in uuidv7() when the project moves to Postgres 18.';

-- --------------------------------------------------------------------
-- 03.2 updated_at
-- --------------------------------------------------------------------
create or replace function util.tg_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end$$;

-- --------------------------------------------------------------------
-- 03.3 Text folding — the Azerbaijani search problem
--
-- Requirements:
--   * ə ğ ı ö ş ü ç must match their ASCII skeletons, because students
--     habitually type `e` for `ə` ("mualim", "pervane", "kecid").
--   * Russian content (Cyrillic) must survive folding intact apart from
--     ё -> е, which is the standard Russian search equivalence.
--   * The Azerbaijani dotted/dotless I trap: lower('İ') produces TWO
--     codepoints, 'i' + U+0307 COMBINING DOT ABOVE. If that combining
--     mark is not stripped, "İqtisad" and "iqtisad" do not match.
--     lower('I') produces 'i' in a non-Turkish locale, which conflates
--     I/ı — that is exactly what we want, because we fold ı -> i anyway.
--
-- The function must be IMMUTABLE because generated tsvector columns and
-- expression indexes depend on it. normalize(), lower(), translate() and
-- regexp_replace() are all immutable, so the composition is too.
--
-- OPERATIONAL HAZARD: CREATE OR REPLACE on this function silently
-- invalidates every stored generated column and expression index built
-- on it. Changing the fold rules is a migration, not an edit. See
-- docs/01-schema-notes.md ("Changing the fold rules") for the PG17
-- ALTER TABLE ... ALTER COLUMN ... SET EXPRESSION AS recipe.
-- --------------------------------------------------------------------
create or replace function util.fold_text(txt text) returns text
language sql immutable parallel safe strict as $$
  select translate(
           lower(normalize(txt, NFKC)),
           -- from: az specific + cyrillic yo + combining dot above
           'əğıöşüçё' || U&'\0307',
           -- to:   one shorter than `from`, so U+0307 is DELETED
           'egiosuc'  || U&'\0435'
         );
$$;

comment on function util.fold_text(text) is
  'Diacritic/script folding for search and for uniqueness keys. ə->e ğ->g ı->i ö->o ş->s ü->u ç->c ё->е, strips U+0307. IMMUTABLE: do not edit in place, migrate.';

-- Handle/slug folding also removes separators, so that `sakit-pərvanə-37`
-- and `sakitpervane37` collapse to the same uniqueness key. Without this,
-- diacritic-swapped lookalike handles are an impersonation vector.
create or replace function util.fold_handle(txt text) returns text
language sql immutable parallel safe strict as $$
  select regexp_replace(util.fold_text(txt), '[^a-z0-9]', '', 'g');
$$;

-- --------------------------------------------------------------------
-- 03.4 Full-text search configurations
--
-- There is no Azerbaijani stemmer in Postgres and writing one is out of
-- scope, so Azerbaijani uses `simple` (no stemming) over folded text.
-- Russian and English keep their real stemmers — folding leaves Cyrillic
-- and ASCII words untouched, so the stemmers still work.
-- --------------------------------------------------------------------
create text search configuration util.az (copy = pg_catalog.simple);
comment on text search configuration util.az is
  'Azerbaijani: `simple` tokenizer over util.fold_text() output. No stemmer exists; prefix + trigram indexes compensate.';

create text search configuration util.ru (copy = pg_catalog.russian);
create text search configuration util.en (copy = pg_catalog.english);

-- Maps a board/post/listing language code to a config. IMMUTABLE, so it
-- can be used inside GENERATED ALWAYS AS (...) STORED columns — that is
-- the whole point: the tsvector is derived from the row's own `lang`
-- column with zero trigger code.
create or replace function util.ts_config(lang text) returns regconfig
language sql immutable parallel safe as $$
  select case lang
           when 'ru' then 'util.ru'::regconfig
           when 'en' then 'util.en'::regconfig
           else           'util.az'::regconfig
         end;
$$;

-- Standard two-field weighted vector. A = title, B = body.
create or replace function util.tsv_ab(lang text, a text, b text) returns tsvector
language sql immutable parallel safe as $$
  select setweight(to_tsvector(util.ts_config(lang), util.fold_text(coalesce(a, ''))), 'A')
      || setweight(to_tsvector(util.ts_config(lang), util.fold_text(coalesce(b, ''))), 'B');
$$;

-- Query side MUST use this so that the query text is folded identically.
-- websearch_to_tsquery gives users quoted phrases and -exclusion for free.
create or replace function util.tsq(lang text, q text) returns tsquery
language sql stable parallel safe as $$
  select websearch_to_tsquery(util.ts_config(lang), util.fold_text(coalesce(q, '')));
$$;

comment on function util.tsq(text, text) is
  'Always build queries with this. Folding the query and not the index (or vice versa) is the classic way to break Azerbaijani search.';

-- --------------------------------------------------------------------
-- 03.5 Reddit-style hot ranking
-- The formula is time-ANCHORED, not decaying: the value only changes when
-- the score changes, so a stored column stays correct forever and a
-- plain btree on it is a valid feed ordering. Epoch base = 2025-01-01.
-- --------------------------------------------------------------------
create or replace function util.hot_rank(score integer, created_at timestamptz) returns double precision
language sql immutable parallel safe as $$
  select round(
           (sign(score)::numeric * log(greatest(abs(score), 1)::numeric + 1))
           + ((extract(epoch from created_at) - 1735689600) / 45000.0)::numeric
         , 7)::double precision;
$$;

-- CAVEAT: extract(epoch from timestamptz) is declared STABLE by
-- Postgres (some extract fields depend on TimeZone; `epoch` does not).
-- We therefore do NOT use hot_rank in a generated column — post.hot_rank
-- is maintained by the same trigger that maintains post.score. Do not add
-- a now() term here: the ranking must be an anchored constant per score
-- value, otherwise every feed read would need a full-table rescore.


-- =====================================================================
-- 04. ENUM TYPES
-- Closed structural sets only. Anything that product/ops will want to
-- extend without a migration is a lookup table in `ref` instead.
-- =====================================================================

create type public.locale_code            as enum ('az', 'ru', 'en');
create type public.verification_tier      as enum ('unverified', 'email_verified', 'card_verified');
create type public.verification_method    as enum ('university_email', 'student_card', 'invite_code', 'manual_staff');
create type public.app_user_status        as enum ('pending', 'active', 'muted', 'suspended', 'shadowbanned', 'deactivated', 'erased');
create type public.term_season            as enum ('payiz', 'yaz', 'yay');           -- autumn / spring / summer
create type public.meeting_kind           as enum ('lecture', 'seminar', 'lab', 'exam', 'consultation');
create type public.week_parity            as enum ('every', 'odd', 'even');
create type public.enrollment_state       as enum ('enrolled', 'dropped', 'completed', 'failed');
create type public.absence_kind           as enum ('absent', 'late', 'excused');
create type public.absence_source         as enum ('self_reported', 'instructor', 'import');
create type public.coursework_kind        as enum ('homework', 'lab', 'project', 'quiz', 'midterm', 'final', 'presentation', 'other');
create type public.coursework_origin      as enum ('official', 'crowdsourced', 'personal');
create type public.board_scope            as enum ('national', 'university', 'faculty', 'course', 'club');
create type public.post_kind              as enum ('text', 'image', 'link', 'poll');
create type public.author_display_mode    as enum ('alias', 'handle', 'staff');
create type public.moderation_state       as enum ('visible', 'pending_review', 'limited', 'removed');
create type public.listing_condition      as enum ('new', 'like_new', 'good', 'fair', 'poor');
create type public.listing_status         as enum ('draft', 'active', 'reserved', 'sold', 'expired', 'removed');
create type public.deal_state             as enum ('inquiry', 'agreed', 'completed', 'cancelled', 'disputed');
create type public.conversation_kind      as enum ('listing', 'direct');
create type public.chat_message_kind      as enum ('text', 'image', 'offer', 'system');
create type public.vacancy_kind           as enum ('internship', 'part_time', 'full_time', 'volunteer', 'thesis', 'scholarship');
create type public.work_mode              as enum ('onsite', 'hybrid', 'remote');
create type public.vacancy_status         as enum ('draft', 'active', 'paused', 'closed', 'expired');
create type public.event_kind             as enum ('career', 'academic', 'club', 'social', 'sport', 'other');
create type public.rsvp_state             as enum ('going', 'interested', 'cancelled');
create type public.club_member_role       as enum ('owner', 'admin', 'member');
create type public.report_target_type     as enum ('post', 'comment', 'review', 'listing', 'chat_message', 'app_user', 'event', 'club');
create type public.alias_state            as enum ('reserved', 'active');
create type public.accent_color           as enum ('turquoise', 'bronze', 'pomegranate', 'indigo', 'ink', 'moss', 'plum');

create type identity.verification_state   as enum ('none', 'pending', 'in_review', 'verified', 'rejected', 'expired', 'revoked');
create type identity.credential_kind      as enum ('university_email', 'student_number', 'card_image_hash', 'invite_code', 'national_id');
create type identity.access_purpose       as enum ('verification', 'legal_request', 'safety_escalation', 'user_data_request', 'cohort_recount', 'incident_response');

create type career.application_state      as enum ('draft', 'submitted', 'viewed', 'shortlisted', 'rejected', 'withdrawn', 'hired');
create type career.document_kind          as enum ('cv', 'transcript', 'certificate', 'portfolio', 'cover_letter');

create type moderation.mod_case_state         as enum ('open', 'triage', 'actioned', 'dismissed', 'escalated');
create type moderation.action_kind        as enum ('no_action', 'remove_content', 'restore_content', 'warn', 'mute', 'suspend', 'ban', 'shadowban', 'unban', 'escalate_legal');
create type moderation.staff_role         as enum ('moderator', 'senior_moderator', 'admin', 'legal');


-- Postgres declares enum_out() STABLE, so `some_enum::text` is STABLE too
-- and Postgres refuses it inside a stored generated column or an index
-- expression. Every generated column that needs the locale as text must go
-- through this CASE-based helper, which is genuinely immutable.
create or replace function util.locale_text(l public.locale_code) returns text
language sql immutable parallel safe strict as $$
  select case l when 'az' then 'az' when 'ru' then 'ru' when 'en' then 'en' end;
$$;

comment on function util.locale_text(public.locale_code) is
  'Immutable enum->text. Never write lang::text in a generated column or index; enum_out is STABLE.';

-- =====================================================================
-- 05. REF — universities, calendar, courses, instructors, vocabularies
-- Written by staff / import jobs. Readable by everyone (anon included
-- for the onboarding screen, which runs before any account exists).
-- =====================================================================

-- --------------------------------------------------------------------
-- 05.1 University
-- Screen 01 renders: code badge (BDU), full name, city, selection state.
-- --------------------------------------------------------------------
create table ref.university (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null,                    -- 'BDU', 'ADA', 'UNEC', 'BMU'
  name_az                 text not null,                    -- 'Bakı Dövlət Universiteti'
  name_ru                 text,
  name_en                 text,
  city_az                 text not null,                    -- 'Bakı', 'Xırdalan'
  city_ru                 text,
  city_en                 text,
  timezone                text not null default 'Asia/Baku',
  default_locale          public.locale_code not null default 'az',
  brand_color             text check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_storage_path       text,

  -- k-anonymity floor. The CHECK is the enforcement of invariant I3: an
  -- operator cannot lower this below 20 through configuration, only
  -- through a migration that is visible in review.
  k_anon_min              integer not null default 20 check (k_anon_min >= 20),

  -- Default absence allowance when no narrower policy matches.
  -- Design screen 04 shows 12 for a 6-credit course at BDU.
  default_absence_limit   integer not null default 12 check (default_absence_limit > 0),

  is_active               boolean not null default true,
  onboarding_order        integer,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  name_search             tsvector generated always as (
                            util.tsv_ab('az', code || ' ' || name_az,
                                        coalesce(name_ru, '') || ' ' || coalesce(name_en, '') || ' ' || city_az)
                          ) stored,

  constraint university_code_uniq unique (code)
);
create index university_search_idx  on ref.university using gin (name_search);
create index university_trgm_idx    on ref.university using gin (util.fold_text(name_az) extensions.gin_trgm_ops);
create index university_active_idx  on ref.university (onboarding_order) where is_active;

comment on column ref.university.k_anon_min is
  'Minimum cohort size before an attribute combination may be displayed. CHECK >= 20 makes the brief''s floor structural.';

-- Email domains accepted for the `university_email` route.
-- Design: 'ad.soyad@std.bsu.edu.az'.
create table ref.university_email_domain (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references ref.university(id) on delete cascade,
  domain          extensions.citext not null,               -- 'std.bsu.edu.az'
  audience        text not null default 'student' check (audience in ('student', 'staff', 'alumni')),
  sample_pattern  text,                                     -- 'ad.soyad@std.bsu.edu.az' shown in the UI
  is_primary      boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint university_email_domain_uniq unique (domain)
);
create index university_email_domain_univ_idx on ref.university_email_domain (university_id) where is_active;

-- Which verification routes a given university offers, in what order,
-- with the SLA the onboarding screen advertises.
-- Design: email "2 dəqiqə" + TÖVSİYƏ badge, card "24 saata qədər",
-- invite code "Kursdaşından 6 rəqəmli kod".
create table ref.university_verification_route (
  university_id   uuid not null references ref.university(id) on delete cascade,
  method          public.verification_method not null,
  is_enabled      boolean not null default true,
  is_recommended  boolean not null default false,
  sla_minutes     integer not null check (sla_minutes > 0),  -- 2 / 1440
  display_order   smallint not null default 0,
  note_az         text,
  note_ru         text,
  note_en         text,
  primary key (university_id, method)
);
-- At most one recommended route per university (the TÖVSİYƏ badge).
create unique index university_route_one_recommended_idx
  on ref.university_verification_route (university_id) where is_recommended;

-- --------------------------------------------------------------------
-- 05.2 Faculty / department / programme
-- Two different things in the design, do not conflate:
--   faculty    student-facing org unit  -> "BDU · İNFORMATİKA · 2-Cİ KURS"
--   department instructor's kafedra     -> "İNFORMATİKA KAFEDRASI · BDU"
--   programme  the actual degree track  -> the k-anonymity risk surface
-- --------------------------------------------------------------------
create table ref.faculty (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references ref.university(id) on delete cascade,
  code            text,
  name_az         text not null,
  name_ru         text,
  name_en         text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint faculty_code_uniq unique (university_id, code)
);
create index faculty_university_idx on ref.faculty (university_id) where is_active;

create table ref.department (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references ref.university(id) on delete cascade,
  faculty_id      uuid references ref.faculty(id) on delete set null,
  code            text,
  name_az         text not null,                            -- 'İnformatika kafedrası'
  name_ru         text,
  name_en         text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint department_code_uniq unique (university_id, code)
);
create index department_faculty_idx on ref.department (faculty_id);

create table ref.program (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references ref.university(id) on delete cascade,
  faculty_id      uuid not null references ref.faculty(id) on delete cascade,
  code            text,
  name_az         text not null,
  name_ru         text,
  name_en         text,
  degree_level    text not null default 'bachelor'
                  check (degree_level in ('bachelor', 'master', 'phd', 'preparatory')),
  normal_years    smallint not null default 4 check (normal_years between 1 and 8),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint program_code_uniq unique (university_id, code)
);
create index program_faculty_idx on ref.program (faculty_id) where is_active;

comment on table ref.program is
  'Small programmes are THE de-anonymisation risk ("3rd year, Petroleum Engineering"). Never render programme on a public surface without checking public.cohort_size against ref.university.k_anon_min.';

-- --------------------------------------------------------------------
-- 05.3 Academic calendar
-- Design: "2025/26 · PAYIZ SEMESTRİ", review keys "2024/25 YAZ".
-- --------------------------------------------------------------------
create table ref.academic_year (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references ref.university(id) on delete cascade,
  label           text not null,                            -- '2025/26'
  starts_on       date not null,
  ends_on         date not null,
  constraint academic_year_uniq unique (university_id, label),
  constraint academic_year_range_ck check (ends_on > starts_on)
);

create table ref.term (
  id                 uuid primary key default gen_random_uuid(),
  university_id      uuid not null references ref.university(id) on delete cascade,
  academic_year_id   uuid not null references ref.academic_year(id) on delete cascade,
  season             public.term_season not null,
  label              text not null,                         -- '2025/26 Payız'
  starts_on          date not null,
  ends_on            date not null,
  add_drop_ends_on   date,
  exams_start_on     date,
  is_current         boolean not null default false,
  constraint term_uniq unique (academic_year_id, season),
  constraint term_range_ck check (ends_on > starts_on)
);
-- Exactly one current term per university keeps "which semester am I in"
-- a single indexed lookup instead of a date range scan.
create unique index term_one_current_idx on ref.term (university_id) where is_current;
create index term_university_dates_idx on ref.term (university_id, starts_on desc);

-- --------------------------------------------------------------------
-- 05.4 Campus / room
-- Design: "II KORPUS 312", "BAŞ KORPUS 205", "L-3".
-- --------------------------------------------------------------------
create table ref.campus (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references ref.university(id) on delete cascade,
  name_az         text not null,                            -- 'Baş korpus', 'II korpus'
  name_ru         text,
  name_en         text,
  address         text,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  constraint campus_name_uniq unique (university_id, name_az)
);

create table ref.room (
  id              uuid primary key default gen_random_uuid(),
  campus_id       uuid not null references ref.campus(id) on delete cascade,
  code            text not null,                            -- '312', 'L-3'
  floor           smallint,
  capacity        integer,
  kind            text check (kind in ('classroom', 'lab', 'auditorium', 'studio', 'online')),
  constraint room_code_uniq unique (campus_id, code)
);
create index room_campus_idx on ref.room (campus_id);

-- --------------------------------------------------------------------
-- 05.5 Instructor
-- Instructor names are REAL and public — this is a professor-review
-- product, the same as the reference competitor. Instructors are not
-- app_users and must never be linked to one.
-- Design: "dos. Nigar Əliyeva", initials "NƏ", "İNFORMATİKA KAFEDRASI · BDU".
-- --------------------------------------------------------------------
create table ref.instructor (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references ref.university(id) on delete cascade,
  department_id   uuid references ref.department(id) on delete set null,
  title_prefix    text,                                     -- 'dos.', 'prof.', 'b/m.'
  full_name       text not null,                            -- 'Nigar Əliyeva'
  slug            text not null,
  initials        text,                                     -- 'NƏ' (rendered avatar)
  email_public    text,
  is_active       boolean not null default true,
  is_claimed      boolean not null default false,           -- instructor claimed their page
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  name_folded     text generated always as (util.fold_text(full_name)) stored,
  name_search     tsvector generated always as (
                    util.tsv_ab('az', full_name, coalesce(title_prefix, ''))
                  ) stored,

  constraint instructor_slug_uniq unique (university_id, slug)
);
create index instructor_department_idx on ref.instructor (department_id) where is_active;
create index instructor_search_idx     on ref.instructor using gin (name_search);
-- "Əliyeva" typed as "Aliyeva" must still match: trigram over folded name.
create index instructor_trgm_idx       on ref.instructor using gin (name_folded extensions.gin_trgm_ops);

-- --------------------------------------------------------------------
-- 05.6 Course / section / meeting
-- Design screen 04: "CS 214 · 6 KREDİT", "Verilənlər bazası sistemləri".
-- Screen 03: a week grid of 80-minute blocks, Mon–Fri, 09:00–17:00.
-- --------------------------------------------------------------------
create table ref.course (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references ref.university(id) on delete cascade,
  department_id   uuid references ref.department(id) on delete set null,
  code            text not null,                            -- 'CS 214'
  title_az        text not null,                            -- 'Verilənlər bazası sistemləri'
  title_ru        text,
  title_en        text,
  short_title     text,                                     -- grid label, e.g. 'Verilənlər bazası'
  credits         numeric(4, 1) check (credits >= 0),       -- 6
  level           smallint check (level between 1 and 8),
  description     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  code_folded     text generated always as (util.fold_handle(code)) stored,
  title_search    tsvector generated always as (
                    util.tsv_ab('az', code || ' ' || title_az,
                                coalesce(title_ru, '') || ' ' || coalesce(title_en, '') || ' ' || coalesce(description, ''))
                  ) stored,

  constraint course_code_uniq unique (university_id, code)
);
create index course_department_idx on ref.course (department_id) where is_active;
create index course_search_idx     on ref.course using gin (title_search);
create index course_code_trgm_idx  on ref.course using gin (code_folded extensions.gin_trgm_ops);

-- A concrete offering of a course in one term. Enrollment, absence,
-- timetable and coursework all hang off the SECTION, not the course.
create table ref.course_section (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null references ref.course(id) on delete cascade,
  term_id            uuid not null references ref.term(id) on delete cascade,
  section_code       text not null default '1',             -- 'A', '1', 'lab-3'
  primary_instructor_id uuid references ref.instructor(id) on delete set null,
  lang               public.locale_code not null default 'az',
  capacity           integer,
  enrolled_count     integer not null default 0,            -- counter cache
  -- Per-section override of the absence allowance. NULL = inherit from
  -- the policy chain (see ref.absence_policy).
  absence_limit_override integer check (absence_limit_override > 0),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  constraint course_section_uniq unique (course_id, term_id, section_code)
);
create index course_section_term_idx       on ref.course_section (term_id);
create index course_section_instructor_idx on ref.course_section (primary_instructor_id, term_id);

-- Several instructors can touch one section (lecturer + lab assistant).
create table ref.section_instructor (
  section_id      uuid not null references ref.course_section(id) on delete cascade,
  instructor_id   uuid not null references ref.instructor(id) on delete cascade,
  role            text not null default 'lecturer'
                  check (role in ('lecturer', 'assistant', 'lab', 'guest')),
  primary key (section_id, instructor_id, role)
);
create index section_instructor_instructor_idx on ref.section_instructor (instructor_id);

-- The timetable grid itself. weekday follows ISO-8601: 1 = Monday.
-- Design shows B.E Ç.A Ç C.A C = 1..5.
create table ref.section_meeting (
  id              uuid primary key default gen_random_uuid(),
  section_id      uuid not null references ref.course_section(id) on delete cascade,
  weekday         smallint not null check (weekday between 1 and 7),
  starts_at       time not null,                            -- 14:05, local to university timezone
  ends_at         time not null,
  room_id         uuid references ref.room(id) on delete set null,
  kind            public.meeting_kind not null default 'lecture',
  parity          public.week_parity not null default 'every',
  valid_from      date,
  valid_to        date,
  created_at      timestamptz not null default now(),
  constraint section_meeting_time_ck check (ends_at > starts_at),

  -- A room cannot host two meetings at once. This catches the single
  -- most common timetable-import defect before students see it.
  constraint section_meeting_room_no_overlap
    exclude using gist (
      room_id  with =,
      weekday  with =,
      parity   with =,
      tsrange(('2000-01-01'::date + starts_at), ('2000-01-01'::date + ends_at)) with &&
    ) where (room_id is not null)
);
create index section_meeting_section_idx on ref.section_meeting (section_id, weekday, starts_at);
create index section_meeting_room_idx    on ref.section_meeting (room_id, weekday, starts_at);

-- One-off changes: cancelled class, moved room, moved time.
create table ref.section_meeting_exception (
  id              uuid primary key default gen_random_uuid(),
  meeting_id      uuid not null references ref.section_meeting(id) on delete cascade,
  on_date         date not null,
  status          text not null check (status in ('cancelled', 'moved', 'extra')),
  new_room_id     uuid references ref.room(id) on delete set null,
  new_starts_at   time,
  new_ends_at     time,
  note_az         text,
  created_at      timestamptz not null default now(),
  constraint section_meeting_exception_uniq unique (meeting_id, on_date)
);
create index section_meeting_exception_date_idx on ref.section_meeting_exception (on_date, meeting_id);

-- --------------------------------------------------------------------
-- 05.7 Absence policy — configurable, never hardcoded
-- Design screen 04: "4 / 12", "İcazəli qayıb limitinin 33%-i istifadə
-- olunub. 12 qayıbdan sonra kursdan kənarlaşdırılma."
--
-- Resolution order (most specific wins):
--   section override -> course policy -> faculty policy -> university
--   policy -> ref.university.default_absence_limit
-- --------------------------------------------------------------------
create table ref.absence_policy (
  id                 uuid primary key default gen_random_uuid(),
  university_id      uuid not null references ref.university(id) on delete cascade,
  faculty_id         uuid references ref.faculty(id) on delete cascade,
  course_id          uuid references ref.course(id) on delete cascade,

  max_absences       integer not null check (max_absences > 0),      -- 12
  expulsion_at       integer check (expulsion_at > 0),               -- default = max_absences
  late_counts_as     numeric(3, 2) not null default 0.50
                     check (late_counts_as >= 0 and late_counts_as <= 1),
  warn_at_ratio      numeric(3, 2) not null default 0.50
                     check (warn_at_ratio > 0 and warn_at_ratio <= 1),
  excused_counts     boolean not null default false,
  effective_from     date not null default current_date,
  effective_to       date,
  note_az            text,
  created_at         timestamptz not null default now(),

  -- Specificity of the row, derived so the resolver can ORDER BY it.
  specificity        smallint generated always as (
                       case when course_id  is not null then 3
                            when faculty_id is not null then 2
                            else 1 end
                     ) stored
);
create index absence_policy_lookup_idx
  on ref.absence_policy (university_id, course_id, faculty_id, specificity desc);

-- Resolver. Kept in SQL so the timetable/attendance read path is a single
-- round trip and so the rule cannot drift between clients.
create or replace function ref.effective_absence_limit(p_section_id uuid)
returns table (max_absences integer, expulsion_at integer, late_counts_as numeric, warn_at_ratio numeric)
language sql stable as $$
  with s as (
    select cs.id, cs.absence_limit_override, c.id as course_id,
           c.university_id, d.faculty_id
    from ref.course_section cs
    join ref.course c     on c.id = cs.course_id
    left join ref.department d on d.id = c.department_id
    where cs.id = p_section_id
  ),
  p as (
    select ap.*
    from ref.absence_policy ap, s
    where ap.university_id = s.university_id
      and (ap.course_id  is null or ap.course_id  = s.course_id)
      and (ap.faculty_id is null or ap.faculty_id = s.faculty_id)
      and ap.effective_from <= current_date
      and (ap.effective_to is null or ap.effective_to >= current_date)
    order by ap.specificity desc, ap.effective_from desc
    limit 1
  )
  select
    coalesce(s.absence_limit_override, p.max_absences, u.default_absence_limit),
    coalesce(p.expulsion_at, s.absence_limit_override, p.max_absences, u.default_absence_limit),
    coalesce(p.late_counts_as, 0.50),
    coalesce(p.warn_at_ratio, 0.50)
  from s
  join ref.university u on u.id = s.university_id
  left join p on true;
$$;

-- --------------------------------------------------------------------
-- 05.8 Grade scale (GPA support)
-- --------------------------------------------------------------------
create table ref.grade_scale (
  id              uuid primary key default gen_random_uuid(),
  university_id   uuid not null references ref.university(id) on delete cascade,
  letter          text not null,                            -- 'A', 'B', ...
  min_score       numeric(5, 2) not null,
  max_score       numeric(5, 2) not null,
  gpa_points      numeric(3, 2) not null,
  is_passing      boolean not null default true,
  constraint grade_scale_uniq  unique (university_id, letter),
  constraint grade_scale_range check (max_score >= min_score)
);

-- --------------------------------------------------------------------
-- 05.9 Product vocabularies (extensible without migrations)
-- --------------------------------------------------------------------

-- Review tags. Design screen 07: SLAYDLAR AYDIN / LAB. FAYDALI (positive,
-- teal) and YOXLAMA SIX (negative, pomegranate). Polarity drives colour.
create table ref.review_tag (
  key             text primary key,                         -- 'slides_clear'
  label_az        text not null,                            -- 'Slaydlar aydın'
  label_ru        text,
  label_en        text,
  polarity        text not null check (polarity in ('positive', 'neutral', 'negative')),
  applies_to      text not null default 'both' check (applies_to in ('instructor', 'course', 'both')),
  display_order   smallint not null default 0,
  is_active       boolean not null default true
);

-- Curated Azerbaijani wordlist for generated handles: adjective-noun-NN
-- ('sakit-pərvanə-37'). The assignment ALGORITHM belongs to the Identity
-- Architect; this table is the vocabulary it draws from.
create table ref.handle_word (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('adjective', 'noun')),
  word            text not null,                            -- 'sakit' / 'pərvanə'
  weight          smallint not null default 1 check (weight > 0),
  is_active       boolean not null default true,
  -- Folded form so that two words that render identically after folding
  -- cannot both be active (avoids confusable handles).
  word_folded     text generated always as (util.fold_handle(word)) stored,
  constraint handle_word_uniq unique (kind, word_folded)
);
create index handle_word_pick_idx on ref.handle_word (kind) where is_active;

create table ref.marketplace_category (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid references ref.marketplace_category(id) on delete cascade,
  key             text not null unique,                     -- 'textbooks_notes'
  name_az         text not null,                            -- 'Dərslik və qeydlər'
  name_ru         text,
  name_en         text,
  display_order   smallint not null default 0,
  -- JSON Schema describing the category-specific attribute chips the
  -- design renders ("QEYDLƏR VAR", "2 KİTAB"). Validated in the server
  -- layer; stored here so one deploy adds a category + its filters.
  attribute_schema jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true
);
create index marketplace_category_parent_idx on ref.marketplace_category (parent_id, display_order);

create table ref.sector (
  id              uuid primary key default gen_random_uuid(),
  key             text not null unique,                     -- 'it'
  name_az         text not null,
  name_ru         text,
  name_en         text,
  display_order   smallint not null default 0,
  is_active       boolean not null default true
);

create table ref.notification_kind (
  key             text primary key,                         -- 'comment_reply'
  default_push    boolean not null default true,
  default_email   boolean not null default false,
  is_mutable      boolean not null default true,            -- false = always delivered (safety/legal)
  display_order   smallint not null default 0
);

create table ref.report_reason (
  key             text primary key,                         -- 'harassment'
  label_az        text not null,
  label_ru        text,
  label_en        text,
  applies_to      public.report_target_type[] not null,
  severity        smallint not null default 1 check (severity between 1 and 5),
  auto_hide_at_count integer,                               -- auto limit content after N reports
  display_order   smallint not null default 0,
  is_active       boolean not null default true
);

-- Default board set created for every new university at seed time.
create table ref.board_template (
  key             text primary key,                         -- 'course_and_teacher'
  name_az         text not null,                            -- 'Dərs və müəllim'
  name_ru         text,
  name_en         text,
  description_az  text,
  scope           public.board_scope not null default 'university',
  lang            public.locale_code not null default 'az',
  display_order   smallint not null default 0,
  is_default_follow boolean not null default false
);

-- Global, environment-level settings that ops must be able to move
-- without a deploy (rate limits, feature flags, ranking constants).
create table ref.app_setting (
  key             text primary key,
  value           jsonb not null,
  description     text,
  updated_at      timestamptz not null default now(),
  updated_by      text
);


-- =====================================================================
-- 06. IDENTITY — LAYER 1, SEALED
--
-- Nothing in this schema is ever rendered in a user-facing surface.
-- Nothing outside the verification and legal-request services may read
-- it. The controls, in order of strength:
--
--   1. Schema is owned by kiksu_identity_owner and USAGE is granted only
--      to kiksu_identity_svc. anon, authenticated and service_role have
--      no USAGE — the Supabase service key cannot reach this schema.
--   2. Not listed in PostgREST `db-schemas`, so no HTTP surface exists.
--   3. RLS is ENABLED *and* FORCED on every table, so even the owning
--      role is subject to policy. The policy on the linking table only
--      passes when a transaction-local GUC is set.
--   4. The only thing that sets that GUC is identity.unseal(), a
--      SECURITY DEFINER function that writes identity.access_log FIRST
--      and requires a declared purpose (and, for legal purposes, an
--      approved identity.legal_request row).
--   5. identity.access_log is append-only, enforced by trigger.
--
-- Residual risk that the database cannot close: a superuser or a role
-- with BYPASSRLS (Supabase's `postgres` role has it) can read anything.
-- That is a platform-access-control problem, documented in the notes.
--
-- THE AUTH ANCHOR RULE
-- auth.users must NOT contain the university email. If it did, the
-- trivially joinable path app_user -> auth.users -> email would leak
-- 'ad.soyad@std.bsu.edu.az' — i.e. the student's real name — and the
-- whole four-layer model would be decorative. Accounts are created with
-- a synthetic address (<uuid>@users.kiksu.app) or phone; the university
-- email is submitted to the verification service, reduced to an HMAC in
-- identity.credential_binding, and the plaintext is discarded once the
-- confirmation link is consumed. identity.auth_email_leak_check exists
-- to make a regression here loud.
-- =====================================================================

-- --------------------------------------------------------------------
-- 06.1 Subject — one row per verified human being
--
-- subject_key = HMAC-SHA256(pepper_identity, 'kiksu:identity:v1' || auth_uid)
-- computed by the verification service. The pepper lives in the service's
-- KMS/secret store, NEVER in this database (that includes Supabase Vault,
-- which is in-database). Consequence: a full dump of Postgres does not
-- let the reader map a subject back to an auth account.
-- --------------------------------------------------------------------
create table identity.subject (
  id              uuid primary key default util.uuid_v7(),
  subject_key     bytea not null,
  key_version     smallint not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint subject_key_uniq unique (subject_key),
  constraint subject_key_len  check (octet_length(subject_key) = 32)
);

comment on column identity.subject.subject_key is
  'HMAC(auth uid) under a pepper held outside the database. There is deliberately no auth.users FK: the mapping must not be recomputable from a database dump alone.';

-- --------------------------------------------------------------------
-- 06.2 Verified identity — the sealed attribute set
-- --------------------------------------------------------------------
create table identity.verified_identity (
  id                    uuid primary key default util.uuid_v7(),
  subject_id            uuid not null references identity.subject(id) on delete restrict,

  university_id         uuid not null references ref.university(id),
  faculty_id            uuid references ref.faculty(id),
  program_id            uuid references ref.program(id),
  entry_year            smallint check (entry_year between 1990 and 2100),
  expected_graduation_year smallint check (expected_graduation_year between 1990 and 2100),
  degree_level          text check (degree_level in ('bachelor', 'master', 'phd', 'preparatory')),

  -- PII: ciphertext produced by the verification service with an envelope
  -- key from an external KMS. The database stores bytes it cannot read.
  legal_name_ct         bytea,
  legal_name_kid        text,
  student_number_hmac   bytea,

  tier                  public.verification_tier not null default 'unverified',
  state                 identity.verification_state not null default 'none',
  method                public.verification_method,

  verified_at           timestamptz,
  expires_at            timestamptz,                        -- re-verification cadence
  revoked_at            timestamptz,
  revocation_reason     text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint verified_identity_subject_uniq unique (subject_id),
  constraint verified_identity_tier_ck check (
    (tier = 'unverified') or (state = 'verified' and verified_at is not null)
  )
);
create index verified_identity_cohort_idx
  on identity.verified_identity (university_id, faculty_id, program_id, entry_year)
  where state = 'verified';

comment on table identity.verified_identity is
  'LAYER 1. Never rendered. The only thing that leaves this schema is (a) a coarse, k-anonymity-checked projection onto public.app_user and (b) aggregate counts in public.cohort_size.';

-- --------------------------------------------------------------------
-- 06.3 Credential binding — "one verified person = one app_user"
--
-- The unique index on (kind, credential_hmac) is the structural version
-- of invariant I4: the same university email / student number cannot
-- produce a second subject. Salt is per-credential-kind and peppered
-- outside the DB, so the table is not a rainbow-table target.
-- --------------------------------------------------------------------
create table identity.credential_binding (
  id                 uuid primary key default util.uuid_v7(),
  subject_id         uuid not null references identity.subject(id) on delete restrict,
  kind               identity.credential_kind not null,
  credential_hmac    bytea not null,
  key_version        smallint not null default 1,
  university_id      uuid references ref.university(id),
  first_seen_at      timestamptz not null default now(),
  last_verified_at   timestamptz,
  released_at        timestamptz,                            -- graduation / account erasure
  constraint credential_binding_uniq unique (kind, credential_hmac),
  constraint credential_hmac_len check (octet_length(credential_hmac) = 32)
);
create index credential_binding_subject_idx on identity.credential_binding (subject_id);

-- --------------------------------------------------------------------
-- 06.4 Verification attempts (the state machine's storage)
-- The state machine itself is the Identity Architect's deliverable. This
-- table only has to be able to hold it: one row per attempt, an SLA
-- deadline (2 minutes for email, 24h for card review), evidence pointer,
-- reviewer decision, and abuse counters.
-- --------------------------------------------------------------------
create table identity.verification_attempt (
  id                  uuid primary key default util.uuid_v7(),
  subject_id          uuid references identity.subject(id) on delete cascade,
  auth_user_id_hmac   bytea,                                 -- for pre-subject attempts
  university_id       uuid not null references ref.university(id),
  method              public.verification_method not null,
  state               identity.verification_state not null default 'pending',

  -- Evidence lives in a PRIVATE storage bucket. We keep the path plus a
  -- content hash so tampering is detectable, and a purge deadline.
  evidence_path       text,
  evidence_sha256     bytea,
  evidence_purge_at   timestamptz,

  challenge_hmac      bytea,                                 -- emailed token / 6-digit code
  challenge_expires_at timestamptz,
  attempt_count       smallint not null default 0,
  sla_due_at          timestamptz,

  decided_at          timestamptz,
  decided_by_staff_id uuid,                                  -- moderation.staff.id, intentionally no FK
  decision            text check (decision in ('approved', 'rejected', 'needs_more_info')),
  reject_reason_code  text,

  -- Abuse signals, hashed. Never store raw IP or UA in this schema.
  ip_hmac             bytea,
  user_agent_hmac     bytea,
  device_hmac         bytea,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index verification_attempt_queue_idx
  on identity.verification_attempt (state, sla_due_at)
  where state in ('pending', 'in_review');
create index verification_attempt_subject_idx on identity.verification_attempt (subject_id, created_at desc);
create index verification_attempt_device_idx  on identity.verification_attempt (device_hmac) where device_hmac is not null;

-- Invite codes: 6 digits, issued by an already-verified student.
create table identity.invite_code (
  id                 uuid primary key default util.uuid_v7(),
  code_hmac          bytea not null unique,
  issuer_subject_id  uuid not null references identity.subject(id) on delete cascade,
  university_id      uuid not null references ref.university(id),
  max_uses           smallint not null default 1 check (max_uses > 0),
  used_count         smallint not null default 0,
  expires_at         timestamptz not null,
  revoked_at         timestamptz,
  created_at         timestamptz not null default now(),
  constraint invite_code_uses_ck check (used_count <= max_uses)
);
create index invite_code_issuer_idx on identity.invite_code (issuer_subject_id);

-- --------------------------------------------------------------------
-- 06.5 THE SEALED LINK
--
-- This is the single most dangerous table in the product. It is the only
-- place where "which pseudonym belongs to which verified student" is
-- written down.
--
-- Deliberate design choices:
--   * app_user_id has NO FOREIGN KEY. An FK would (a) publish the
--     relationship in pg_constraint, so every ER diagram, ORM
--     introspection and "helpful" JOIN suggestion would surface it, and
--     (b) create a cascade path between the layers. Referential
--     integrity here is maintained by the verification service.
--   * UNIQUE on both columns: one subject <-> one app_user (invariant I4).
--   * FORCE ROW LEVEL SECURITY: the owner does not get a free pass.
-- --------------------------------------------------------------------
create table identity.app_user_link (
  subject_id      uuid primary key references identity.subject(id) on delete restrict,
  app_user_id     uuid not null,        -- NO FK. See comment above. Do not "fix" this.
  bound_at        timestamptz not null default now(),
  unbound_at      timestamptz,
  rebind_count    smallint not null default 0,
  constraint app_user_link_user_uniq unique (app_user_id)
);

comment on table identity.app_user_link is
  'SEALED. The subject <-> app_user binding. app_user_id intentionally has no FK to public.app_user: adding one would publish the relationship and create a cascade path between identity layers.';
comment on column identity.app_user_link.app_user_id is
  'Deliberately unconstrained uuid. Referential integrity is the verification service''s job. See docs/01-schema-notes.md.';

-- --------------------------------------------------------------------
-- 06.6 Legal requests and the access log
-- --------------------------------------------------------------------
create table identity.legal_request (
  id                   uuid primary key default util.uuid_v7(),
  case_ref             text not null unique,
  requesting_authority text not null,
  received_at          timestamptz not null,
  scope                text not null,
  legal_basis          text not null,
  approved_by          text,
  approved_at          timestamptz,
  rejected_at          timestamptz,
  executed_at          timestamptz,
  expires_at           timestamptz not null,
  notes                text,
  created_at           timestamptz not null default now(),
  constraint legal_request_decided_ck check (
    approved_at is null or rejected_at is null
  )
);

create table identity.access_log (
  id                uuid primary key default util.uuid_v7(),
  at                timestamptz not null default clock_timestamp(),
  db_role           text not null default current_user,
  actor_ref         text,                                    -- staff id / service instance
  purpose           identity.access_purpose not null,
  function_name     text not null,
  subject_id        uuid,
  app_user_id       uuid,
  legal_request_id  uuid references identity.legal_request(id),
  justification     text,
  session_ref       text
);
create index access_log_at_idx      on identity.access_log (at desc);
create index access_log_subject_idx on identity.access_log (subject_id, at desc);

-- Append-only. An auditor's log that can be edited is not a log.
create or replace function identity.tg_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'identity.% is append-only (attempted %)', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end$$;

create trigger access_log_append_only
  before update or delete on identity.access_log
  for each row execute function identity.tg_append_only();

-- --------------------------------------------------------------------
-- 06.7 The seal
-- --------------------------------------------------------------------
create or replace function identity.is_unsealed() returns boolean
language sql stable parallel safe as $$
  select coalesce(current_setting('kiksu.identity_unsealed', true), 'off') = 'on';
$$;

-- Opens the seal for the REMAINDER OF THE CURRENT TRANSACTION ONLY
-- (set_config with is_local = true). Logs before it opens, so an
-- unlogged read is not reachable through this path.
create or replace function identity.unseal(
  p_purpose          identity.access_purpose,
  p_function_name    text,
  p_justification    text,
  p_subject_id       uuid default null,
  p_legal_request_id uuid default null,
  p_actor_ref        text default null
) returns void
language plpgsql security definer set search_path = identity, pg_catalog, pg_temp as $$
begin
  if p_justification is null or length(btrim(p_justification)) < 8 then
    raise exception 'identity.unseal requires a justification' using errcode = 'insufficient_privilege';
  end if;

  -- Legal reads require an approved, unexpired request on file.
  if p_purpose = 'legal_request' then
    if p_legal_request_id is null then
      raise exception 'legal_request purpose requires a legal_request_id' using errcode = 'insufficient_privilege';
    end if;
    perform 1 from identity.legal_request lr
     where lr.id = p_legal_request_id
       and lr.approved_at is not null
       and lr.rejected_at is null
       and lr.expires_at > now();
    if not found then
      raise exception 'legal request % is not approved or has expired', p_legal_request_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into identity.access_log (purpose, function_name, subject_id, legal_request_id, justification, actor_ref)
  values (p_purpose, p_function_name, p_subject_id, p_legal_request_id, p_justification, p_actor_ref);

  perform set_config('kiksu.identity_unsealed', 'on', true);
end$$;

revoke all on function identity.unseal(identity.access_purpose, text, text, uuid, uuid, text) from public;

-- The ONLY sanctioned way to walk from a subject to a pseudonym.
-- Two log lines are written: the intent (by unseal) and the resolved
-- value. Both are INSERTs — the log is append-only, so the resolved
-- value cannot be back-filled by UPDATE.
create or replace function identity.resolve_app_user(
  p_subject_id       uuid,
  p_purpose          identity.access_purpose,
  p_justification    text,
  p_legal_request_id uuid default null,
  p_actor_ref        text default null
) returns uuid
language plpgsql security definer set search_path = identity, pg_catalog, pg_temp as $$
declare v_app_user uuid;
begin
  perform identity.unseal(p_purpose, 'resolve_app_user', p_justification, p_subject_id, p_legal_request_id, p_actor_ref);
  select l.app_user_id into v_app_user
    from identity.app_user_link l
   where l.subject_id = p_subject_id and l.unbound_at is null;
  insert into identity.access_log (purpose, function_name, subject_id, app_user_id, legal_request_id, justification, actor_ref)
  values (p_purpose, 'resolve_app_user:result', p_subject_id, v_app_user, p_legal_request_id, p_justification, p_actor_ref);
  return v_app_user;
end$$;

revoke all on function identity.resolve_app_user(uuid, identity.access_purpose, text, uuid, text) from public;

-- ... and the reverse direction, which is what a safety escalation needs.
create or replace function identity.resolve_subject(
  p_app_user_id      uuid,
  p_purpose          identity.access_purpose,
  p_justification    text,
  p_legal_request_id uuid default null,
  p_actor_ref        text default null
) returns uuid
language plpgsql security definer set search_path = identity, pg_catalog, pg_temp as $$
declare v_subject uuid;
begin
  perform identity.unseal(p_purpose, 'resolve_subject', p_justification, null, p_legal_request_id, p_actor_ref);
  select l.subject_id into v_subject
    from identity.app_user_link l
   where l.app_user_id = p_app_user_id and l.unbound_at is null;
  return v_subject;
end$$;

revoke all on function identity.resolve_subject(uuid, identity.access_purpose, text, uuid, text) from public;

-- --------------------------------------------------------------------
-- 06.8 Regression detector for the auth anchor rule
-- Counts auth accounts whose email is NOT the synthetic domain. Must be
-- zero. Wire this into the invariant test suite and to alerting.
-- --------------------------------------------------------------------
create or replace view identity.auth_email_leak_check as
  select count(*) filter (where u.email is not null
                            and u.email not like '%@users.kiksu.app') as identifying_emails,
         count(*)                                                     as total_accounts
  from auth.users u;

comment on view identity.auth_email_leak_check is
  'identifying_emails must be 0. A non-zero value means a university email reached auth.users, which makes app_user -> auth.users a name leak.';


-- =====================================================================
-- 07. PUBLIC.APP_USER — LAYER 2, the persistent pseudonym
--
-- This is what other students see. It carries a GENERATED handle, karma,
-- tier, trade reputation and a deliberately COARSE projection of a few
-- identity attributes.
--
-- The projection columns (university_id, display_faculty_id,
-- display_study_year) are the one sanctioned leak from layer 1 to layer
-- 2. They exist because the design requires them:
--   * board scoping and the campus feed need university_id;
--   * the seller card renders "BDU · İNFORMATİKA · 2-Cİ KURS";
--   * post badges render the tier.
-- They are WRITTEN BY the verification service (never by a join) and are
-- nulled by trigger whenever the cohort behind them is smaller than
-- ref.university.k_anon_min.
-- =====================================================================

create table public.app_user (
  id                        uuid primary key default gen_random_uuid(),

  -- Auth anchor. Safe ONLY because auth.users holds a synthetic address
  -- (see the auth anchor rule in section 06).
  auth_user_id              uuid not null references auth.users(id) on delete restrict,

  -- ---- pseudonym -------------------------------------------------
  handle                    text not null,                  -- 'sakit-pərvanə-37'
  handle_folded             text generated always as (util.fold_handle(handle)) stored,
  handle_number             smallint,                        -- the '37' shown in the avatar
  -- Avatar is DERIVED from the folded handle, never stored independently.
  -- A persistent random avatar would survive a handle change and therefore
  -- link the old handle to the new one — exactly what the 14-day rename is
  -- meant to prevent. Deriving it means the avatar rotates with the handle.
  avatar_id                 smallint generated always as
                              ((abs(hashtext(util.fold_handle(handle))) % 12)) stored,
  handle_changed_at         timestamptz not null default now(),
  -- NOT a generated column: `timestamptz + interval` is STABLE, not
  -- IMMUTABLE (the result depends on the session TimeZone across a DST
  -- boundary), and Postgres rejects it in a stored generation expression.
  -- Maintained by trg_app_user_handle_cooldown below instead.
  handle_change_allowed_at  timestamptz not null default (now() + interval '14 days'),

  -- ---- identity projection (coarse, k-anonymity gated) ------------
  verification_tier         public.verification_tier not null default 'unverified',
  card_review_state         identity.verification_state not null default 'none',  -- own-profile only
  university_id             uuid references ref.university(id) on delete restrict,
  display_faculty_id        uuid references ref.faculty(id) on delete set null,
  display_study_year        smallint check (display_study_year between 1 and 8),
  display_cohort_size       integer,                         -- audit trail for the k-anon decision
  projection_updated_at     timestamptz,

  -- ---- reputation -------------------------------------------------
  karma                     integer not null default 0,
  post_count                integer not null default 0,
  comment_count             integer not null default 0,
  review_count              integer not null default 0,

  -- marketplace reputation (design screen 08 + 10)
  trade_rating_sum          integer not null default 0,
  trade_rating_count        integer not null default 0,
  trade_rating_avg          numeric(3, 2) generated always as (
                              case when trade_rating_count = 0 then null
                                   else round(trade_rating_sum::numeric / trade_rating_count, 2) end
                            ) stored,
  deal_count                integer not null default 0,       -- '12 SÖVDƏLƏŞMƏ'
  response_rate_pct         smallint check (response_rate_pct between 0 and 100),
  response_time_median_sec  integer,                          -- '~2 saat'
  complaint_count           integer not null default 0,       -- '0 ŞİKAYƏT'

  -- ---- preferences ------------------------------------------------
  locale                    public.locale_code not null default 'az',
  feed_languages            public.locale_code[] not null default '{az}',

  -- privacy toggles, design screen 10 (defaults match the mockup)
  privacy_show_year         boolean not null default true,    -- 'Kursumu profildə göstər'
  privacy_share_timetable   boolean not null default false,   -- 'Cədvəlimi kursdaşlarla paylaş'
  privacy_show_uni_badge    boolean not null default true,    -- 'Postlarımda universitet nişanı'
  privacy_link_listings     boolean not null default false,   -- 'Bazar profilimə keçid'
  privacy_discoverable      boolean not null default false,   -- 'Axtarışda tapılım'

  -- ---- lifecycle ---------------------------------------------------
  status                    public.app_user_status not null default 'pending',
  suspended_until           timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  last_active_at            timestamptz,
  deactivated_at            timestamptz,

  constraint app_user_auth_uniq   unique (auth_user_id),
  constraint app_user_handle_uniq unique (handle),
  -- Folded uniqueness stops `sakit-pervane-37` impersonating
  -- `sakit-pərvanə-37`.
  constraint app_user_handle_folded_uniq unique (handle_folded),
  constraint app_user_tier_needs_uni check (
    verification_tier = 'unverified' or university_id is not null
  )
);

-- Keeps handle_change_allowed_at in lockstep with handle_changed_at.
-- This exists because the derivation cannot be a generated column; see the
-- comment on the column. The 14-day window is the design's stated rule
-- ("FORUM LƏQƏBİ · 14 GÜNDƏN BİR DƏYİŞİLİR", screen 10).
create or replace function public.sync_handle_cooldown() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.handle_changed_at is distinct from old.handle_changed_at then
    new.handle_change_allowed_at := new.handle_changed_at + interval '14 days';
  end if;
  return new;
end$$;

create trigger trg_app_user_handle_cooldown
  before insert or update of handle_changed_at on public.app_user
  for each row execute function public.sync_handle_cooldown();

create index app_user_university_idx on public.app_user (university_id) where status = 'active';
create index app_user_handle_trgm_idx on public.app_user using gin (handle_folded extensions.gin_trgm_ops)
  where privacy_discoverable;
create index app_user_active_idx on public.app_user (last_active_at desc) where status = 'active';

comment on table public.app_user is
  'LAYER 2. Everything here may be shown to other students. Nothing here may be derived by joining identity.* at read time — the projection columns are pushed by the verification service.';
comment on column public.app_user.display_faculty_id is
  'NULL unless the (university, faculty, year) cohort has at least ref.university.k_anon_min verified members. Enforced by trigger tg_app_user_k_anon.';

-- --------------------------------------------------------------------
-- 07.1 Cohort sizes — counts only, never identifiers
-- Pushed from identity by a periodic job. This is what lets the app
-- layer enforce k-anonymity without ever touching layer 1.
-- --------------------------------------------------------------------
create table public.cohort_size (
  university_id   uuid not null references ref.university(id) on delete cascade,
  faculty_id      uuid references ref.faculty(id) on delete cascade,
  program_id      uuid references ref.program(id) on delete cascade,
  study_year      smallint,
  verified_count  integer not null check (verified_count >= 0),
  computed_at     timestamptz not null default now(),
  -- A PRIMARY KEY cannot hold NULLs, and the roll-up rows (faculty-only,
  -- university-only) need them. UNIQUE ... NULLS NOT DISTINCT (PG15+) is
  -- what makes those roll-up rows addressable by a plain ON CONFLICT
  -- upsert instead of a coalesce-to-sentinel hack.
  constraint cohort_size_dims_uniq unique nulls not distinct
    (university_id, faculty_id, program_id, study_year)
);

comment on table public.cohort_size is
  'Aggregate counts pushed out of identity. Rows contain no identifiers. Small counts are still sensitive: never expose this table to clients.';

-- Trigger: refuse to publish an attribute combination that is below the
-- floor. Rather than rejecting the write (which would strand the user in
-- an unverified state) it coarsens the projection.
create or replace function public.tg_app_user_k_anon() returns trigger
language plpgsql as $$
declare
  v_min   integer;
  v_count integer;
begin
  if new.university_id is null then
    new.display_faculty_id := null;
    new.display_study_year := null;
    new.display_cohort_size := null;
    return new;
  end if;

  select u.k_anon_min into v_min from ref.university u where u.id = new.university_id;
  v_min := coalesce(v_min, 20);

  if new.display_faculty_id is not null then
    select cs.verified_count into v_count
      from public.cohort_size cs
     where cs.university_id = new.university_id
       and cs.faculty_id    is not distinct from new.display_faculty_id
       and cs.program_id    is null
       and cs.study_year    is not distinct from new.display_study_year;

    new.display_cohort_size := v_count;

    if v_count is null or v_count < v_min then
      -- Drop the finest dimension first (year), then the faculty.
      new.display_study_year := null;
      select cs.verified_count into v_count
        from public.cohort_size cs
       where cs.university_id = new.university_id
         and cs.faculty_id    is not distinct from new.display_faculty_id
         and cs.program_id    is null
         and cs.study_year    is null;
      new.display_cohort_size := v_count;
      if v_count is null or v_count < v_min then
        new.display_faculty_id := null;
      end if;
    end if;
  end if;

  -- The user's own privacy switch is applied on top of the floor.
  if not new.privacy_show_year then
    new.display_study_year := null;
  end if;

  return new;
end$$;

create trigger app_user_k_anon
  before insert or update of university_id, display_faculty_id, display_study_year, privacy_show_year
  on public.app_user
  for each row execute function public.tg_app_user_k_anon();

create trigger app_user_touch
  before update on public.app_user
  for each row execute function util.tg_touch_updated_at();

-- --------------------------------------------------------------------
-- 07.2 Session helpers used by every RLS policy
--
-- Always call these WRAPPED IN A SUBSELECT inside policies:
--     using (app_user_id = (select public.current_app_user_id()))
-- The subselect turns the call into an InitPlan evaluated once per
-- statement instead of once per row. This is the single biggest RLS
-- performance lever on Supabase.
-- --------------------------------------------------------------------
create or replace function public.current_app_user_id() returns uuid
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select au.id
    from public.app_user au
   where au.auth_user_id = auth.uid()
     and au.status in ('active', 'muted', 'pending');
$$;

create or replace function public.current_university_id() returns uuid
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select au.university_id
    from public.app_user au
   where au.auth_user_id = auth.uid();
$$;

create or replace function public.current_tier() returns public.verification_tier
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select coalesce((select au.verification_tier from public.app_user au where au.auth_user_id = auth.uid()),
                  'unverified'::public.verification_tier);
$$;

-- --------------------------------------------------------------------
-- 07.3 Handle history and reservations — INTERNAL
-- Handle history is a linkage table: old handle -> new handle lets an
-- observer follow a pseudonym across a rename. It therefore lives in
-- `internal`, not next to app_user.
-- --------------------------------------------------------------------
create table internal.handle_history (
  id              uuid primary key default util.uuid_v7(),
  app_user_id     uuid not null references public.app_user(id) on delete cascade,
  handle          text not null,
  handle_folded   text generated always as (util.fold_handle(handle)) stored,
  assigned_at     timestamptz not null default now(),
  released_at     timestamptz,
  release_reason  text
);
create index handle_history_user_idx   on internal.handle_history (app_user_id, assigned_at desc);
create index handle_history_folded_idx on internal.handle_history (handle_folded);

-- A released handle must not be immediately re-issued to someone else,
-- or the pseudonym becomes transferable. Cool-down is held here.
create table internal.handle_reservation (
  handle_folded   text primary key,
  reserved_until  timestamptz not null,
  reason          text not null check (reason in ('cooldown', 'blocklist', 'staff', 'pending_assignment')),
  created_at      timestamptz not null default now()
);
create index handle_reservation_expiry_idx on internal.handle_reservation (reserved_until);

-- --------------------------------------------------------------------
-- 07.4 Client-facing projection of app_user
-- The base table carries auth_user_id and the raw projection columns.
-- Clients read this view instead, which cannot expose the auth anchor.
-- security_invoker = on so the caller's RLS still applies.
-- --------------------------------------------------------------------
create view public.app_user_card
  with (security_invoker = on) as
  select au.id,
         au.handle,
         au.handle_number,
         au.verification_tier,
         case when au.privacy_show_uni_badge then au.university_id end       as university_id,
         case when au.privacy_show_uni_badge then au.display_faculty_id end  as display_faculty_id,
         case when au.privacy_show_uni_badge then au.display_study_year end  as display_study_year,
         au.karma,
         au.post_count,
         au.trade_rating_avg,
         au.trade_rating_count,
         au.deal_count,
         au.response_rate_pct,
         au.response_time_median_sec,
         au.complaint_count,
         au.privacy_link_listings,
         au.status,
         au.created_at
    from public.app_user au
   where au.status not in ('deactivated', 'erased');

comment on view public.app_user_card is
  'OWN PROFILE ONLY. security_invoker=on means app_user RLS applies, which is own-row, so this returns exactly one row: yours. Exact karma and created_at are safe here because they are your own. To read ANOTHER user, use public.public_profiles — never widen this view.';


-- =====================================================================
-- 08. ACADEMIC — enrollment, attendance, coursework, materials, grades
--
-- Enrollment is deliberately in `public` and not `internal`: the student
-- must be able to read their own timetable with a plain RLS-gated
-- SELECT, and the "share my timetable with classmates" toggle needs a
-- policy, not a service call.
--
-- BUT NOTE THE RISK, documented here because it constrains the review
-- feature: enrollment tells you who was in section X, and a review is
-- keyed to course x instructor x semester with a "DOĞRULANMIŞ" badge.
-- On a 6-person section those two facts together identify the reviewer.
-- Mitigation lives on public.review (verified_cohort_size).
-- =====================================================================

create table public.enrollment (
  id                 uuid primary key default gen_random_uuid(),
  app_user_id        uuid not null references public.app_user(id) on delete cascade,
  section_id         uuid not null references ref.course_section(id) on delete cascade,
  term_id            uuid not null references ref.term(id) on delete cascade,
  state              public.enrollment_state not null default 'enrolled',

  -- Design screen 03 colours each course block. The colour is the
  -- student's own choice, so it belongs on the enrollment.
  color              public.accent_color not null default 'turquoise',
  display_order      smallint,

  -- Attendance counter cache. absence_units is the weighted total
  -- (a 'late' contributes ref.absence_policy.late_counts_as), which is
  -- what the "4 / 12" ring actually renders.
  absence_count      integer not null default 0,
  absence_units      numeric(6, 2) not null default 0,
  absence_limit      integer,                                -- resolved snapshot, refreshed nightly
  absence_notified_at timestamptz,

  -- GPA support
  final_score        numeric(5, 2),
  final_letter       text,
  gpa_points         numeric(3, 2),

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint enrollment_uniq unique (app_user_id, section_id)
);

-- The week-timetable fetch is: "my enrolled sections in the current
-- term". This partial index is that query's whole access path.
create index enrollment_user_term_idx
  on public.enrollment (app_user_id, term_id)
  where state = 'enrolled';
create index enrollment_section_idx on public.enrollment (section_id) where state = 'enrolled';

create trigger enrollment_touch
  before update on public.enrollment
  for each row execute function util.tg_touch_updated_at();

-- --------------------------------------------------------------------
-- 08.1 Absence
-- Design screen 04: "Qayıb qeyd et" — self-reported by default, with
-- room for an official import or an instructor feed later.
-- --------------------------------------------------------------------
create table public.absence (
  id              uuid primary key default gen_random_uuid(),
  enrollment_id   uuid not null references public.enrollment(id) on delete cascade,
  meeting_id      uuid references ref.section_meeting(id) on delete set null,
  occurred_on     date not null,
  kind            public.absence_kind not null default 'absent',
  source          public.absence_source not null default 'self_reported',
  excuse_state    text check (excuse_state in ('none', 'requested', 'approved', 'rejected')) default 'none',
  excuse_note     text,
  created_at      timestamptz not null default now(),
  -- One record per class occurrence. NULLS NOT DISTINCT so that two
  -- "no specific meeting" entries on the same day still collide.
  constraint absence_occurrence_uniq unique nulls not distinct (enrollment_id, occurred_on, meeting_id)
);
create index absence_enrollment_idx on public.absence (enrollment_id, occurred_on desc);

-- --------------------------------------------------------------------
-- 08.2 Coursework / deadlines
-- Design screen 02: "SQL laboratoriya #4 · Verilənlər bazası · SABAH
-- 23:59" and "Aralıq imtahan · Diskret riyaziyyat · 27 OKT".
-- Deadlines can be official, crowdsourced by classmates, or personal.
-- --------------------------------------------------------------------
create table public.coursework (
  id                 uuid primary key default gen_random_uuid(),
  section_id         uuid not null references ref.course_section(id) on delete cascade,
  kind               public.coursework_kind not null default 'homework',
  title              text not null,                          -- 'SQL laboratoriya #4'
  description        text,
  due_at             timestamptz,
  weight_pct         numeric(5, 2) check (weight_pct >= 0 and weight_pct <= 100),
  origin             public.coursework_origin not null default 'crowdsourced',
  -- Crowdsourced items are attributable to a handle so they can be
  -- corrected and so vandalism has an owner. Personal items are private.
  created_by         uuid references public.app_user(id) on delete set null,
  confirm_count      integer not null default 0,
  dispute_count      integer not null default 0,
  is_verified        boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- "Yaxın son tarixlər": upcoming deadlines for my sections.
create index coursework_section_due_idx on public.coursework (section_id, due_at)
  where due_at is not null;

create table public.coursework_state (
  app_user_id     uuid not null references public.app_user(id) on delete cascade,
  coursework_id   uuid not null references public.coursework(id) on delete cascade,
  state           text not null default 'todo' check (state in ('todo', 'in_progress', 'done', 'skipped')),
  remind_at       timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (app_user_id, coursework_id)
);
create index coursework_state_remind_idx on public.coursework_state (remind_at)
  where remind_at is not null and state <> 'done';

-- --------------------------------------------------------------------
-- 08.3 Course materials — design screen 04, "Kurs materialları · 14 fayl"
-- Attribution is by HANDLE here (not alias): uploading notes is a
-- reputational act, and the design shows no anonymity affordance for it.
-- --------------------------------------------------------------------
create table public.course_material (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null references ref.course(id) on delete cascade,
  section_id         uuid references ref.course_section(id) on delete set null,
  uploader_id        uuid references public.app_user(id) on delete set null,
  title              text not null,
  kind               text not null default 'note'
                     check (kind in ('note', 'slide', 'past_exam', 'syllabus', 'solution', 'other')),
  storage_path       text not null,
  mime_type          text,
  byte_size          bigint check (byte_size >= 0),
  download_count     integer not null default 0,
  moderation_state   public.moderation_state not null default 'visible',
  copyright_flagged  boolean not null default false,
  created_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
create index course_material_course_idx on public.course_material (course_id, created_at desc)
  where deleted_at is null and moderation_state = 'visible';

comment on column public.course_material.copyright_flagged is
  'Past exams and scanned textbooks are the usual takedown target. Kept as a first-class flag so takedowns do not require a schema change.';


-- =====================================================================
-- 09. FORUM — boards, posts, comments, aliases, votes, polls
--
-- THE CENTRAL TRICK OF THIS SECTION:
-- public.post and public.post_comment carry NO author column. What they
-- carry is the rendered identity: author_alias_number ("ANONİM 5") and
-- author_tier (the ✓ / KART badge). Authorship lives in
-- internal.post_author / internal.comment_author.
--
-- Consequences, all of them intended:
--   * The feed renders without touching any table that knows who wrote
--     what. A read-only leak of `public` de-anonymises nobody.
--   * internal.thread_alias — the table that maps alias number to
--     app_user, i.e. the table that would unmask a whole thread — is
--     never on a read path at all. It is written once and read only by
--     the composer and by moderation.
--   * The tier badge is FROZEN AT WRITE TIME. A student who upgrades
--     from ✓ to KART does not retroactively re-badge their old posts.
--     This is deliberate: retroactive badges leak the upgrade event and
--     correlate a user's posts across threads.
-- =====================================================================

create table public.board (
  id                 uuid primary key default gen_random_uuid(),
  scope              public.board_scope not null default 'university',
  university_id      uuid references ref.university(id) on delete cascade,
  faculty_id         uuid references ref.faculty(id) on delete cascade,
  course_id          uuid references ref.course(id) on delete cascade,
  club_id            uuid,                                   -- FK added after public.club exists

  slug               text not null,
  name_az            text not null,                          -- 'Dərs və müəllim'
  name_ru            text,
  name_en            text,
  description_az     text,

  -- Boards carry a language. Content is NOT translated: the language
  -- attribute decides which FTS configuration the board's posts use and
  -- which users see the board in their feed (app_user.feed_languages).
  lang               public.locale_code not null default 'az',

  -- Posting gate. Some boards (e.g. dorm/rent) may require the card tier.
  min_tier_to_post   public.verification_tier not null default 'email_verified',
  min_tier_to_read   public.verification_tier not null default 'unverified',
  allows_poll        boolean not null default true,
  allows_image       boolean not null default true,

  -- counter caches (design: "BDU · 9 214 İZLƏYİCİ", "38 mövzu")
  follower_count     integer not null default 0,
  post_count         integer not null default 0,
  last_post_at       timestamptz,

  display_order      smallint not null default 0,
  is_default_follow  boolean not null default false,
  is_archived        boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint board_slug_uniq unique nulls not distinct (university_id, slug),
  -- Scope integrity: a scoped board must name its scope object.
  constraint board_scope_ck check (
    (scope = 'national'   and university_id is null) or
    (scope = 'university' and university_id is not null and faculty_id is null and course_id is null) or
    (scope = 'faculty'    and faculty_id is not null) or
    (scope = 'course'     and course_id  is not null) or
    (scope = 'club'       and club_id    is not null)
  )
);
create index board_university_idx on public.board (university_id, display_order) where not is_archived;
create index board_course_idx     on public.board (course_id) where course_id is not null;
create index board_lang_idx       on public.board (lang, university_id) where not is_archived;

create table public.board_follow (
  board_id       uuid not null references public.board(id) on delete cascade,
  app_user_id    uuid not null references public.app_user(id) on delete cascade,
  followed_at    timestamptz not null default now(),
  is_muted       boolean not null default false,
  primary key (board_id, app_user_id)
);
-- The home feed is "boards I follow", so the user-first index matters
-- more than the board-first one.
create index board_follow_user_idx on public.board_follow (app_user_id) where not is_muted;

-- --------------------------------------------------------------------
-- 09.1 Post
-- --------------------------------------------------------------------
create table public.post (
  id                    uuid primary key default gen_random_uuid(),
  board_id              uuid not null references public.board(id) on delete cascade,

  -- Denormalised from board so the campus feed does not join. Kept in
  -- sync by trigger; boards do not move between universities in practice.
  university_id         uuid references ref.university(id) on delete cascade,
  lang                  public.locale_code not null default 'az',

  kind                  public.post_kind not null default 'text',
  title                 text not null check (length(btrim(title)) > 0),
  body                  text,

  -- ---- rendered identity (NOT authorship) -------------------------
  author_display_mode   public.author_display_mode not null default 'alias',
  author_alias_number   integer check (author_alias_number >= 1),
  author_tier           public.verification_tier not null default 'unverified',
  -- Populated ONLY when the author chose to be identified (staff notice,
  -- club announcement). NULL for every anonymous post, which is the
  -- default and the design's only shown case.
  author_app_user_id    uuid references public.app_user(id) on delete set null,

  -- Alias allocation high-water mark for this thread. Incremented under
  -- the row lock taken by internal.allocate_thread_alias(), which is
  -- what makes concurrent first-comments race-free.
  alias_high_water      integer not null default 1,

  -- ---- counters ----------------------------------------------------
  upvote_count          integer not null default 0,
  downvote_count        integer not null default 0,
  score                 integer not null default 0,           -- '▲ 211'
  comment_count         integer not null default 0,           -- '▭ 62'
  save_count            integer not null default 0,           -- '◇ 18'
  view_count            integer not null default 0,
  attachment_count      smallint not null default 0,
  has_poll              boolean not null default false,
  hot_rank              double precision not null default 0,

  -- ---- state -------------------------------------------------------
  is_pinned             boolean not null default false,
  is_locked             boolean not null default false,
  moderation_state      public.moderation_state not null default 'visible',
  report_count          integer not null default 0,
  created_at            timestamptz not null default now(),
  edited_at             timestamptz,
  last_comment_at       timestamptz,
  deleted_at            timestamptz,

  search_vector         tsvector generated always as (util.tsv_ab(util.locale_text(lang), title, body)) stored,

  constraint post_alias_shape_ck check (
    (author_display_mode = 'alias'  and author_alias_number is not null and author_app_user_id is null) or
    (author_display_mode <> 'alias' and author_app_user_id is not null)
  )
);

comment on column public.post.author_app_user_id is
  'NULL for anonymous posts. Non-null ONLY when the author deliberately posted under their handle. Anonymous authorship is in internal.post_author.';
comment on column public.post.author_tier is
  'Frozen at write time on purpose. Re-badging old posts after a tier upgrade would leak the upgrade and correlate posts across threads.';

-- Board feed, POPULYAR tab + keyset pagination.
create index post_board_hot_idx on public.post (board_id, hot_rank desc, id desc)
  where deleted_at is null and moderation_state = 'visible';
-- Board feed, YENİ tab.
create index post_board_new_idx on public.post (board_id, created_at desc, id desc)
  where deleted_at is null and moderation_state = 'visible';
-- SORĞU tab.
create index post_board_poll_idx on public.post (board_id, created_at desc)
  where has_poll and deleted_at is null and moderation_state = 'visible';
-- CAVABSIZ tab.
create index post_board_unanswered_idx on public.post (board_id, created_at desc)
  where comment_count = 0 and deleted_at is null and moderation_state = 'visible';
-- "Kampus gündəmi": hot across every board of one university. hot_rank is
-- time-anchored, so ORDER BY hot_rank DESC LIMIT n terminates early and
-- no recency predicate is needed.
create index post_campus_hot_idx on public.post (university_id, hot_rank desc)
  where deleted_at is null and moderation_state = 'visible';
-- Pinned rows are few; a partial index keeps them out of the main scan.
create index post_pinned_idx on public.post (board_id, created_at desc)
  where is_pinned and deleted_at is null;
create index post_search_idx on public.post using gin (search_vector);

-- Authorship map. One row per anonymous post. Never granted to clients.
create table internal.post_author (
  post_id       uuid primary key references public.post(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete restrict,
  created_at    timestamptz not null default now()
);
create index post_author_user_idx on internal.post_author (app_user_id, created_at desc);

comment on table internal.post_author is
  'The unmasking table for posts. Read paths: "my posts", edit/delete authorisation, karma, moderation. Never a feed read.';

-- --------------------------------------------------------------------
-- 09.2 Thread aliases — LAYER 3
--
-- Scoped to one post, never reused across posts (guaranteed by the
-- composite key). Numbers are allocated from post.alias_high_water under
-- that row's lock, so two students commenting simultaneously cannot get
-- the same number.
--
-- The composer needs to show "ANONİM 5 KİMİ YAZ" BEFORE the write, so
-- allocation supports a reservation with a TTL.
--
-- RECLAIM RULE (reconciles identity-spec P3 with the concern below):
--   * An ordinal that was USED — i.e. it appears on committed content — is
--     never reused. Recycling one would let an observer infer a participant
--     left, and would make two people share one label in a cached client.
--     Those rows stay in this table forever, so they are never reclaimable.
--   * An ordinal that was RESERVED and expired WITHOUT ever being used was
--     never rendered to anyone, so reclaiming it is invisible and safe.
--
-- Reclaiming the second kind is required, not optional: identity-spec P3
-- ("the rendered sequence has no permanent gaps") is Absolute, because a
-- permanent gap is itself a privacy signal — it says someone opened the
-- composer and thought better of it. A thread whose last alias is 47 with
-- six posters would announce 41 people who nearly spoke.
-- --------------------------------------------------------------------
create table internal.thread_alias (
  post_id         uuid not null references public.post(id) on delete cascade,
  app_user_id     uuid not null references public.app_user(id) on delete cascade,
  alias_number    integer not null check (alias_number >= 1),
  is_op           boolean not null default false,
  state           public.alias_state not null default 'reserved',
  reserved_until  timestamptz,
  first_used_at   timestamptz,
  created_at      timestamptz not null default now(),
  primary key (post_id, app_user_id),
  constraint thread_alias_number_uniq unique (post_id, alias_number),
  constraint thread_alias_reservation_ck check (state <> 'reserved' or reserved_until is not null)
);
create index thread_alias_expiry_idx on internal.thread_alias (reserved_until)
  where state = 'reserved';

comment on table internal.thread_alias is
  'LAYER 3. Per-thread ordinals. USED numbers are never reused. Numbers from reservations that expired unused ARE reclaimed, because a permanent gap signals that someone opened the composer and did not post (identity-spec P3, Absolute).';

-- Allocate (or return the existing) alias for a participant in a thread.
-- Idempotent: calling it twice for the same (post, user) returns the same
-- number, which is what makes the composer preview honest.
create or replace function internal.allocate_thread_alias(
  p_post_id     uuid,
  p_app_user_id uuid,
  p_ttl         interval default interval '15 minutes',
  p_activate    boolean default false
) returns integer
language plpgsql security definer set search_path = internal, public, pg_catalog, pg_temp as $$
declare
  v_alias integer;
  v_high  integer;
begin
  select alias_number into v_alias
    from internal.thread_alias
   where post_id = p_post_id and app_user_id = p_app_user_id;

  if v_alias is null then
    -- Take the row lock BEFORE scanning for a reclaimable ordinal.
    -- Scanning first would let two concurrent allocators pick the same
    -- gap and collide on thread_alias_number_uniq. The lock is held to
    -- end of transaction, so the scan below is serialised.
    select alias_high_water into v_high
      from public.post
     where id = p_post_id
       for update;

    if v_high is null then
      raise exception 'post % does not exist', p_post_id using errcode = 'foreign_key_violation';
    end if;

    -- Smallest reclaimable ordinal: at or below the high-water mark and
    -- held by nobody. Only an expired-unused reservation can produce one,
    -- because used aliases never leave this table. See the RECLAIM RULE
    -- above; this is what keeps the rendered sequence gapless (P3).
    select g into v_alias
      from generate_series(1, v_high) g
     where not exists (
             select 1 from internal.thread_alias ta
              where ta.post_id = p_post_id and ta.alias_number = g)
     order by g
     limit 1;

    if v_alias is null then
      v_alias := v_high + 1;
      update public.post set alias_high_water = v_alias where id = p_post_id;
    end if;

    insert into internal.thread_alias (post_id, app_user_id, alias_number, state, reserved_until, first_used_at)
    values (p_post_id, p_app_user_id, v_alias,
            case when p_activate then 'active' else 'reserved' end::public.alias_state,
            case when p_activate then null else now() + p_ttl end,
            case when p_activate then now() end);
  elsif p_activate then
    update internal.thread_alias
       set state = 'active', reserved_until = null, first_used_at = coalesce(first_used_at, now())
     where post_id = p_post_id and app_user_id = p_app_user_id;
  else
    update internal.thread_alias
       set reserved_until = greatest(coalesce(reserved_until, now()), now() + p_ttl)
     where post_id = p_post_id and app_user_id = p_app_user_id and state = 'reserved';
  end if;

  return v_alias;
end$$;

comment on function internal.allocate_thread_alias(uuid, uuid, interval, boolean) is
  'Alias allocation storage primitive. The POLICY around it (who may post, rate limits, when a reservation is burned) belongs to the Identity Architect.';

-- --------------------------------------------------------------------
-- 09.3 Comments
-- Design screen 06 shows one level of nesting with a rail. `path` is the
-- materialised ancestor chain of per-thread sequence numbers, which
-- gives threaded ordering from a plain btree and no recursive CTE.
-- --------------------------------------------------------------------
create table public.post_comment (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null references public.post(id) on delete cascade,
  parent_id           uuid references public.post_comment(id) on delete cascade,

  seq_in_post         integer not null,                       -- monotonic per thread
  path                integer[] not null,                     -- ancestors' seq + own seq
  depth               smallint not null default 0 check (depth between 0 and 4),

  author_display_mode public.author_display_mode not null default 'alias',
  author_alias_number integer check (author_alias_number >= 1),
  author_tier         public.verification_tier not null default 'unverified',
  author_app_user_id  uuid references public.app_user(id) on delete set null,
  is_op               boolean not null default false,          -- 'MÜƏLLİF' badge

  body                text not null check (length(btrim(body)) > 0),
  upvote_count        integer not null default 0,
  downvote_count      integer not null default 0,
  score               integer not null default 0,
  reply_count         integer not null default 0,

  moderation_state    public.moderation_state not null default 'visible',
  report_count        integer not null default 0,
  created_at          timestamptz not null default now(),
  edited_at           timestamptz,
  deleted_at          timestamptz,

  constraint post_comment_seq_uniq unique (post_id, seq_in_post)
);
-- Threaded order: one index scan, already sorted.
create index post_comment_thread_idx on public.post_comment (post_id, path);
-- POPULYAR sort on the comment list.
create index post_comment_top_idx on public.post_comment (post_id, score desc, created_at)
  where parent_id is null and deleted_at is null;
create index post_comment_parent_idx on public.post_comment (parent_id) where parent_id is not null;

create table internal.comment_author (
  comment_id    uuid primary key references public.post_comment(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete restrict,
  created_at    timestamptz not null default now()
);
create index comment_author_user_idx on internal.comment_author (app_user_id, created_at desc);

-- --------------------------------------------------------------------
-- 09.4 Votes
-- These stay in `public` with an owner-only RLS policy, because the
-- client legitimately needs "did I already vote on this" for the visible
-- page and a round trip per post would be absurd. The policy makes a
-- cross-user read impossible; the tallies live on the parent row.
-- --------------------------------------------------------------------
create table public.post_vote (
  post_id       uuid not null references public.post(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  value         smallint not null check (value in (-1, 1)),
  created_at    timestamptz not null default now(),
  primary key (post_id, app_user_id)
);
create index post_vote_user_idx on public.post_vote (app_user_id, created_at desc);

create table public.comment_vote (
  comment_id    uuid not null references public.post_comment(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  value         smallint not null check (value in (-1, 1)),
  created_at    timestamptz not null default now(),
  primary key (comment_id, app_user_id)
);
create index comment_vote_user_idx on public.comment_vote (app_user_id, created_at desc);

-- --------------------------------------------------------------------
-- 09.5 Polls — design screen 05, "428 SƏS · 2 GÜN QALIB"
-- --------------------------------------------------------------------
create table public.poll (
  post_id           uuid primary key references public.post(id) on delete cascade,
  question          text,
  is_multi_choice   boolean not null default false,
  max_choices       smallint not null default 1 check (max_choices >= 1),
  closes_at         timestamptz,
  hide_results_until_vote boolean not null default false,
  total_votes       integer not null default 0,               -- distinct voters
  created_at        timestamptz not null default now()
);

create table public.poll_option (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.poll(post_id) on delete cascade,
  position      smallint not null,
  label         text not null,
  vote_count    integer not null default 0,
  constraint poll_option_position_uniq unique (post_id, position)
);
create index poll_option_poll_idx on public.poll_option (post_id, position);

create table public.poll_vote (
  post_id       uuid not null references public.poll(post_id) on delete cascade,
  option_id     uuid not null references public.poll_option(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (post_id, app_user_id, option_id)
);

-- --------------------------------------------------------------------
-- 09.6 Attachments and saves
-- --------------------------------------------------------------------
create table public.post_attachment (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.post(id) on delete cascade,
  position      smallint not null default 0,
  storage_path  text not null,
  mime_type     text,
  width         integer,
  height        integer,
  byte_size     bigint,
  blurhash      text,
  -- Screenshots of assignments are the common case (design screen 05).
  -- EXIF must be stripped on upload; recorded here so the guarantee is
  -- auditable rather than folkloric.
  exif_stripped boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint post_attachment_position_uniq unique (post_id, position)
);

create table public.post_save (
  post_id       uuid not null references public.post(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (post_id, app_user_id)
);
create index post_save_user_idx on public.post_save (app_user_id, created_at desc);

-- --------------------------------------------------------------------
-- 09.7 View counting without a user column
-- Writing (post_id, app_user_id, viewed_at) would build a reading-history
-- table — a far better de-anonymisation dataset than the posts
-- themselves. We aggregate deltas with no subject instead, and fold them
-- into post.view_count on a schedule.
-- --------------------------------------------------------------------
create table internal.view_delta (
  id            bigint generated always as identity primary key,
  post_id       uuid not null references public.post(id) on delete cascade,
  delta         integer not null check (delta > 0),
  bucket_hour   timestamptz not null default date_trunc('hour', now()),
  constraint view_delta_bucket_uniq unique (post_id, bucket_hour)
);

comment on table internal.view_delta is
  'Deliberately subject-free. Never add app_user_id here: that would create a per-user reading history.';


-- =====================================================================
-- 10. REVIEWS — course x instructor x semester
--
-- Fixed criterion COLUMNS, not EAV. The four axes are a product decision
-- baked into the UI (screen 07 renders exactly four labelled bars), so
-- they are typed columns with CHECK ranges. Adding a fifth axis is a
-- migration, and that is correct: it is a product change, and columns
-- give us cheap SUM/COUNT aggregates that EAV would not.
--
-- Tag vocabulary is an array of ref.review_tag keys with a validation
-- trigger + GIN index — flexible where flexibility is actually needed.
-- =====================================================================

create table public.review (
  id                    uuid primary key default gen_random_uuid(),

  -- The key. All three parts are required: a review of a professor that
  -- does not say which course and which semester is not actionable, and
  -- the design shows "2024/25 YAZ · CS 214" on every review card.
  university_id         uuid not null references ref.university(id) on delete cascade,
  course_id             uuid not null references ref.course(id) on delete cascade,
  instructor_id         uuid not null references ref.instructor(id) on delete cascade,
  term_id               uuid not null references ref.term(id) on delete cascade,

  overall_rating        smallint not null check (overall_rating between 1 and 5),
  quality               smallint not null check (quality between 1 and 5),               -- Dərs keyfiyyəti
  fairness              smallint not null check (fairness between 1 and 5),              -- Ədalətli qiymət
  workload              smallint not null check (workload between 1 and 5),              -- İş yükü
  attendance_strictness smallint not null check (attendance_strictness between 1 and 5), -- Davamiyyət tələbi

  tag_keys              text[] not null default '{}',
  body                  text,
  lang                  public.locale_code not null default 'az',

  -- 'ANONİM · DOĞRULANMIŞ' badge. True only when the author's enrollment
  -- in this section could be confirmed.
  is_enrollment_verified boolean not null default false,
  -- ...and only rendered when the cohort was large enough that the badge
  -- does not identify the author. On a 6-person section, an enrolled
  -- verified reviewer IS identifiable; this column is the gate.
  verified_cohort_size  integer,

  helpful_count         integer not null default 0,
  report_count          integer not null default 0,
  moderation_state      public.moderation_state not null default 'visible',
  created_at            timestamptz not null default now(),
  edited_at             timestamptz,
  deleted_at            timestamptz,

  search_vector         tsvector generated always as (util.tsv_ab(util.locale_text(lang), body, null)) stored
);

-- Instructor profile page: written reviews, newest first, optionally
-- filtered by course ("FƏNN: CS 214 ▾").
create index review_instructor_idx on public.review (instructor_id, created_at desc)
  where deleted_at is null and moderation_state = 'visible';
create index review_instructor_course_idx on public.review (instructor_id, course_id, created_at desc)
  where deleted_at is null and moderation_state = 'visible';
create index review_course_idx on public.review (course_id, created_at desc)
  where deleted_at is null and moderation_state = 'visible';
create index review_term_idx on public.review (term_id);
create index review_tags_idx on public.review using gin (tag_keys);
create index review_search_idx on public.review using gin (search_vector);

comment on column public.review.verified_cohort_size is
  'Section size at write time. Render the DOĞRULANMIŞ badge only when this is at least ref.university.k_anon_min; otherwise the badge itself is the leak.';

-- Tag validation: keys must exist in the vocabulary and be applicable.
create or replace function public.tg_review_tags_valid() returns trigger
language plpgsql as $$
declare v_bad text;
begin
  if array_length(new.tag_keys, 1) > 8 then
    raise exception 'at most 8 tags per review';
  end if;
  select t into v_bad
    from unnest(new.tag_keys) as t
   where not exists (
     select 1 from ref.review_tag rt
      where rt.key = t and rt.is_active and rt.applies_to in ('both', 'instructor', 'course')
   )
   limit 1;
  if v_bad is not null then
    raise exception 'unknown or inactive review tag: %', v_bad using errcode = 'foreign_key_violation';
  end if;
  return new;
end$$;

create trigger review_tags_valid
  before insert or update of tag_keys on public.review
  for each row execute function public.tg_review_tags_valid();

-- --------------------------------------------------------------------
-- 10.1 Review authorship — INTERNAL, and it carries the uniqueness key
--
-- "One review per student per course x instructor x semester" has to be
-- enforced somewhere, and the author column is in `internal`. So the
-- constraint lives here, which means the three key columns are
-- duplicated onto this row. That denormalisation is the price of keeping
-- authorship out of `public`; a trigger keeps the copy honest.
-- --------------------------------------------------------------------
create table internal.review_author (
  review_id      uuid primary key references public.review(id) on delete cascade,
  app_user_id    uuid not null references public.app_user(id) on delete restrict,
  course_id      uuid not null,
  instructor_id  uuid not null,
  term_id        uuid not null,
  created_at     timestamptz not null default now(),
  constraint review_author_one_per_key unique (app_user_id, course_id, instructor_id, term_id)
);
create index review_author_user_idx on internal.review_author (app_user_id, created_at desc);

comment on constraint review_author_one_per_key on internal.review_author is
  'Invariant: one review per student per course x instructor x semester. Cannot live on public.review because public.review has no author column.';

-- --------------------------------------------------------------------
-- 10.2 Aggregates
--
-- Stored as integer SUMS and COUNTS with the averages as GENERATED
-- columns. Sums are exactly maintainable by an incremental trigger;
-- rolling averages are not (floating drift, and no way to undo an edit).
-- Design screen 07 renders: 4.2 overall, "61 RƏY · 3 FƏNN", a 1..5
-- histogram, four criterion averages, and the top tags.
-- --------------------------------------------------------------------
create table public.instructor_review_summary (
  instructor_id         uuid primary key references ref.instructor(id) on delete cascade,
  review_count          integer not null default 0,
  course_count          integer not null default 0,           -- '3 FƏNN'
  rating_sum            integer not null default 0,
  rating_avg            numeric(3, 2) generated always as (
                          case when review_count = 0 then null
                               else round(rating_sum::numeric / review_count, 2) end) stored,
  star_1                integer not null default 0,
  star_2                integer not null default 0,
  star_3                integer not null default 0,
  star_4                integer not null default 0,
  star_5                integer not null default 0,
  quality_sum           integer not null default 0,
  fairness_sum          integer not null default 0,
  workload_sum          integer not null default 0,
  attendance_sum        integer not null default 0,
  quality_avg           numeric(3, 2) generated always as (
                          case when review_count = 0 then null
                               else round(quality_sum::numeric / review_count, 2) end) stored,
  fairness_avg          numeric(3, 2) generated always as (
                          case when review_count = 0 then null
                               else round(fairness_sum::numeric / review_count, 2) end) stored,
  workload_avg          numeric(3, 2) generated always as (
                          case when review_count = 0 then null
                               else round(workload_sum::numeric / review_count, 2) end) stored,
  attendance_avg        numeric(3, 2) generated always as (
                          case when review_count = 0 then null
                               else round(attendance_sum::numeric / review_count, 2) end) stored,
  -- [{key, count}] ordered desc. Recomputed periodically, not per write.
  top_tags              jsonb not null default '[]'::jsonb,
  updated_at            timestamptz not null default now()
);
create index instructor_review_summary_rank_idx on public.instructor_review_summary (rating_avg desc nulls last)
  where review_count >= 5;

create table public.course_review_summary (
  course_id             uuid primary key references ref.course(id) on delete cascade,
  review_count          integer not null default 0,
  rating_sum            integer not null default 0,
  rating_avg            numeric(3, 2) generated always as (
                          case when review_count = 0 then null
                               else round(rating_sum::numeric / review_count, 2) end) stored,
  quality_sum           integer not null default 0,
  fairness_sum          integer not null default 0,
  workload_sum          integer not null default 0,
  attendance_sum        integer not null default 0,
  top_tags              jsonb not null default '[]'::jsonb,
  updated_at            timestamptz not null default now()
);

-- The pair summary is what the class-detail sheet shows ("4.2 ★" next to
-- the instructor for THIS course) and what the review list filter uses.
create table public.course_instructor_review_summary (
  course_id             uuid not null references ref.course(id) on delete cascade,
  instructor_id         uuid not null references ref.instructor(id) on delete cascade,
  review_count          integer not null default 0,
  rating_sum            integer not null default 0,
  rating_avg            numeric(3, 2) generated always as (
                          case when review_count = 0 then null
                               else round(rating_sum::numeric / review_count, 2) end) stored,
  quality_sum           integer not null default 0,
  fairness_sum          integer not null default 0,
  workload_sum          integer not null default 0,
  attendance_sum        integer not null default 0,
  updated_at            timestamptz not null default now(),
  primary key (course_id, instructor_id)
);
create index course_instructor_summary_instructor_idx
  on public.course_instructor_review_summary (instructor_id, rating_avg desc nulls last);

-- Helpful votes on a review (owner-only RLS, same reasoning as post_vote).
create table public.review_helpful (
  review_id     uuid not null references public.review(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (review_id, app_user_id)
);


-- =====================================================================
-- 11. MARKETPLACE — listings, deals, trade ratings, chat
--
-- Unlike the forum, the marketplace is pseudonymous BY HANDLE, not by
-- alias: the design shows "quru-püstə-19" with a ✓, a rating and a deal
-- count. That is intentional — trade reputation requires a persistent
-- identity. So listing.seller_id is a plain, public FK to app_user.
-- =====================================================================

create table public.listing (
  id                 uuid primary key default gen_random_uuid(),
  seller_id          uuid not null references public.app_user(id) on delete cascade,
  university_id      uuid not null references ref.university(id) on delete cascade,
  category_id        uuid not null references ref.marketplace_category(id) on delete restrict,
  related_course_id  uuid references ref.course(id) on delete set null,   -- "the CS 214 textbook"

  title              text not null check (length(btrim(title)) > 0),
  description        text,
  lang               public.locale_code not null default 'az',

  price_minor        integer not null check (price_minor >= 0),           -- qəpik; 25 ₼ = 2500
  currency           char(3) not null default 'AZN' check (currency ~ '^[A-Z]{3}$'),
  is_negotiable      boolean not null default false,                      -- 'RAZILAŞMA OLAR'
  condition          public.listing_condition not null default 'good',    -- 'VƏZİYYƏT: YAXŞI'

  -- Category-specific chips ("QEYDLƏR VAR", "2 KİTAB"). Shape is governed
  -- by ref.marketplace_category.attribute_schema.
  attributes         jsonb not null default '{}'::jsonb,

  -- Free-text handover points ("Baş korpusun qarşısında", "Elmlər
  -- Akademiyası metrosu"). Array, not a geo type: students name
  -- landmarks, not coordinates, and storing coordinates for a meetup is
  -- a safety liability we do not want.
  meetup_notes       text[] not null default '{}',

  status             public.listing_status not null default 'active',
  view_count         integer not null default 0,
  save_count         integer not null default 0,
  chat_count         integer not null default 0,
  image_count        smallint not null default 0,

  published_at       timestamptz not null default now(),
  bumped_at          timestamptz not null default now(),
  expires_at         timestamptz,
  sold_at            timestamptz,
  moderation_state   public.moderation_state not null default 'visible',
  report_count       integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  search_vector      tsvector generated always as (util.tsv_ab(util.locale_text(lang), title, description)) stored
);

-- Browse: university + active + category, newest bump first.
create index listing_browse_idx on public.listing (university_id, category_id, bumped_at desc)
  where status = 'active' and deleted_at is null and moderation_state = 'visible';
-- Browse with a price sort / price range filter.
create index listing_price_idx on public.listing (university_id, category_id, price_minor)
  where status = 'active' and deleted_at is null;
-- Attribute filters ("has notes", "2 volumes").
create index listing_attributes_idx on public.listing using gin (attributes jsonb_path_ops);
create index listing_search_idx     on public.listing using gin (search_vector);
create index listing_seller_idx     on public.listing (seller_id, published_at desc) where deleted_at is null;
create index listing_course_idx     on public.listing (related_course_id) where related_course_id is not null;

create table public.listing_image (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listing(id) on delete cascade,
  position      smallint not null default 0,
  storage_path  text not null,
  width         integer,
  height        integer,
  byte_size     bigint,
  blurhash      text,
  exif_stripped boolean not null default false,
  constraint listing_image_position_uniq unique (listing_id, position)
);

create table public.listing_save (
  listing_id    uuid not null references public.listing(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (listing_id, app_user_id)
);
create index listing_save_user_idx on public.listing_save (app_user_id, created_at desc);

-- --------------------------------------------------------------------
-- 11.1 Deals and trade ratings — the source of "12 SÖVDƏLƏŞMƏ" and "4.8"
-- --------------------------------------------------------------------
create table public.deal (
  id                 uuid primary key default gen_random_uuid(),
  listing_id         uuid not null references public.listing(id) on delete restrict,
  seller_id          uuid not null references public.app_user(id) on delete restrict,
  buyer_id           uuid not null references public.app_user(id) on delete restrict,
  state              public.deal_state not null default 'inquiry',
  agreed_price_minor integer check (agreed_price_minor >= 0),
  currency           char(3) not null default 'AZN',
  agreed_at          timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  cancel_reason      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint deal_parties_differ check (seller_id <> buyer_id),
  -- One live deal per (listing, buyer); a re-inquiry reuses the row.
  constraint deal_listing_buyer_uniq unique (listing_id, buyer_id)
);
create index deal_seller_idx on public.deal (seller_id, completed_at desc) where state = 'completed';
create index deal_buyer_idx  on public.deal (buyer_id, created_at desc);

create table public.trade_rating (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid not null references public.deal(id) on delete cascade,
  rater_id      uuid not null references public.app_user(id) on delete cascade,
  ratee_id      uuid not null references public.app_user(id) on delete cascade,
  rater_role    text not null check (rater_role in ('buyer', 'seller')),
  score         smallint not null check (score between 1 and 5),
  comment       text,
  created_at    timestamptz not null default now(),
  constraint trade_rating_once unique (deal_id, rater_id),
  constraint trade_rating_parties_differ check (rater_id <> ratee_id)
);
create index trade_rating_ratee_idx on public.trade_rating (ratee_id, created_at desc);

-- --------------------------------------------------------------------
-- 11.2 Chat — "Satıcıya yaz"
-- --------------------------------------------------------------------
create table public.conversation (
  id                 uuid primary key default gen_random_uuid(),
  kind               public.conversation_kind not null default 'listing',
  listing_id         uuid references public.listing(id) on delete set null,
  deal_id            uuid references public.deal(id) on delete set null,
  created_by         uuid not null references public.app_user(id) on delete cascade,
  created_at         timestamptz not null default now(),
  last_message_at    timestamptz,
  message_count      integer not null default 0,
  is_closed          boolean not null default false,
  constraint conversation_listing_ck check (kind <> 'listing' or listing_id is not null)
);
create index conversation_listing_idx on public.conversation (listing_id) where listing_id is not null;

create table public.conversation_participant (
  conversation_id  uuid not null references public.conversation(id) on delete cascade,
  app_user_id      uuid not null references public.app_user(id) on delete cascade,
  role             text not null default 'member' check (role in ('seller', 'buyer', 'member')),
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz,
  unread_count     integer not null default 0,
  is_muted         boolean not null default false,
  left_at          timestamptz,
  primary key (conversation_id, app_user_id)
);
-- Inbox: my conversations, most recent first. The ordering column lives
-- on `conversation`, so the inbox query is participant -> conversation;
-- this index serves the participant lookup.
create index conversation_participant_user_idx
  on public.conversation_participant (app_user_id) where left_at is null;

create table public.chat_message (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversation(id) on delete cascade,
  sender_id        uuid not null references public.app_user(id) on delete cascade,
  kind             public.chat_message_kind not null default 'text',
  body             text,
  storage_path     text,
  offer_price_minor integer,
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  deleted_at       timestamptz,
  moderation_state public.moderation_state not null default 'visible',
  -- An offer carries only a price and no body: the client renders
  -- "20 ₼ təklif edildi" from the number. Requiring a duplicated body would
  -- put the price in two places that can disagree.
  constraint chat_message_content_ck check (
    body is not null or storage_path is not null or kind = 'system'
    or (kind = 'offer' and offer_price_minor is not null)
  ),
  -- And the other direction: an offer with no price renders as an empty bubble.
  constraint chat_message_offer_ck check (kind <> 'offer' or offer_price_minor is not null)
);
-- Message pagination is always "newest N in this conversation".
create index chat_message_conversation_idx on public.chat_message (conversation_id, created_at desc);

-- --------------------------------------------------------------------
-- 11.3 Seller responsiveness — "100% CAVAB", "~2 saat CAVAB VAXTI"
--
-- A median is not incrementally maintainable, and response rate needs a
-- rolling window (a seller who was responsive last year should not coast
-- on it). Both are therefore RECOMPUTED on a schedule from this table,
-- which the chat trigger keeps up to date with the raw facts.
-- --------------------------------------------------------------------
create table internal.seller_inquiry (
  conversation_id     uuid primary key references public.conversation(id) on delete cascade,
  seller_id           uuid not null references public.app_user(id) on delete cascade,
  first_inquiry_at    timestamptz not null,
  first_response_at   timestamptz,
  response_seconds    integer generated always as (
                        case when first_response_at is null then null
                             else greatest(0, extract(epoch from (first_response_at - first_inquiry_at))::integer) end
                      ) stored
);
create index seller_inquiry_seller_idx on internal.seller_inquiry (seller_id, first_inquiry_at desc);


-- =====================================================================
-- 12. VACANCIES AND EMPLOYERS (public side)
-- The vacancy feed is public content. The APPLICATION is not — it lives
-- in the career silo (section 13).
-- =====================================================================

create table public.employer (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  name               text not null,                          -- 'Azercell', 'Kapital Bank'
  sector_id          uuid references ref.sector(id) on delete set null,
  logo_initials      text,                                   -- 'AZC', 'KB', 'PB'
  brand_color        text check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_storage_path  text,
  website            text,
  city               text,
  description        text,
  is_verified        boolean not null default false,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  name_folded        text generated always as (util.fold_text(name)) stored
);
create index employer_name_trgm_idx on public.employer using gin (name_folded extensions.gin_trgm_ops);

-- Recruiter accounts are NOT anonymous and are NOT students. An auth
-- account is either an app_user or a recruiter, never both — see the
-- guard trigger in section 18.
create table public.employer_recruiter (
  id            uuid primary key default gen_random_uuid(),
  employer_id   uuid not null references public.employer(id) on delete cascade,
  auth_user_id  uuid not null references auth.users(id) on delete cascade,
  full_name     text not null,
  job_title     text,
  role          text not null default 'member' check (role in ('owner', 'member')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint employer_recruiter_auth_uniq unique (auth_user_id)
);

create table public.vacancy (
  id                   uuid primary key default gen_random_uuid(),
  employer_id          uuid not null references public.employer(id) on delete cascade,
  posted_by            uuid references public.employer_recruiter(id) on delete set null,

  title                text not null,                        -- 'Frontend təcrübəçi (React)'
  description          text,
  lang                 public.locale_code not null default 'az',
  kind                 public.vacancy_kind not null default 'internship',
  work_mode            public.work_mode not null default 'onsite',
  city                 text,                                 -- 'Bakı', 'Sumqayıt'
  sector_id            uuid references ref.sector(id) on delete set null,

  -- Every chip on the design card is a queryable column, not free text.
  is_paid              boolean not null default false,       -- 'ÖDƏNİŞLİ'
  stipend_minor        integer check (stipend_minor >= 0),   -- '700 ₼'
  currency             char(3) not null default 'AZN',
  duration_months      smallint check (duration_months > 0), -- '6 AY'
  hours_per_week       smallint check (hours_per_week > 0),  -- '20 SAAT / HƏFTƏ'
  min_study_year       smallint check (min_study_year between 1 and 8),  -- '3–4-CÜ KURS'
  max_study_year       smallint check (max_study_year between 1 and 8),
  required_skills      text[] not null default '{}',         -- 'SQL · PYTHON'
  perks                text[] not null default '{}',         -- transport, conversion, flexible schedule
  schedule_friendly    boolean not null default false,       -- 'CƏDVƏLƏ UYĞUN'
  conversion_possible  boolean not null default false,       -- 'İŞƏ KEÇİD İMKANI'
  transport_provided   boolean not null default false,       -- 'NƏQLİYYAT VAR'

  -- Which universities may see it (empty = all).
  target_university_ids uuid[] not null default '{}',

  apply_via            text not null default 'kiksu' check (apply_via in ('kiksu', 'external')),
  external_url         text,
  apply_deadline       date,                                 -- powers the '3 GÜN' countdown chip
  status               public.vacancy_status not null default 'active',
  view_count           integer not null default 0,
  application_count    integer not null default 0,
  posted_at            timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  closed_at            timestamptz,

  search_vector        tsvector generated always as (util.tsv_ab(util.locale_text(lang), title, description)) stored,
  constraint vacancy_year_range_ck check (max_study_year is null or min_study_year is null or max_study_year >= min_study_year),
  constraint vacancy_apply_ck check (apply_via <> 'external' or external_url is not null)
);

-- Feed: active, in my city, of a chosen kind, newest first.
create index vacancy_feed_idx on public.vacancy (city, kind, posted_at desc)
  where status = 'active';
-- Deadline chip + expiry sweeper.
create index vacancy_deadline_idx on public.vacancy (apply_deadline)
  where status = 'active' and apply_deadline is not null;
create index vacancy_skills_idx     on public.vacancy using gin (required_skills);
create index vacancy_university_idx on public.vacancy using gin (target_university_ids);
create index vacancy_search_idx     on public.vacancy using gin (search_vector);
create index vacancy_employer_idx   on public.vacancy (employer_id, posted_at desc);

create table public.vacancy_save (
  vacancy_id    uuid not null references public.vacancy(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (vacancy_id, app_user_id)
);
create index vacancy_save_user_idx on public.vacancy_save (app_user_id, created_at desc);


-- =====================================================================
-- 13. CAREER — LAYER 4, THE SILO
--
-- Design screen 09: "Müraciət yalnız karyera kimliyi ilə göndərilir —
-- forum ləqəbin işəgötürənə görünmür."
-- Design screen 10: "Aysel Rəhimova · CV yüklənib · GİZLİ".
--
-- HOW THE SILO IS ACTUALLY CLOSED
-- career.career_profile is addressed by subject_key:
--     HMAC-SHA256(pepper_career, 'kiksu:career:v1' || auth_uid)
-- The career service computes it from the caller's session. The database
-- cannot: the pepper is not in the database (not even in Vault, which is
-- in-database). So no SQL statement can produce the join, no view can be
-- built, and no ORM can be persuaded to traverse it.
--
-- CRITICAL: pepper_career MUST NOT equal pepper_identity, and the domain
-- separation string must differ. If both silos used the same key, then
--     career.career_profile JOIN identity.subject USING (subject_key)
-- would fuse layer 1 and layer 4 in a single line of SQL. That mistake
-- is the most likely way this design fails in practice.
--
-- What the database still enforces on top of that:
--   * no FK from career.* into public.app_user or internal.* (event
--     trigger, section 18);
--   * no column in the career schema whose name resembles a user pointer
--     (same event trigger);
--   * no grants to anon / authenticated / service_role.
-- =====================================================================

create table career.career_profile (
  id                    uuid primary key default gen_random_uuid(),
  subject_key           bytea not null,
  key_version           smallint not null default 1,

  -- Real identity. Encrypted by the career service with an envelope key
  -- from an external KMS; the database holds bytes it cannot read.
  legal_name_ct         bytea not null,
  legal_name_kid        text not null,
  contact_email_ct      bytea,
  contact_phone_ct      bytea,

  -- Blind index for staff de-duplication ("is this the same person who
  -- applied last year?") without decrypting: HMAC of the normalised
  -- surname under yet another key.
  surname_bidx          bytea,

  -- Career-facing academic facts. These are RESTATED by the student, not
  -- copied from identity.verified_identity — a copy would be a covert
  -- channel between two layers that must not communicate.
  university_id         uuid references ref.university(id) on delete set null,
  faculty_id            uuid references ref.faculty(id) on delete set null,
  program_name          text,
  entry_year            smallint,
  graduation_year       smallint,
  headline              text,
  locale                public.locale_code not null default 'az',

  visibility            text not null default 'private'
                        check (visibility in ('private', 'open_to_offers')),
  cv_document_id        uuid,                                 -- FK added below
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  constraint career_profile_subject_uniq unique (subject_key),
  constraint career_profile_key_len check (octet_length(subject_key) = 32)
);

comment on column career.career_profile.subject_key is
  'HMAC(auth uid) under pepper_career. MUST use a different pepper AND a different domain string from identity.subject.subject_key, otherwise the two silos join on equality.';

create table career.career_document (
  id                 uuid primary key default gen_random_uuid(),
  career_profile_id  uuid not null references career.career_profile(id) on delete cascade,
  kind               career.document_kind not null default 'cv',
  storage_path       text not null,                          -- private bucket, signed URLs only
  filename_ct        bytea,
  mime_type          text,
  byte_size          bigint,
  uploaded_at        timestamptz not null default now(),
  deleted_at         timestamptz
);
create index career_document_profile_idx on career.career_document (career_profile_id);

alter table career.career_profile
  add constraint career_profile_cv_fk
  foreign key (cv_document_id) references career.career_document(id) on delete set null;

create table career.application (
  id                 uuid primary key default gen_random_uuid(),
  career_profile_id  uuid not null references career.career_profile(id) on delete cascade,
  -- FK to a NON-identity public table. Permitted by the guard: a vacancy
  -- is company data, not user data.
  vacancy_id         uuid not null,
  employer_id        uuid not null,
  state              career.application_state not null default 'submitted',
  cover_letter_ct    bytea,
  cv_document_id     uuid references career.career_document(id) on delete set null,
  submitted_at       timestamptz not null default now(),
  employer_viewed_at timestamptz,
  decided_at         timestamptz,
  withdrawn_at       timestamptz,
  constraint application_once unique (career_profile_id, vacancy_id)
);
create index application_vacancy_idx on career.application (vacancy_id, submitted_at desc);
create index application_profile_idx on career.application (career_profile_id, submitted_at desc);

comment on column career.application.vacancy_id is
  'Plain uuid: public.vacancy lives in a schema the guard forbids career from referencing. Integrity is maintained by the career service. Trade-off documented in 01-schema-notes.md.';

create table career.application_event (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references career.application(id) on delete cascade,
  state          career.application_state not null,
  actor          text not null check (actor in ('applicant', 'employer', 'system')),
  note           text,
  occurred_at    timestamptz not null default now()
);
create index application_event_app_idx on career.application_event (application_id, occurred_at);


-- =====================================================================
-- 14. EVENTS AND CLUBS
-- Design screen 02: "Karyera günü — IT şirkətləri · 24 OKT · 10:00 ·
-- AKT MƏRKƏZİ · 412 İŞTİRAKÇI".
-- =====================================================================

create table public.club (
  id                 uuid primary key default gen_random_uuid(),
  university_id      uuid not null references ref.university(id) on delete cascade,
  slug               text not null,
  name               text not null,
  category           text,
  description        text,
  logo_storage_path  text,
  owner_id           uuid references public.app_user(id) on delete set null,
  member_count       integer not null default 0,
  is_verified        boolean not null default false,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  constraint club_slug_uniq unique (university_id, slug)
);

create table public.club_member (
  club_id       uuid not null references public.club(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  role          public.club_member_role not null default 'member',
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  primary key (club_id, app_user_id)
);
create index club_member_user_idx on public.club_member (app_user_id) where left_at is null;

-- Deferred FK from board to club (board is created earlier in the file).
alter table public.board
  add constraint board_club_fk foreign key (club_id) references public.club(id) on delete cascade;

create table public.campus_event (
  id                 uuid primary key default gen_random_uuid(),
  university_id      uuid references ref.university(id) on delete cascade,
  club_id            uuid references public.club(id) on delete set null,
  employer_id        uuid references public.employer(id) on delete set null,
  kind               public.event_kind not null default 'other',
  title              text not null,
  description        text,
  lang               public.locale_code not null default 'az',

  starts_at          timestamptz not null,
  ends_at            timestamptz,
  venue_name         text,                                   -- 'AKT Mərkəzi'
  room_id            uuid references ref.room(id) on delete set null,
  address            text,
  is_online          boolean not null default false,
  join_url           text,

  capacity           integer check (capacity > 0),
  attendee_count     integer not null default 0,             -- '412 İŞTİRAKÇI'
  cover_storage_path text,
  created_by         uuid references public.app_user(id) on delete set null,
  moderation_state   public.moderation_state not null default 'visible',
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  constraint campus_event_time_ck check (ends_at is null or ends_at >= starts_at)
);
-- "What's on, soonest first" for my campus.
create index campus_event_upcoming_idx on public.campus_event (university_id, starts_at)
  where moderation_state = 'visible' and published_at is not null;
create index campus_event_club_idx on public.campus_event (club_id, starts_at desc) where club_id is not null;

create table public.event_rsvp (
  event_id      uuid not null references public.campus_event(id) on delete cascade,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  state         public.rsvp_state not null default 'going',
  created_at    timestamptz not null default now(),
  primary key (event_id, app_user_id)
);
create index event_rsvp_user_idx on public.event_rsvp (app_user_id, created_at desc);


-- =====================================================================
-- 15. MODERATION
--
-- Moderators work with HANDLES and content, never with layer 1. A
-- moderator who needs the real person must go through
-- identity.resolve_subject(), which logs. That separation is the reason
-- moderation.* has no path into identity.*.
-- =====================================================================

-- Reports are filed by users, so the table lives in `public` with an
-- owner-only read policy. Target is polymorphic by necessity (eight
-- content types, one reporting UI); integrity is checked in the server
-- layer and by a nightly orphan sweep.
create table public.report (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references public.app_user(id) on delete cascade,
  target_type    public.report_target_type not null,
  target_id      uuid not null,
  reason_key     text not null references ref.report_reason(key),
  details        text,
  created_at     timestamptz not null default now(),
  state          text not null default 'new' check (state in ('new', 'linked', 'dismissed')),
  case_id        uuid,
  constraint report_once_per_target unique (reporter_id, target_type, target_id)
);
create index report_target_idx on public.report (target_type, target_id, created_at desc);
create index report_open_idx   on public.report (created_at) where state = 'new';

create table moderation.staff (
  id            uuid primary key default util.uuid_v7(),
  auth_user_id  uuid not null unique references auth.users(id) on delete restrict,
  display_name  text not null,
  role          moderation.staff_role not null default 'moderator',
  -- Scope a moderator to specific universities; empty = global.
  university_scope uuid[] not null default '{}',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create table moderation.mod_case (
  id                uuid primary key default util.uuid_v7(),
  subject_type      public.report_target_type not null,
  subject_id        uuid not null,
  -- The pseudonym under investigation. This is layer 2, which is as far
  -- as moderation goes on its own authority.
  subject_app_user_id uuid references public.app_user(id) on delete set null,
  university_id     uuid references ref.university(id) on delete set null,
  opened_by         text not null check (opened_by in ('report', 'automod', 'staff', 'appeal')),
  state             moderation.mod_case_state not null default 'open',
  severity          smallint not null default 1 check (severity between 1 and 5),
  assigned_to       uuid references moderation.staff(id) on delete set null,
  report_count      integer not null default 0,
  opened_at         timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at       timestamptz,
  resolution_note   text,
  constraint mod_case_subject_uniq unique (subject_type, subject_id)
);
create index mod_case_queue_idx on moderation.mod_case (state, severity desc, opened_at)
  where state in ('open', 'triage');
create index mod_case_user_idx on moderation.mod_case (subject_app_user_id, opened_at desc);

alter table public.report
  add constraint report_case_fk foreign key (case_id) references moderation.mod_case(id) on delete set null;

create table moderation.action (
  id                uuid primary key default util.uuid_v7(),
  case_id           uuid not null references moderation.mod_case(id) on delete cascade,
  actor_staff_id    uuid references moderation.staff(id) on delete set null,
  kind              moderation.action_kind not null,
  target_app_user_id uuid references public.app_user(id) on delete set null,
  target_type       public.report_target_type,
  target_id         uuid,
  reason_key        text references ref.report_reason(key),
  duration          interval,
  note              text,
  -- Set when the action required unsealing layer 1; points at the audit
  -- row so the two records can be reconciled during review.
  identity_access_log_id uuid,
  created_at        timestamptz not null default now()
);
create index action_case_idx on moderation.action (case_id, created_at);
create index action_user_idx on moderation.action (target_app_user_id, created_at desc);

create table moderation.appeal (
  id             uuid primary key default util.uuid_v7(),
  action_id      uuid not null references moderation.action(id) on delete cascade,
  app_user_id    uuid not null references public.app_user(id) on delete cascade,
  body           text not null,
  state          text not null default 'open' check (state in ('open', 'upheld', 'overturned', 'withdrawn')),
  decided_by     uuid references moderation.staff(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  constraint appeal_once unique (action_id, app_user_id)
);

-- Sanctions the read paths must honour. Denormalised out of
-- moderation.action so that "is this user muted right now" is one
-- indexed lookup instead of an interval calculation over a history.
create table public.user_sanction (
  id             uuid primary key default gen_random_uuid(),
  app_user_id    uuid not null references public.app_user(id) on delete cascade,
  kind           text not null check (kind in ('mute', 'suspend', 'ban', 'shadowban', 'listing_ban', 'review_ban')),
  scope_board_id uuid references public.board(id) on delete cascade,
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz,
  action_id      uuid references moderation.action(id) on delete set null,
  is_active      boolean not null default true
);
create index user_sanction_active_idx on public.user_sanction (app_user_id, kind)
  where is_active;


-- =====================================================================
-- 16. NOTIFICATIONS AND DEVICES
--
-- The payload deliberately stores IDs and an alias number, not rendered
-- copy: the app renders in the user's current locale, and a notification
-- must never contain a handle for an anonymous actor.
-- =====================================================================

create table public.notification (
  id             uuid primary key default gen_random_uuid(),
  recipient_id   uuid not null references public.app_user(id) on delete cascade,
  kind_key       text not null references ref.notification_kind(key),
  entity_type    text,
  entity_id      uuid,
  -- {"alias_number":5,"board_id":"...","excerpt":"..."} — never a handle
  -- unless the actor posted under their handle.
  payload        jsonb not null default '{}'::jsonb,
  group_key      text,                                        -- collapse "3 new replies"
  is_read        boolean not null default false,
  read_at        timestamptz,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz
);
-- Notification list: mine, newest first, unread badge count.
create index notification_recipient_idx on public.notification (recipient_id, created_at desc);
create index notification_unread_idx    on public.notification (recipient_id) where not is_read;
create index notification_group_idx     on public.notification (recipient_id, group_key, created_at desc)
  where group_key is not null;

comment on table public.notification is
  'Highest-growth table in the schema. Partition by created_at (monthly) once row count passes ~50M; the access pattern (recipient + recent) is partition-friendly.';

create table public.notification_preference (
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  kind_key      text not null references ref.notification_kind(key),
  push_enabled  boolean not null default true,
  email_enabled boolean not null default false,
  primary key (app_user_id, kind_key)
);

create table public.device_token (
  id             uuid primary key default gen_random_uuid(),
  app_user_id    uuid not null references public.app_user(id) on delete cascade,
  platform       text not null check (platform in ('ios', 'android')),
  push_token     text not null,
  locale         public.locale_code not null default 'az',
  quiet_hours_start time,
  quiet_hours_end   time,
  last_seen_at   timestamptz not null default now(),
  revoked_at     timestamptz,
  constraint device_token_uniq unique (push_token)
);
create index device_token_user_idx on public.device_token (app_user_id) where revoked_at is null;

-- Blocks. Owner-private both ways: neither party may enumerate blocks.
create table public.user_block (
  blocker_id    uuid not null references public.app_user(id) on delete cascade,
  blocked_id    uuid not null references public.app_user(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_block_not_self check (blocker_id <> blocked_id)
);


-- =====================================================================
-- 17. COUNTER MAINTENANCE
--
-- Rule of thumb applied throughout:
--   TRIGGER      when the counter is an exact integer sum/count, the
--                write rate is human-scale, and staleness is visible to
--                the user (votes, comments, followers, absences).
--   RECOMPUTE    when the statistic is not incrementally derivable
--                (medians, percentiles, "top N"), needs a rolling
--                window, or is written at machine rate (views).
--   LEDGER+FOLD  when a trigger would serialise many writers on one hot
--                row (karma on a popular author).
--
-- The full table is in docs/01-schema-notes.md.
-- =====================================================================

-- --------------------------------------------------------------------
-- 17.1 Post votes -> score, hot_rank, karma ledger
-- --------------------------------------------------------------------
create table internal.karma_ledger (
  id            bigint generated always as identity primary key,
  app_user_id   uuid not null references public.app_user(id) on delete cascade,
  delta         integer not null,
  reason        text not null,
  source_type   text,
  source_id     uuid,
  created_at    timestamptz not null default now(),
  folded_at     timestamptz
);
create index karma_ledger_unfolded_idx on internal.karma_ledger (app_user_id)
  where folded_at is null;

comment on table internal.karma_ledger is
  'Append-only karma deltas. A trigger that updated app_user.karma directly would make every voter on a popular post contend for one row; folding runs on a schedule instead.';

create or replace function public.tg_post_vote_counts() returns trigger
language plpgsql as $$
declare
  v_up integer := 0;
  v_down integer := 0;
  v_delta integer := 0;
  v_post uuid;
  v_score integer;
  v_created timestamptz;
  v_author uuid;
begin
  v_post := coalesce(new.post_id, old.post_id);

  if tg_op = 'INSERT' then
    v_up   := case when new.value = 1 then 1 else 0 end;
    v_down := case when new.value = -1 then 1 else 0 end;
    v_delta := new.value;
  elsif tg_op = 'DELETE' then
    v_up   := case when old.value = 1 then -1 else 0 end;
    v_down := case when old.value = -1 then -1 else 0 end;
    v_delta := -old.value;
  else
    v_up   := case when new.value = 1 then 1 else 0 end - case when old.value = 1 then 1 else 0 end;
    v_down := case when new.value = -1 then 1 else 0 end - case when old.value = -1 then 1 else 0 end;
    v_delta := new.value - old.value;
  end if;

  update public.post
     set upvote_count   = upvote_count + v_up,
         downvote_count = downvote_count + v_down,
         score          = score + v_delta,
         hot_rank       = util.hot_rank(score + v_delta, created_at)
   where id = v_post
   returning score, created_at into v_score, v_created;

  -- Karma follows the author, so it needs the (internal) authorship map.
  select pa.app_user_id into v_author from internal.post_author pa where pa.post_id = v_post;
  if v_author is not null and v_delta <> 0 then
    insert into internal.karma_ledger (app_user_id, delta, reason, source_type, source_id)
    values (v_author, v_delta, 'post_vote', 'post', v_post);
  end if;

  return null;
end$$;

create trigger post_vote_counts
  after insert or update or delete on public.post_vote
  for each row execute function public.tg_post_vote_counts();

create or replace function public.tg_comment_vote_counts() returns trigger
language plpgsql as $$
declare v_delta integer; v_up integer; v_down integer; v_comment uuid; v_author uuid;
begin
  v_comment := coalesce(new.comment_id, old.comment_id);
  if tg_op = 'INSERT' then
    v_up := case when new.value = 1 then 1 else 0 end;
    v_down := case when new.value = -1 then 1 else 0 end;
    v_delta := new.value;
  elsif tg_op = 'DELETE' then
    v_up := case when old.value = 1 then -1 else 0 end;
    v_down := case when old.value = -1 then -1 else 0 end;
    v_delta := -old.value;
  else
    v_up := case when new.value = 1 then 1 else 0 end - case when old.value = 1 then 1 else 0 end;
    v_down := case when new.value = -1 then 1 else 0 end - case when old.value = -1 then 1 else 0 end;
    v_delta := new.value - old.value;
  end if;

  update public.post_comment
     set upvote_count = upvote_count + v_up,
         downvote_count = downvote_count + v_down,
         score = score + v_delta
   where id = v_comment;

  select ca.app_user_id into v_author from internal.comment_author ca where ca.comment_id = v_comment;
  if v_author is not null and v_delta <> 0 then
    insert into internal.karma_ledger (app_user_id, delta, reason, source_type, source_id)
    values (v_author, v_delta, 'comment_vote', 'comment', v_comment);
  end if;
  return null;
end$$;

create trigger comment_vote_counts
  after insert or update or delete on public.comment_vote
  for each row execute function public.tg_comment_vote_counts();

-- Fold the ledger into app_user.karma. Run every minute or so.
create or replace function public.fold_karma_ledger(p_limit integer default 50000)
returns integer
language plpgsql security definer set search_path = public, internal, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  with batch as (
    select id, app_user_id, delta
      from internal.karma_ledger
     where folded_at is null
     order by id
     limit p_limit
     for update skip locked
  ),
  agg as (
    select app_user_id, sum(delta) as delta from batch group by app_user_id
  ),
  upd as (
    update public.app_user au
       set karma = au.karma + agg.delta
      from agg where au.id = agg.app_user_id
    returning 1
  )
  update internal.karma_ledger kl
     set folded_at = now()
    from batch where kl.id = batch.id;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

-- --------------------------------------------------------------------
-- 17.2 Comments -> post.comment_count, board.last_post_at, reply_count
-- --------------------------------------------------------------------
create or replace function public.tg_comment_counts() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.post
       set comment_count = comment_count + 1,
           last_comment_at = greatest(coalesce(last_comment_at, new.created_at), new.created_at)
     where id = new.post_id;
    if new.parent_id is not null then
      update public.post_comment set reply_count = reply_count + 1 where id = new.parent_id;
    end if;
  elsif tg_op = 'DELETE' then
    update public.post set comment_count = greatest(0, comment_count - 1) where id = old.post_id;
    if old.parent_id is not null then
      update public.post_comment set reply_count = greatest(0, reply_count - 1) where id = old.parent_id;
    end if;
  elsif tg_op = 'UPDATE' and (old.deleted_at is null) <> (new.deleted_at is null) then
    -- Soft delete/restore also moves the visible count.
    update public.post
       set comment_count = greatest(0, comment_count + case when new.deleted_at is null then 1 else -1 end)
     where id = new.post_id;
  end if;
  return null;
end$$;

create trigger comment_counts
  after insert or delete or update of deleted_at on public.post_comment
  for each row execute function public.tg_comment_counts();

-- --------------------------------------------------------------------
-- 17.3 Generic single-column counter helper
-- Used for the many "count children on a parent" caches. Keeping one
-- function avoids eight near-identical trigger bodies.
-- --------------------------------------------------------------------
create or replace function public.tg_bump_counter() returns trigger
language plpgsql as $$
declare
  v_parent_table text := tg_argv[0];   -- e.g. 'public.board'
  v_parent_col   text := tg_argv[1];   -- e.g. 'board_id'
  v_counter_col  text := tg_argv[2];   -- e.g. 'follower_count'
  v_id uuid;
  v_delta integer;
begin
  if tg_op = 'INSERT' then
    v_delta := 1;
    execute format('select ($1).%I', v_parent_col) into v_id using new;
  else
    v_delta := -1;
    execute format('select ($1).%I', v_parent_col) into v_id using old;
  end if;
  execute format('update %s set %I = greatest(0, %I + $1) where id = $2',
                 v_parent_table, v_counter_col, v_counter_col)
    using v_delta, v_id;
  return null;
end$$;

create trigger board_follow_counter
  after insert or delete on public.board_follow
  for each row execute function public.tg_bump_counter('public.board', 'board_id', 'follower_count');

create trigger post_save_counter
  after insert or delete on public.post_save
  for each row execute function public.tg_bump_counter('public.post', 'post_id', 'save_count');

create trigger listing_save_counter
  after insert or delete on public.listing_save
  for each row execute function public.tg_bump_counter('public.listing', 'listing_id', 'save_count');

create trigger club_member_counter
  after insert or delete on public.club_member
  for each row execute function public.tg_bump_counter('public.club', 'club_id', 'member_count');

create trigger post_attachment_counter
  after insert or delete on public.post_attachment
  for each row execute function public.tg_bump_counter('public.post', 'post_id', 'attachment_count');

create trigger listing_image_counter
  after insert or delete on public.listing_image
  for each row execute function public.tg_bump_counter('public.listing', 'listing_id', 'image_count');

-- --------------------------------------------------------------------
-- 17.4 Post -> board counters
-- --------------------------------------------------------------------
create or replace function public.tg_post_board_counts() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.board
       set post_count = post_count + 1,
           last_post_at = greatest(coalesce(last_post_at, new.created_at), new.created_at)
     where id = new.board_id;
    -- Denormalise the board's university onto the post for the campus feed.
    if new.university_id is null then
      update public.post p set university_id = b.university_id
        from public.board b where b.id = new.board_id and p.id = new.id;
    end if;
  elsif tg_op = 'DELETE' then
    update public.board set post_count = greatest(0, post_count - 1) where id = old.board_id;
  end if;
  return null;
end$$;

create trigger post_board_counts
  after insert or delete on public.post
  for each row execute function public.tg_post_board_counts();

-- --------------------------------------------------------------------
-- 17.5 Poll counters
-- --------------------------------------------------------------------
create or replace function public.tg_poll_vote_counts() returns trigger
language plpgsql as $$
declare v_post uuid; v_option uuid; v_delta integer;
begin
  if tg_op = 'INSERT' then
    v_post := new.post_id; v_option := new.option_id; v_delta := 1;
  else
    v_post := old.post_id; v_option := old.option_id; v_delta := -1;
  end if;

  update public.poll_option set vote_count = greatest(0, vote_count + v_delta) where id = v_option;

  -- total_votes counts distinct VOTERS, not ballots, so a multi-choice
  -- poll cannot inflate its own denominator.
  update public.poll p
     set total_votes = (select count(distinct pv.app_user_id) from public.poll_vote pv where pv.post_id = v_post)
   where p.post_id = v_post;
  return null;
end$$;

create trigger poll_vote_counts
  after insert or delete on public.poll_vote
  for each row execute function public.tg_poll_vote_counts();

-- --------------------------------------------------------------------
-- 17.6 Absence -> enrollment counters
-- --------------------------------------------------------------------
create or replace function public.tg_absence_counts() returns trigger
language plpgsql as $$
declare
  v_enrollment uuid := coalesce(new.enrollment_id, old.enrollment_id);
  v_section uuid;
  v_late_weight numeric;
begin
  select e.section_id into v_section from public.enrollment e where e.id = v_enrollment;
  select l.late_counts_as into v_late_weight from ref.effective_absence_limit(v_section) l;

  update public.enrollment e
     set absence_count = sub.cnt,
         absence_units = sub.units
    from (
      select count(*) filter (where a.kind <> 'excused') as cnt,
             coalesce(sum(case a.kind
                            when 'absent' then 1
                            when 'late'   then coalesce(v_late_weight, 0.5)
                            else 0 end), 0) as units
        from public.absence a
       where a.enrollment_id = v_enrollment
    ) sub
   where e.id = v_enrollment;
  return null;
end$$;

create trigger absence_counts
  after insert or update or delete on public.absence
  for each row execute function public.tg_absence_counts();

-- --------------------------------------------------------------------
-- 17.7 Review -> summary tables
-- Sums and histogram buckets only; averages are generated columns and
-- top_tags is recomputed on a schedule.
-- --------------------------------------------------------------------
create or replace function public.tg_review_summaries() returns trigger
language plpgsql as $$
declare
  -- PL/pgSQL cannot mix a record variable with a scalar in a FOR target
  -- (`for r, v_sign in ...` is a syntax error), so the pair is carried as
  -- one composite row and unpacked at the top of the loop.
  rec    record;
  r      public.review%rowtype;
  v_sign integer;
begin
  -- Apply the old row negatively and the new row positively; an UPDATE
  -- runs both halves, which makes edits exact.
  for rec in
    select old as rev, -1 as sign where tg_op in ('UPDATE', 'DELETE')
    union all
    select new as rev,  1 as sign where tg_op in ('UPDATE', 'INSERT')
  loop
    r      := rec.rev;
    v_sign := rec.sign;
    insert into public.instructor_review_summary as s (instructor_id, review_count, rating_sum,
           star_1, star_2, star_3, star_4, star_5,
           quality_sum, fairness_sum, workload_sum, attendance_sum, updated_at)
    values (r.instructor_id, v_sign, v_sign * r.overall_rating,
            v_sign * (r.overall_rating = 1)::int, v_sign * (r.overall_rating = 2)::int,
            v_sign * (r.overall_rating = 3)::int, v_sign * (r.overall_rating = 4)::int,
            v_sign * (r.overall_rating = 5)::int,
            v_sign * r.quality, v_sign * r.fairness, v_sign * r.workload, v_sign * r.attendance_strictness, now())
    on conflict (instructor_id) do update set
      review_count   = s.review_count   + excluded.review_count,
      rating_sum     = s.rating_sum     + excluded.rating_sum,
      star_1         = s.star_1         + excluded.star_1,
      star_2         = s.star_2         + excluded.star_2,
      star_3         = s.star_3         + excluded.star_3,
      star_4         = s.star_4         + excluded.star_4,
      star_5         = s.star_5         + excluded.star_5,
      quality_sum    = s.quality_sum    + excluded.quality_sum,
      fairness_sum   = s.fairness_sum   + excluded.fairness_sum,
      workload_sum   = s.workload_sum   + excluded.workload_sum,
      attendance_sum = s.attendance_sum + excluded.attendance_sum,
      updated_at     = now();

    insert into public.course_review_summary as cs (course_id, review_count, rating_sum,
           quality_sum, fairness_sum, workload_sum, attendance_sum, updated_at)
    values (r.course_id, v_sign, v_sign * r.overall_rating,
            v_sign * r.quality, v_sign * r.fairness, v_sign * r.workload, v_sign * r.attendance_strictness, now())
    on conflict (course_id) do update set
      review_count   = cs.review_count   + excluded.review_count,
      rating_sum     = cs.rating_sum     + excluded.rating_sum,
      quality_sum    = cs.quality_sum    + excluded.quality_sum,
      fairness_sum   = cs.fairness_sum   + excluded.fairness_sum,
      workload_sum   = cs.workload_sum   + excluded.workload_sum,
      attendance_sum = cs.attendance_sum + excluded.attendance_sum,
      updated_at     = now();

    insert into public.course_instructor_review_summary as cis (course_id, instructor_id, review_count, rating_sum,
           quality_sum, fairness_sum, workload_sum, attendance_sum, updated_at)
    values (r.course_id, r.instructor_id, v_sign, v_sign * r.overall_rating,
            v_sign * r.quality, v_sign * r.fairness, v_sign * r.workload, v_sign * r.attendance_strictness, now())
    on conflict (course_id, instructor_id) do update set
      review_count   = cis.review_count   + excluded.review_count,
      rating_sum     = cis.rating_sum     + excluded.rating_sum,
      quality_sum    = cis.quality_sum    + excluded.quality_sum,
      fairness_sum   = cis.fairness_sum   + excluded.fairness_sum,
      workload_sum   = cis.workload_sum   + excluded.workload_sum,
      attendance_sum = cis.attendance_sum + excluded.attendance_sum,
      updated_at     = now();
  end loop;

  -- '3 FƏNN': distinct courses reviewed for this instructor. Cheap
  -- because it is bounded by the instructor's course list.
  update public.instructor_review_summary s
     set course_count = (select count(distinct cis.course_id)
                           from public.course_instructor_review_summary cis
                          where cis.instructor_id = s.instructor_id and cis.review_count > 0)
   where s.instructor_id = coalesce(new.instructor_id, old.instructor_id);

  return null;
end$$;

create trigger review_summaries
  after insert or update or delete on public.review
  for each row execute function public.tg_review_summaries();

-- --------------------------------------------------------------------
-- 17.8 Trade ratings -> app_user reputation
-- --------------------------------------------------------------------
create or replace function public.tg_trade_rating_counts() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    update public.app_user
       set trade_rating_sum = trade_rating_sum + new.score,
           trade_rating_count = trade_rating_count + 1
     where id = new.ratee_id;
  elsif tg_op = 'DELETE' then
    update public.app_user
       set trade_rating_sum = greatest(0, trade_rating_sum - old.score),
           trade_rating_count = greatest(0, trade_rating_count - 1)
     where id = old.ratee_id;
  else
    update public.app_user
       set trade_rating_sum = trade_rating_sum - old.score + new.score
     where id = new.ratee_id;
  end if;
  return null;
end$$;

create trigger trade_rating_counts
  after insert or update or delete on public.trade_rating
  for each row execute function public.tg_trade_rating_counts();

create or replace function public.tg_deal_completed_counts() returns trigger
language plpgsql as $$
begin
  if new.state = 'completed' and coalesce(old.state, 'inquiry') <> 'completed' then
    update public.app_user set deal_count = deal_count + 1 where id in (new.seller_id, new.buyer_id);
  elsif old.state = 'completed' and new.state <> 'completed' then
    update public.app_user set deal_count = greatest(0, deal_count - 1) where id in (new.seller_id, new.buyer_id);
  end if;
  return null;
end$$;

create trigger deal_completed_counts
  after update of state on public.deal
  for each row execute function public.tg_deal_completed_counts();

-- --------------------------------------------------------------------
-- 17.9 RSVP -> attendee_count
-- --------------------------------------------------------------------
create or replace function public.tg_rsvp_counts() returns trigger
language plpgsql as $$
declare v_delta integer := 0;
begin
  if tg_op = 'INSERT' then
    v_delta := case when new.state = 'going' then 1 else 0 end;
  elsif tg_op = 'DELETE' then
    v_delta := case when old.state = 'going' then -1 else 0 end;
  else
    v_delta := case when new.state = 'going' then 1 else 0 end
             - case when old.state = 'going' then 1 else 0 end;
  end if;
  if v_delta <> 0 then
    update public.campus_event
       set attendee_count = greatest(0, attendee_count + v_delta)
     where id = coalesce(new.event_id, old.event_id);
  end if;
  return null;
end$$;

create trigger rsvp_counts
  after insert or update or delete on public.event_rsvp
  for each row execute function public.tg_rsvp_counts();

-- --------------------------------------------------------------------
-- 17.10 Chat -> conversation counters + responsiveness facts
-- The COUNTERS are triggered; the DERIVED statistics (response rate,
-- median response time) are recomputed from internal.seller_inquiry.
-- --------------------------------------------------------------------
create or replace function public.tg_chat_message_counts() returns trigger
language plpgsql as $$
declare v_seller uuid;
begin
  update public.conversation
     set message_count = message_count + 1,
         last_message_at = new.created_at
   where id = new.conversation_id;

  update public.conversation_participant
     set unread_count = unread_count + 1
   where conversation_id = new.conversation_id
     and app_user_id <> new.sender_id
     and left_at is null;

  -- Record the inquiry / first response pair for the seller stats.
  select cp.app_user_id into v_seller
    from public.conversation_participant cp
   where cp.conversation_id = new.conversation_id and cp.role = 'seller'
   limit 1;

  if v_seller is not null then
    if new.sender_id <> v_seller then
      insert into internal.seller_inquiry (conversation_id, seller_id, first_inquiry_at)
      values (new.conversation_id, v_seller, new.created_at)
      on conflict (conversation_id) do nothing;
    else
      update internal.seller_inquiry
         set first_response_at = coalesce(first_response_at, new.created_at)
       where conversation_id = new.conversation_id;
    end if;
  end if;
  return null;
end$$;

create trigger chat_message_counts
  after insert on public.chat_message
  for each row execute function public.tg_chat_message_counts();

-- Rolling 90-day recompute of the seller card numbers.
-- Design screen 08: "100% CAVAB", "~2 saat CAVAB VAXTI".
create or replace function public.recompute_seller_stats(p_window interval default interval '90 days')
returns integer
language plpgsql security definer set search_path = public, internal, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  with s as (
    select seller_id,
           count(*)                                        as inquiries,
           count(*) filter (where first_response_at is not null) as responded,
           percentile_cont(0.5) within group (order by response_seconds)
             filter (where response_seconds is not null)   as median_sec
      from internal.seller_inquiry
     where first_inquiry_at > now() - p_window
     group by seller_id
  )
  update public.app_user au
     set response_rate_pct        = round(100.0 * s.responded / nullif(s.inquiries, 0))::smallint,
         response_time_median_sec = s.median_sec::integer
    from s
   where au.id = s.seller_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

-- --------------------------------------------------------------------
-- 17.11 Authored-content counters on app_user
-- --------------------------------------------------------------------
create or replace function public.tg_author_counts() returns trigger
language plpgsql as $$
declare v_col text := tg_argv[0];
begin
  if tg_op = 'INSERT' then
    execute format('update public.app_user set %I = %I + 1 where id = $1', v_col, v_col) using new.app_user_id;
  else
    execute format('update public.app_user set %I = greatest(0, %I - 1) where id = $1', v_col, v_col) using old.app_user_id;
  end if;
  return null;
end$$;

create trigger post_author_counts
  after insert or delete on internal.post_author
  for each row execute function public.tg_author_counts('post_count');

create trigger comment_author_counts
  after insert or delete on internal.comment_author
  for each row execute function public.tg_author_counts('comment_count');

create trigger review_author_counts
  after insert or delete on internal.review_author
  for each row execute function public.tg_author_counts('review_count');

-- --------------------------------------------------------------------
-- 17.12 Application count (career -> public)
-- The ONLY write that crosses the career boundary, and it carries a
-- count and nothing else. Reviewed deliberately: an aggregate of this
-- shape cannot leak an applicant's identity.
-- --------------------------------------------------------------------
create or replace function career.tg_application_count() returns trigger
language plpgsql security definer set search_path = career, public, pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    update public.vacancy set application_count = application_count + 1 where id = new.vacancy_id;
  elsif tg_op = 'DELETE' then
    update public.vacancy set application_count = greatest(0, application_count - 1) where id = old.vacancy_id;
  end if;
  return null;
end$$;

create trigger application_count
  after insert or delete on career.application
  for each row execute function career.tg_application_count();

-- --------------------------------------------------------------------
-- 17.13 Scheduled recomputations (pg_cron; schedules live in migration 0016)
--   fold_karma_ledger()          every 1 min
--   recompute_seller_stats()     every 30 min
--   refresh_view_counts()        every 5 min
--   refresh_top_tags()           hourly
--   refresh_complaint_counts()   hourly
--   refresh_absence_limits()     nightly
--   push cohort_size from identity  nightly
-- --------------------------------------------------------------------
create or replace function public.refresh_view_counts() returns integer
language plpgsql security definer set search_path = public, internal, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  with d as (
    delete from internal.view_delta
     where bucket_hour < date_trunc('hour', now())
    returning post_id, delta
  ),
  agg as (select post_id, sum(delta) as delta from d group by post_id)
  update public.post p set view_count = p.view_count + agg.delta
    from agg where p.id = agg.post_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

create or replace function public.refresh_complaint_counts() returns integer
language plpgsql security definer set search_path = public, moderation, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  with c as (
    select a.target_app_user_id as app_user_id, count(*) as n
      from moderation.action a
     where a.kind in ('warn', 'mute', 'suspend', 'ban', 'remove_content')
       and a.target_app_user_id is not null
     group by 1
  )
  update public.app_user au set complaint_count = c.n from c where au.id = c.app_user_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

create or replace function public.refresh_absence_limits() returns integer
language plpgsql security definer set search_path = public, ref, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  update public.enrollment e
     set absence_limit = l.max_absences
    from ref.effective_absence_limit(e.section_id) l
   where e.state = 'enrolled'
     and e.absence_limit is distinct from l.max_absences;
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;


-- =====================================================================
-- 18. ROW LEVEL SECURITY
-- =====================================================================
--
-- Trust model, stated once because every policy below depends on it:
--
--   * The mobile client NEVER holds a direct table grant. It talks to the
--     server layer (kiksu_app), which authorises in code. RLS is defence
--     in depth for the PostgREST path, not the primary control.
--
--   * The primary control for Layers 1, 3 and 4 is NOT RLS at all — it is
--     the schema-level REVOKE in section 02. identity.*, career.* and
--     internal.* are unreachable to anon/authenticated regardless of any
--     policy here. That is deliberate: a policy can be mis-written, a
--     missing schema grant cannot be worked around.
--
--   * Therefore NO POLICY IN THIS SECTION MAY REFERENCE internal.*,
--     identity.* OR career.*. A policy is evaluated with the caller's
--     privileges; referencing a sealed schema would either fail loudly or,
--     worse, force us to wrap it in SECURITY DEFINER and reintroduce the
--     exact linkage the architecture exists to prevent. In particular:
--     authorship of an anonymous post lives in internal.post_author, so
--     "my posts" is a SERVER-LAYER query, never an RLS predicate.
--
--   * public.post.author_app_user_id is NULL for every anonymous post and
--     is populated only for deliberately-identified posts (staff notice,
--     club announcement). Policies may use it ONLY for that identified
--     case. It is not authorship.
--
-- Performance: every helper call is wrapped in a subselect so Postgres
-- evaluates it once per statement as an InitPlan rather than once per row.
-- See the note at 07.2. This is the single biggest RLS cost lever.
-- ---------------------------------------------------------------------

-- 18.1 The server layer bypasses RLS deliberately.
--      kiksu_app performs its own authorisation and needs to read rows
--      across users (feed assembly, moderation, notification fan-out).
--      Making it fight RLS would push us toward SECURITY DEFINER wrappers
--      everywhere, which is strictly worse. The sealed schemas remain
--      unreachable to it: kiksu_app has no usage on identity or career.
alter role kiksu_app with bypassrls;

-- 18.2 Board visibility — the predicate reused across the whole forum.
create or replace function public.can_read_board(p_board_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists (
    select 1
      from public.board b
     where b.id = p_board_id
       and b.is_archived = false
       -- national boards (university_id is null) are visible to everyone;
       -- campus boards only to that campus.
       and (b.university_id is null
            or b.university_id = (select public.current_university_id()))
       -- enum is declared ascending, so this is a real tier gate.
       and (select public.current_tier()) >= b.min_tier_to_read
  );
$$;

comment on function public.can_read_board is
  'Board read gate: archived, campus scope, and minimum verification tier. Used by every forum policy.';

-- 18.3 Conversation participation — marketplace chat and DMs.
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists (
    select 1
      from public.conversation_participant cp
     where cp.conversation_id = p_conversation_id
       and cp.app_user_id = (select public.current_app_user_id())
  );
$$;

-- 18.4 Enrollment check — gates coursework and course materials.
create or replace function public.is_enrolled_in_section(p_section_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_catalog, pg_temp as $$
  select exists (
    select 1
      from public.enrollment e
     where e.section_id = p_section_id
       and e.app_user_id = (select public.current_app_user_id())
       and e.state = 'enrolled'
  );
$$;

-- ---------------------------------------------------------------------
-- 18.5 Enable RLS on every public table. Deny by default: a table with
--      RLS enabled and no matching policy returns zero rows.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select format('%I.%I', schemaname, tablename)
      from pg_tables
     where schemaname = 'public'
  loop
    execute format('alter table %s enable row level security', t);
    execute format('alter table %s force row level security', t);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- 18.6 Own-row tables. The user sees their rows and nobody else's.
-- ---------------------------------------------------------------------
create policy app_user_self on public.app_user
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy enrollment_self on public.enrollment
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy coursework_state_self on public.coursework_state
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy board_follow_self on public.board_follow
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy post_vote_self on public.post_vote
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy comment_vote_self on public.comment_vote
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy poll_vote_self on public.poll_vote
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy post_save_self on public.post_save
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy review_helpful_self on public.review_helpful
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy listing_save_self on public.listing_save
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy vacancy_save_self on public.vacancy_save
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy notification_self on public.notification
  for select to authenticated
  using (recipient_id = (select public.current_app_user_id()));

create policy notification_preference_self on public.notification_preference
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy device_token_self on public.device_token
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy user_sanction_self on public.user_sanction
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy user_block_self on public.user_block
  for select to authenticated
  using (blocker_id = (select public.current_app_user_id()));

-- A reporter may see the reports they filed and nothing else. Reports are
-- otherwise invisible: being able to probe report state tells an abuser
-- whether they have been noticed.
create policy report_own on public.report
  for select to authenticated
  using (reporter_id = (select public.current_app_user_id()));

-- ---------------------------------------------------------------------
-- 18.7 Forum. Visibility follows the board, never the author.
-- ---------------------------------------------------------------------
create policy board_readable on public.board
  for select to authenticated
  using (
    is_archived = false
    and (university_id is null
         or university_id = (select public.current_university_id()))
    and (select public.current_tier()) >= min_tier_to_read
  );

create policy post_readable on public.post
  for select to authenticated
  using (
    moderation_state in ('visible', 'limited')
    and (select public.can_read_board(board_id))
  );

create policy post_comment_readable on public.post_comment
  for select to authenticated
  using (
    exists (select 1 from public.post p
             where p.id = post_comment.post_id
               and p.moderation_state in ('visible', 'limited')
               and (select public.can_read_board(p.board_id)))
  );

create policy poll_readable on public.poll
  for select to authenticated
  using (exists (select 1 from public.post p
                  where p.id = poll.post_id
                    and (select public.can_read_board(p.board_id))));

create policy poll_option_readable on public.poll_option
  for select to authenticated
  using (exists (select 1 from public.post p
                  where p.id = poll_option.post_id
                    and (select public.can_read_board(p.board_id))));

create policy post_attachment_readable on public.post_attachment
  for select to authenticated
  using (exists (select 1 from public.post p
                  where p.id = post_attachment.post_id
                    and p.moderation_state in ('visible', 'limited')
                    and (select public.can_read_board(p.board_id))));

-- ---------------------------------------------------------------------
-- 18.8 Reviews. Campus-scoped. The contribution wall is NOT enforced here
--      — it is a server-layer rule, because "have you written a review
--      this semester" requires internal.review_author, which RLS may not
--      touch. RLS gates the campus boundary only.
-- ---------------------------------------------------------------------
create policy review_readable on public.review
  for select to authenticated
  using (
    moderation_state in ('visible', 'limited')
    and deleted_at is null
    and university_id = (select public.current_university_id())
  );

create policy instructor_summary_readable on public.instructor_review_summary
  for select to authenticated using (true);

create policy course_summary_readable on public.course_review_summary
  for select to authenticated using (true);

create policy course_instructor_summary_readable on public.course_instructor_review_summary
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 18.9 Academic. Coursework and materials require enrollment.
-- ---------------------------------------------------------------------
create policy absence_self on public.absence
  for select to authenticated
  using (exists (select 1 from public.enrollment e
                  where e.id = absence.enrollment_id
                    and e.app_user_id = (select public.current_app_user_id())));

create policy coursework_enrolled on public.coursework
  for select to authenticated
  using ((select public.is_enrolled_in_section(section_id)));

create policy course_material_enrolled on public.course_material
  for select to authenticated
  using (
    moderation_state in ('visible', 'limited')
    and deleted_at is null
    and (section_id is null or (select public.is_enrolled_in_section(section_id)))
  );

-- Cohort sizes are counts with no identifiers; they back the k-anonymity
-- floor and are safe to read.
create policy cohort_size_readable on public.cohort_size
  for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- 18.10 Marketplace.
-- ---------------------------------------------------------------------
create policy listing_readable on public.listing
  for select to authenticated
  using (
    status in ('active', 'reserved', 'sold')
    and moderation_state in ('visible', 'limited')
    and deleted_at is null
    and university_id = (select public.current_university_id())
  );

create policy listing_image_readable on public.listing_image
  for select to authenticated
  using (exists (select 1 from public.listing l
                  where l.id = listing_image.listing_id
                    and l.university_id = (select public.current_university_id())));

-- A deal is visible to its two parties only.
create policy deal_participant on public.deal
  for select to authenticated
  using (seller_id = (select public.current_app_user_id())
         or buyer_id = (select public.current_app_user_id()));

-- Trade ratings are public reputation — they are what makes a pseudonymous
-- seller trustworthy, and the design renders them on the seller card.
create policy trade_rating_readable on public.trade_rating
  for select to authenticated using (true);

create policy conversation_participant_only on public.conversation
  for select to authenticated
  using ((select public.is_conversation_participant(id)));

create policy conversation_participant_self on public.conversation_participant
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy chat_message_participant on public.chat_message
  for select to authenticated
  using (
    deleted_at is null
    and (select public.is_conversation_participant(conversation_id))
  );

-- ---------------------------------------------------------------------
-- 18.11 Careers (public side only — career.* is a separate sealed schema).
-- ---------------------------------------------------------------------
create policy employer_readable on public.employer
  for select to authenticated
  using (is_active = true);

create policy employer_recruiter_self on public.employer_recruiter
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

create policy vacancy_readable on public.vacancy
  for select to authenticated
  using (
    status = 'active'
    and (target_university_ids is null
         or cardinality(target_university_ids) = 0
         or (select public.current_university_id()) = any (target_university_ids))
  );

-- ---------------------------------------------------------------------
-- 18.12 Events and clubs.
-- ---------------------------------------------------------------------
create policy club_readable on public.club
  for select to authenticated
  using (university_id is null
         or university_id = (select public.current_university_id()));

create policy club_member_self on public.club_member
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));

create policy campus_event_readable on public.campus_event
  for select to authenticated
  using (university_id is null
         or university_id = (select public.current_university_id()));

create policy event_rsvp_self on public.event_rsvp
  for select to authenticated
  using (app_user_id = (select public.current_app_user_id()));


-- =====================================================================
-- 19. GRANTS
-- =====================================================================
-- Section 02 revoked everything. This hands back the minimum.
--
-- Note what authenticated does NOT get: no INSERT, UPDATE or DELETE on
-- anything. Every write in Kiksu goes through the server layer, because
-- writes are where alias allocation, karma, counters and the contribution
-- wall are enforced, and none of those are expressible as a CHECK.
-- ---------------------------------------------------------------------

-- Reference data is world-readable to signed-in users.
grant select on all tables in schema ref to authenticated, kiksu_app;
alter default privileges in schema ref
  grant select on tables to authenticated, kiksu_app;

-- Public schema: SELECT only, filtered by section 18.
grant select on all tables in schema public to authenticated;
alter default privileges in schema public
  grant select on tables to authenticated;

-- The server layer gets full DML on public and internal, nothing on the
-- sealed schemas.
grant select, insert, update, delete on all tables in schema public   to kiksu_app;
grant select, insert, update, delete on all tables in schema internal to kiksu_app;
alter default privileges in schema public
  grant select, insert, update, delete on tables to kiksu_app;
alter default privileges in schema internal
  grant select, insert, update, delete on tables to kiksu_app;

-- Verification service: the only role that may touch Layer 1.
grant select, insert, update on all tables in schema identity to kiksu_identity_svc;

-- Career service: the only role that may touch Layer 4.
grant select, insert, update on all tables in schema career to kiksu_career_svc;

-- Moderation console.
grant select, insert, update on all tables in schema moderation to kiksu_moderator;
grant select on all tables in schema public to kiksu_moderator;

-- Recompute jobs.
grant select on all tables in schema public to kiksu_analytics;
grant update on public.app_user, public.board, public.post to kiksu_analytics;

-- Utility functions.
grant execute on all functions in schema util to authenticated, kiksu_app;
grant execute on function
  public.current_app_user_id(), public.current_university_id(), public.current_tier(),
  public.can_read_board(uuid), public.is_conversation_participant(uuid),
  public.is_enrolled_in_section(uuid)
  to authenticated, kiksu_app;

-- PostgREST must never expose the sealed schemas. Enforced in config too;
-- this is the belt to that braces.
comment on schema identity is 'SEALED. Exclude from PostgREST db-schemas.';
comment on schema career   is 'SEALED. Exclude from PostgREST db-schemas.';
comment on schema internal is 'SEALED. Exclude from PostgREST db-schemas.';

-- end of schema


-- =====================================================================
-- 20. PUBLIC PROFILE PROJECTION
-- =====================================================================
--
-- Closes the karma-delta oracle (02-identity-spec.md §1, S1).
--
-- THE ATTACK: the profile screen shows an exact karma integer. If any
-- surface lets you read another user's karma on demand, you poll a target
-- before and after a post appears in a board, and a +1 delta links that
-- stable pseudonym to that specific anonymous post with certainty. No
-- exploit required — just documented API surface and a clock.
--
-- THE FIX is to delete the oracle rather than guard it:
--
--   1. Exact karma is OWN-ROW ONLY. It appears in public.app_user_card,
--      which is security_invoker and therefore RLS-confined to your row.
--      It is not in the cross-user projection at all.
--   2. Others see a COARSE, DELAYED contributor level. Coarse so a single
--      post cannot move it; delayed so the moment it does move carries no
--      timing information.
--   3. Nothing else about another user is readable: no created_at (account
--      age correlates with cohort), no card_review_state (an in-flight card
--      review is a real-world event with a timestamp), no counts.
-- ---------------------------------------------------------------------

-- 20.1 Contributor level — the fuzzy replacement for exact karma.
--      Buckets are deliberately wide and super-linear: at level 3 a user
--      needs 750 more karma to advance, so no realistic amount of posting
--      moves the badge within an observation window.
create or replace function public.contributor_level_for(p_karma integer)
returns smallint
language sql immutable parallel safe as $$
  select case
           when p_karma is null or p_karma <   50 then 0::smallint  -- Yeni
           when p_karma <  250 then 1::smallint                     -- Katılımçı
           when p_karma < 1000 then 2::smallint                     -- Fəal
           when p_karma < 5000 then 3::smallint                     -- Təcrübəli
           else                     4::smallint                     -- Ağsaqqal
         end;
$$;

comment on function public.contributor_level_for is
  'Karma -> coarse badge. Buckets are wide on purpose: a single post must never be able to move a level.';

-- Materialised, NOT computed at read time. Computing it live would restore
-- the oracle at one bucket boundary: an observer watching a user near 250
-- karma would still see the badge flip on a known post.
alter table public.app_user
  add column if not exists contributor_level    smallint not null default 0,
  add column if not exists contributor_level_at timestamptz;

comment on column public.app_user.contributor_level is
  'Coarse public standing. Refreshed on a DELAYED schedule by public.refresh_contributor_levels(); never updated in the same transaction as a karma change.';

-- 20.2 The delayed refresh. Scheduled daily, off-peak, in migration 0016.
--      The delay is the security control, so do not "helpfully" call this
--      from a karma trigger.
create or replace function public.refresh_contributor_levels()
returns integer
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_rows integer;
begin
  update public.app_user au
     set contributor_level    = public.contributor_level_for(au.karma),
         contributor_level_at = now()
   where au.contributor_level is distinct from public.contributor_level_for(au.karma)
     -- Never let a level change land within 24h of the karma that caused
     -- it; that window is what makes the badge uncorrelatable with a post.
     and au.updated_at < now() - interval '24 hours';
  get diagnostics v_rows = row_count;
  return v_rows;
end$$;

comment on function public.refresh_contributor_levels is
  'DELAYED on purpose. Runs daily off-peak. Calling this from a karma trigger would reintroduce the karma-delta oracle.';

-- 20.3 public_profiles — the ONLY cross-user read of another person.
--
-- SECURITY DEFINER semantics (security_invoker off) are deliberate: the
-- view must read across users, which app_user's own-row RLS forbids. Safety
-- comes from the column list, not from RLS. Adding a column here is a
-- security change and must be reviewed as one.
create or replace view public.public_profiles
  with (security_invoker = off) as
  select au.id,
         au.handle,
         au.avatar_id,
         -- Campus badge only when the user opted in AND the cohort is large
         -- enough to hide in. display_cohort_size is maintained by the
         -- k-anonymity projection job (02-identity-spec.md §5).
         case when au.privacy_show_uni_badge
               and coalesce(au.display_cohort_size, 0) >= 20
              then au.university_id
         end                                        as university_id,
         -- Coarse status. NOT card_review_state: 'pending' would announce
         -- that a specific person submitted a card at a knowable time.
         case when au.verification_tier = 'card_verified'  then 'card'
              when au.verification_tier = 'email_verified' then 'email'
              else 'none'
         end                                        as verification_status,
         au.contributor_level
    from public.app_user au
   where au.status in ('active', 'muted');

comment on view public.public_profiles is
  'The ONLY way to read another user. handle, avatar, opt-in campus badge, coarse verification, coarse delayed level. No karma, no created_at, no counts, no card state. Adding a column is a security change.';

-- Marketplace and DM need to resolve a handle; they get this and nothing else.
grant select on public.public_profiles to authenticated, kiksu_app;

-- Belt and braces behind the RLS in section 18: even if a policy on
-- app_user were later widened by mistake, authenticated holds no
-- column privileges on the sensitive columns.
revoke select on public.app_user from authenticated;
grant select (id, handle, handle_number, avatar_id, verification_tier,
              university_id, contributor_level)
  on public.app_user to authenticated;

-- end of section 20


-- =====================================================================
-- 21. FUNCTION EXECUTE LOCKDOWN
-- =====================================================================
-- Postgres grants EXECUTE on new functions to PUBLIC by default. The schema
-- revoked that for the identity-unsealing functions but not the maintenance
-- ones, leaving six SECURITY DEFINER functions reachable by anon and
-- authenticated through PostgREST RPC.
--
-- refresh_contributor_levels is the serious one: the karma-delta oracle fix
-- (section 20) depends on the badge refreshing on a DELAY so a level change
-- cannot be tied to a specific post. A caller who can trigger the refresh
-- chooses when the badge moves, which is most of the way back to the oracle.
-- The rest are full-table operations and a cheap denial-of-service lever.
--
-- Default-deny, then grant back only what clients genuinely need.
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema util   from public, anon;

-- authenticated needs these: SECURITY INVOKER policy expressions are
-- evaluated with the caller's privileges.
grant execute on function
  public.current_app_user_id(),
  public.current_university_id(),
  public.current_tier(),
  public.can_read_board(uuid),
  public.is_conversation_participant(uuid),
  public.is_enrolled_in_section(uuid)
  to authenticated, service_role;

grant execute on function util.fold_text(text), util.fold_handle(text)
  to authenticated, service_role;

grant execute on all functions in schema public to service_role;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema util   revoke execute on functions from public;


-- =====================================================================
-- 22. OPT-IN AUTHOR CAMPUS BADGE
-- =====================================================================
-- Per-post, opt-in campus badge for national boards.
--
-- The design shows "BDU" beside an anonymous author, but there was no
-- servable column for it: post.university_id is denormalised from the BOARD,
-- so on a national board it describes the room, not the person. Rendering it
-- as an author attribute would have been simply wrong.
--
-- This makes the badge an explicit act at compose time rather than a standing
-- property of the account. Default is NULL — no badge.
alter table public.post
  add column if not exists author_university_id uuid
    references ref.university(id) on delete set null;

comment on column public.post.author_university_id is
  'OPT-IN per post, national boards only. NULL means the author did not show a campus badge, which is the default. Frozen at write time for the same reason as author_tier: re-deriving it live would rewrite the badge on every past post if the author ever transfers, and would leak that the transfer happened.';

create or replace function public.enforce_author_badge_scope() returns trigger
language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare v_scope public.board_scope;
begin
  if new.author_university_id is null then
    return new;
  end if;

  select b.scope into v_scope from public.board b where b.id = new.board_id;

  if v_scope is distinct from 'national' then
    raise exception
      'author_university_id may only be set on a national board (board scope is %)', v_scope
      using errcode = 'check_violation';
  end if;

  return new;
end$$;

create trigger post_author_badge_scope
  before insert or update of author_university_id, board_id on public.post
  for each row execute function public.enforce_author_badge_scope();

-- The server layer is responsible for setting this to the CALLER's own
-- university. It cannot be enforced here: authorship lives in
-- internal.post_author, which is written after the post row, so a BEFORE
-- trigger cannot see it. Asserted in the API test suite instead.

create index if not exists post_author_university_idx
  on public.post (author_university_id)
  where author_university_id is not null;

revoke execute on function public.enforce_author_badge_scope() from public, anon, authenticated;


-- =====================================================================
-- 23. VACANCY PROVENANCE
-- =====================================================================
-- Kiksu aggregates rather than taking applications (docs/08-careers-scope.md),
-- so vacancies arrive from outside and four questions become operational:
-- where did this come from, is it still there, when did we last see it, and
-- which ones has the source dropped?
--
-- Without these columns a re-scrape duplicates everything and a closed
-- position lingers forever. A job board full of dead links is worse than no
-- job board — a student who applies to three closed positions stops trusting
-- the section.
alter table public.vacancy
  add column if not exists source          text,
  add column if not exists source_ref      text,
  add column if not exists source_url      text,
  add column if not exists first_seen_at   timestamptz,
  add column if not exists last_seen_at    timestamptz;

comment on column public.vacancy.source is
  'Origin key, e.g. ''work.az''. NULL for a vacancy entered by hand.';
comment on column public.vacancy.source_ref is
  'Stable id within that source — the slug for work.az. Upsert key.';
comment on column public.vacancy.last_seen_at is
  'Last scrape that still found this vacancy. Absence is how an early close is detected.';

-- The upsert key. Partial so hand-entered vacancies (source null) are not
-- forced to be unique against each other.
create unique index if not exists vacancy_source_ref_uniq
  on public.vacancy (source, source_ref)
  where source is not null and source_ref is not null;

-- The sweeper's query: everything from one source not seen since a cutoff.
create index if not exists vacancy_source_last_seen_idx
  on public.vacancy (source, last_seen_at)
  where source is not null;

-- Employer de-duplication. A scraper reading "Kapital Bank", "Kapital bank"
-- and "KAPITAL BANK" across three pages must resolve to one employer, so the
-- folded name is the key rather than the display name.
alter table public.employer
  add column if not exists name_key text;

update public.employer set name_key = util.fold_handle(name) where name_key is null;

create unique index if not exists employer_name_key_uniq
  on public.employer (name_key) where name_key is not null;

-- =====================================================================
-- 24. ACCESS TOKEN CLAIMS AND REVOCATION
-- =====================================================================
-- The API's AuthGuard already verifies a Supabase access token completely:
-- signature against the project JWKS, the user_metadata trap, the synthetic
-- email leak alarm, the app_metadata allowlist, and the epoch comparison.
-- Nothing has ever MINTED such a token. This section is the other half.
--
-- Three objects, in dependency order:
--
--   internal.auth_epoch    the revocation counter (identity spec §7.3)
--   internal.token_claims  the minimal claims projection (§7.1)
--   auth_hooks.custom_access_token_hook   what Supabase Auth calls at mint
--
-- The load-bearing property is stated in §7.1: "The hook must not be able to
-- read the sealed store — if it can, every token mint is a sealed-store read."
-- Token minting is the single highest-frequency operation in the product, so
-- a hook with a grant on `identity` would turn the sealed store's read-volume
-- budget (tens of reads per day, §7.4) into millions, destroying the cheapest
-- detector this design has. Hence a dedicated owner role whose ONLY reachable
-- object is the six-column projection, and invariant 11 to keep it that way.

-- ---------------------------------------------------------------------
-- 24.1 The hook's owner role and its schema
-- ---------------------------------------------------------------------
-- A dedicated NOLOGIN role, following the pattern of kiksu_identity_svc and
-- kiksu_career_svc in section 02: the privilege boundary is a role, not a
-- convention about which code calls what.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kiksu_auth_hook_owner') then
    create role kiksu_auth_hook_owner nologin; -- token minting only
  end if;
  -- Supabase's own GoTrue role. Present on the platform; absent on the
  -- throwaway Postgres the verification scripts stand up, where the hook is
  -- exercised by calling it directly rather than by GoTrue.
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end$$;

-- Same membership requirement as deviation #2 in docs/07-supabase-deviations.md:
-- `alter ... owner to` needs the current role to be a MEMBER of the target
-- role, and CREATEROLE alone does not confer that. Plain membership, never
-- `with admin option` — Postgres 16+ rejects granting admin back to your own
-- grantor.
grant kiksu_auth_hook_owner to postgres;

create schema if not exists auth_hooks;
alter schema auth_hooks owner to kiksu_auth_hook_owner;

-- Nobody by default, exactly as section 02 does for the other custom schemas.
revoke all on schema auth_hooks from public;
revoke usage on schema auth_hooks from anon, authenticated, service_role;

-- The whole point of the role. Spelled out rather than left to the fact that
-- section 02 already revoked these from public: a future migration that
-- widens `identity` grants should have to delete these lines to do it.
revoke usage on schema identity from kiksu_auth_hook_owner;
revoke usage on schema career   from kiksu_auth_hook_owner;
grant  usage on schema internal to kiksu_auth_hook_owner;

-- ---------------------------------------------------------------------
-- 24.2 internal.auth_epoch — the revocation primitive
-- ---------------------------------------------------------------------
-- Identity spec §7.4: revocation on the hot path is ONE INTEGER COMPARISON,
-- not an identity fetch. `token.epoch < current_epoch(app_user_id)` is the
-- entire check, so a ban takes effect on the next request rather than at the
-- next token expiry.
--
-- Deliberately a table rather than a column on public.app_user, for two
-- reasons. §7.3 lists eight distinct events that bump the counter (tier
-- grant, tier expiry, graduation, suspension, ban, unban, role change, forced
-- logout) and which one fired is worth keeping — "this session was killed,
-- and why" is the first question asked when a student reports being logged
-- out. And app_user carries FORCE ROW LEVEL SECURITY with an own-row policy;
-- hanging the token-mint path off it would mean the hook's reachable surface
-- includes a table whose policies exist for a different purpose entirely.
create table if not exists internal.auth_epoch (
  app_user_id  uuid primary key references public.app_user(id) on delete cascade,
  epoch        integer not null default 1,
  bumped_at    timestamptz not null default now(),
  -- The eight triggers from §7.3, plus the initial row. Constrained rather
  -- than free text so that a typo'd reason is a failed write and not a hole
  -- in the audit trail.
  reason       text not null default 'provisioned'
                 check (reason in ('provisioned', 'tier_grant', 'tier_expiry',
                                   'graduation', 'suspension', 'ban', 'unban',
                                   'role_change', 'forced_logout'))
);

comment on table internal.auth_epoch is
  'Revocation counter, one row per app_user. A token whose epoch is below this value is stale and rejected (identity spec §7.4). Lives in internal, not public: the value is a side channel — a client that could watch its own epoch climb would learn when moderation acted on it.';

-- Every existing user needs a row, or their first token carries the
-- coalesced default and the first bump has nothing to increment.
insert into internal.auth_epoch (app_user_id, epoch, reason)
select id, 1, 'provisioned' from public.app_user
on conflict (app_user_id) do nothing;

-- One implementation of the bump, so the API and any future SQL path cannot
-- drift. Returns the new value: callers that need to mint a token immediately
-- afterwards must not race a second read to find out what they just wrote.
create or replace function internal.bump_auth_epoch(p_app_user_id uuid, p_reason text)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  insert into internal.auth_epoch (app_user_id, epoch, bumped_at, reason)
  values (p_app_user_id, 2, now(), p_reason)
  on conflict (app_user_id) do update
    set epoch     = internal.auth_epoch.epoch + 1,
        bumped_at = now(),
        reason    = excluded.reason
  returning epoch;
$$;

comment on function internal.bump_auth_epoch(uuid, text) is
  'Increments the revocation counter and returns the new value. Seeds at 2 when no row exists, so the result always exceeds the 1 that internal.token_claims coalesces to — a missing row must never make a bump a no-op.';

revoke execute on function internal.bump_auth_epoch(uuid, text) from public, anon, authenticated;
grant  execute on function internal.bump_auth_epoch(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- 24.3 internal.token_claims — the minimal claims projection
-- ---------------------------------------------------------------------
-- Identity spec §7.1 lists the complete set of claims and closes with "That
-- is the complete list. Anything not on it is not in the token." This view IS
-- that list, and invariant 11 fails if it ever grows a column.
--
-- What is NOT here is the point: no handle (it changes, so a stale token
-- would be a rename oracle, and it would land in every access log that
-- captures a bearer token), no faculty or entry year (exactly the attributes
-- the k-anonymity floor exists to generalise), no karma, no email. §7.2.
--
-- security_invoker is OFF (the default), so the view runs with its owner's
-- privileges and can read across users. That is required — the hook resolves
-- an arbitrary auth uid at mint time — and it is safe for the same reason
-- public.public_profiles is safe: the column allowlist is the control, not
-- RLS. The hook role holds SELECT on this view and on nothing else.
create or replace view internal.token_claims as
  select
    au.auth_user_id,
    au.id as app_user_id,

    -- Tier vocabulary translation. public.verification_tier has three values;
    -- the token allowlist in apps/api/src/common/auth/claims.ts has five.
    -- Nothing mapped between them before this view existed, which is why
    -- buildDevContext emitted the token vocabulary while the onboarding
    -- service returned the database one.
    --
    -- 'graduate' and 'expired' are UNREACHABLE and deliberately so: there is
    -- no graduation transition and no credential-expiry job in this schema,
    -- so no row can produce them. They stay in the allowlist because §7.3
    -- names them as epoch-bump triggers and the API should not have to change
    -- when the job that produces them is written. Do not invent a mapping
    -- for them here from status or from suspended_until — suspension is not
    -- expiry, and conflating the two would silently downgrade every
    -- suspended student's badge.
    case au.verification_tier
      when 'unverified'     then 'provisional'
      when 'email_verified' then 'email'
      when 'card_verified'  then 'card'
    end as tier,

    -- Role vocabulary translation. moderation.staff.role has four values
    -- against the token's three, and staff is keyed by auth_user_id rather
    -- than app_user_id.
    --
    -- 'legal' maps to 'student', NOT to 'moderator'. The token's role gates
    -- moderation writes in the mobile API; legal work happens through the
    -- sealed-store unseal path, which this token cannot reach and which has
    -- its own authorisation. Granting a legal staffer moderation capability
    -- on the strength of their job title would be a privilege they never
    -- asked for and cannot be audited through the moderation queue.
    --
    -- Per-board moderator scope is NOT here: §7.1 requires it be looked up
    -- server-side because board assignments change more often than tokens are
    -- minted.
    coalesce(
      (select case s.role
                when 'admin'             then 'admin'
                when 'senior_moderator'  then 'moderator'
                when 'moderator'         then 'moderator'
                when 'legal'             then 'student'
              end
         from moderation.staff s
        where s.auth_user_id = au.auth_user_id and s.is_active),
      'student'
    ) as role,

    au.university_id as univ_id,

    -- Coalesced so that a missing epoch row degrades to "never revoked"
    -- rather than to a null claim, which would fail the allowlist parse and
    -- lock the student out. bump_auth_epoch seeds at 2 precisely so that this
    -- fallback can never outrank a real bump.
    coalesce(ae.epoch, 1) as epoch

  from public.app_user au
  left join internal.auth_epoch ae on ae.app_user_id = au.id
  -- An erased or deactivated account gets no claims, so its tokens fail the
  -- allowlist parse and the guard rejects them. Suspended and shadowbanned
  -- accounts DO get claims: a suspended student has to be able to sign in to
  -- read why, and a shadowbanned one must not be able to detect the sanction
  -- by being unable to authenticate at all.
  where au.status not in ('deactivated', 'erased')
    -- A row with no university cannot produce a usable claim set: univ_id is
    -- required by the allowlist, so a null there fails the parse and the
    -- guard answers token_invalid — whose documented client action (§2.5) is
    -- "sign out". A student in that state would be signed out on every
    -- attempt, in a loop, told their token was malformed rather than that
    -- they had not finished onboarding.
    --
    -- app_user_tier_needs_uni permits exactly this row: 'unverified' with a
    -- null university is the table's own default state. No current code path
    -- creates one — onboarding writes 'email_verified' and card approval
    -- writes 'card_verified' — but the schema allows it, and the failure mode
    -- is bad enough that it must be closed here rather than left to the fact
    -- that nothing happens to write it today.
    --
    -- Excluding the row is the correct outcome, not a workaround: a caller
    -- with no campus has nothing to scope reads by, so they belong on the
    -- @Public() onboarding routes exactly like a caller with no app_user.
    and au.university_id is not null;

comment on view internal.token_claims is
  'The complete set of claims that may enter an access token (identity spec §7.1), and the only object the token-mint hook can read. Six columns, asserted by invariant 11. Adding one is a security change to every token the product has ever issued.';

revoke all on internal.token_claims from public, anon, authenticated, service_role;
grant select on internal.token_claims to kiksu_auth_hook_owner;

-- ---------------------------------------------------------------------
-- 24.4 The access token hook
-- ---------------------------------------------------------------------
-- Supabase Auth calls this on every access token mint, passing
-- {"user_id": uuid, "claims": {...}, "authentication_method": "..."} and
-- taking back the event with `claims` replaced. Registering it is a project
-- setting, not SQL — see docs/04-infrastructure.md.
--
-- SECURITY DEFINER so it runs as kiksu_auth_hook_owner rather than as
-- supabase_auth_admin: GoTrue's own role is broadly privileged inside `auth`,
-- and a hook that inherited it would be a far larger blast radius than the
-- one object this function actually needs.
--
-- `set search_path = ''` for the reason the advisor flags 24 other functions
-- in this schema: without it, a schema earlier on the path can shadow
-- `internal.token_claims` and feed this function attacker-chosen claims.
-- Every reference below is therefore fully qualified.
create or replace function auth_hooks.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_app_md  jsonb := coalesce(event -> 'claims' -> 'app_metadata', '{}'::jsonb);
  v_sid     text  := v_claims ->> 'session_id';
  v_row     record;
begin
  select tc.app_user_id, tc.tier, tc.role, tc.univ_id, tc.epoch
    into v_row
    from internal.token_claims tc
   where tc.auth_user_id = (event ->> 'user_id')::uuid;

  -- Two ways to reach here without a claim set, and both must fail CLOSED.
  --
  -- No projection row: the caller has signed in anonymously but has not
  -- finished onboarding, or their account is erased or deactivated. This is
  -- the NORMAL case for a new student and is not an error — a pre-onboarding
  -- caller only ever reaches @Public() routes, which skip the guard entirely.
  --
  -- No session_id: every real access token carries one, so its absence means
  -- something is wrong with the mint. Emitting the block without `sid` would
  -- fail the allowlist parse anyway; emitting a fabricated one would corrupt
  -- the only session identifier moderation has for targeted revocation.
  --
  -- In both cases the six keys are STRIPPED rather than merely not written.
  -- app_metadata is server-writable only, but that makes the admin API the
  -- sole way a stale claim could persist there, and this hook — not whatever
  -- last touched raw_app_meta_data — is the authority on these six values.
  if not found or v_sid is null then
    return jsonb_set(
      event, '{claims,app_metadata}',
      v_app_md - 'app_user_id' - 'tier' - 'role' - 'univ_id' - 'epoch' - 'sid'
    );
  end if;

  -- Merged into app_metadata rather than written at the top level, because
  -- app_metadata is the half of the token a client cannot write. The guard
  -- reads these claims from nowhere else; see the user_metadata trap in
  -- apps/api/src/common/auth/auth.guard.ts.
  return jsonb_set(
    event, '{claims,app_metadata}',
    v_app_md || jsonb_build_object(
      'app_user_id', v_row.app_user_id,
      'tier',        v_row.tier,
      'role',        v_row.role,
      'univ_id',     v_row.univ_id,
      'epoch',       v_row.epoch,
      -- Copied from the registered claim rather than generated, so the value
      -- in app_metadata is the same session GoTrue already knows about.
      'sid',         v_sid
    )
  );
end;
$$;

alter function auth_hooks.custom_access_token_hook(jsonb) owner to kiksu_auth_hook_owner;

comment on function auth_hooks.custom_access_token_hook(jsonb) is
  'Stamps the six trusted claims of identity spec §7.1 into app_metadata at token mint. Fails closed: a caller with no projection row gets a token with those keys stripped, which the API rejects as token_invalid.';

-- GoTrue calls it; nobody else may. A client with EXECUTE could enumerate
-- app_user_id and univ_id for any auth uid it could guess.
revoke execute on function auth_hooks.custom_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant  usage   on schema   auth_hooks to supabase_auth_admin;
grant  execute on function auth_hooks.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- =====================================================================
-- 25. AUTOMOD ACTIONS AND APPEAL LOOKUPS
-- =====================================================================
-- moderation.appeal.action_id is NOT NULL and references moderation.action, so
-- an appeal can only ever contest a recorded ACTION. Human decisions have one:
-- AdminService.decideModeration inserts a row for every kind it accepts.
-- Automod does not — ModerationService.classifyOnWrite opens a mod_case,
-- returns 'limited', and stops there.
--
-- The consequence is the gap this migration exists to close: content limited
-- by the classifier has, structurally, nothing to appeal against. Adding an
-- appeals endpoint alone would not have fixed it, because there would be no
-- action_id to point at.

-- ---------------------------------------------------------------------
-- 25.1 A verb for what the classifier actually does
-- ---------------------------------------------------------------------
-- The existing action_kind values are human verbs — remove_content, warn,
-- mute, suspend, ban, shadowban, unban, escalate_legal, restore_content,
-- no_action. None of them describes limiting.
--
-- Reusing remove_content would be the tempting shortcut and it would be a lie
-- told to a student: limiting hides content pending review, removal is a
-- decision already taken. A person reading "your post was removed" when it was
-- actually held has been given the wrong thing to appeal, and the wrong idea
-- of what happened to them.
--
-- ADD VALUE is not transactional-safe to use in the same statement batch that
-- writes it, which is why nothing here inserts one; the writer is application
-- code in a later transaction.
alter type moderation.action_kind add value if not exists 'limit';

comment on type moderation.action_kind is
  'What was decided on a case. Mostly human verbs; ''limit'' is the classifier''s, recorded with actor_staff_id null because no person decided it. An appeal contests one of these rows, so anything that changes what a student sees MUST write one.';

-- ---------------------------------------------------------------------
-- 25.2 Finding a person's own moderation history
-- ---------------------------------------------------------------------
-- GET /v1/me/moderation answers "what was done to my content", which means
-- walking from an app_user to the actions against content they wrote. The
-- authorship tables are the only route — public.post carries no author — and
-- they are indexed by content id, not by user.
--
-- internal.post_author already has (app_user_id) covered for the own-row reads
-- that existed before; comment and review authorship did not need it. These
-- three make the lookup an index scan rather than a sequential one over every
-- piece of authored content in the product.
create index if not exists post_author_user_idx    on internal.post_author (app_user_id);
create index if not exists comment_author_user_idx on internal.comment_author (app_user_id);
create index if not exists review_author_user_idx  on internal.review_author (app_user_id);

-- The queue join: every action against one target, newest first. Without it,
-- rendering a student's moderation history is a scan of the whole action table
-- per row of theirs.
create index if not exists action_target_idx
  on moderation.action (target_type, target_id, created_at desc);

-- The staff appeals queue reads open appeals in the order they arrived.
create index if not exists appeal_open_idx
  on moderation.appeal (created_at) where state = 'open';
