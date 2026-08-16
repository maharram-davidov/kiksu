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


