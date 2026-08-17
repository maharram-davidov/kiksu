-- Provenance for scraped vacancies.
--
-- Kiksu aggregates rather than taking applications (docs/08-careers-scope.md),
-- so vacancies arrive from outside and four questions become operational:
-- where did this come from, is it still there, when did we last see it, and
-- which ones has the source dropped?
--
-- Without these columns a re-scrape duplicates everything and a closed
-- position lingers forever. A job board full of dead links is worse than no
-- job board — a student who applies to three closed positions stops trusting
-- the section.
alter table public.vacancy
  add column if not exists source          text,
  add column if not exists source_ref      text,
  add column if not exists source_url      text,
  add column if not exists first_seen_at   timestamptz,
  add column if not exists last_seen_at    timestamptz;

comment on column public.vacancy.source is
  'Origin key, e.g. ''work.az''. NULL for a vacancy entered by hand.';
comment on column public.vacancy.source_ref is
  'Stable id within that source — the slug for work.az. Upsert key.';
comment on column public.vacancy.last_seen_at is
  'Last scrape that still found this vacancy. Absence is how an early close is detected.';

-- The upsert key. Partial so hand-entered vacancies (source null) are not
-- forced to be unique against each other.
create unique index if not exists vacancy_source_ref_uniq
  on public.vacancy (source, source_ref)
  where source is not null and source_ref is not null;

-- The sweeper's query: everything from one source not seen since a cutoff.
create index if not exists vacancy_source_last_seen_idx
  on public.vacancy (source, last_seen_at)
  where source is not null;

-- Employer de-duplication. A scraper reading "Kapital Bank", "Kapital bank"
-- and "KAPITAL BANK" across three pages must resolve to one employer, so the
-- folded name is the key rather than the display name.
alter table public.employer
  add column if not exists name_key text;

update public.employer set name_key = util.fold_handle(name) where name_key is null;

create unique index if not exists employer_name_key_uniq
  on public.employer (name_key) where name_key is not null;
