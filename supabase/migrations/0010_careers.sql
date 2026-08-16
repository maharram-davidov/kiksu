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


