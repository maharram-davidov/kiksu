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


