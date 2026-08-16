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


