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


