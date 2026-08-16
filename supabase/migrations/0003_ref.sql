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


