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


