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


