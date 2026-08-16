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


