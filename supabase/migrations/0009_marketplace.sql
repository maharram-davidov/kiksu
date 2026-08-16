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
  constraint chat_message_content_ck check (body is not null or storage_path is not null or kind = 'system')
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


