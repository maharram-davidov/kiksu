#!/usr/bin/env bash
# Applies migrations + seed to a throwaway PostgreSQL, then asserts the
# invariants still hold with data present. Run this before applying seed
# changes to any real database.
set -euo pipefail
export LANG=C LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
RUN="/tmp/kiksu-seed-$$"; PORT="${PGPORT:-54410}"
cleanup(){ "$PGBIN/pg_ctl" -D "$RUN/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$RUN"; }
trap cleanup EXIT

mkdir -p "$RUN/data"
"$PGBIN/initdb" -D "$RUN/data" -U postgres --no-sync -A trust --locale=C --encoding=UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$RUN/data" -o "-p $PORT -k $RUN" -l "$RUN/pg.log" start >/dev/null
for _ in $(seq 1 20); do "$PGBIN/pg_isready" -h "$RUN" -p "$PORT" >/dev/null 2>&1 && break; sleep 0.5; done
PSQL=("$PGBIN/psql" -h "$RUN" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" <<'STUB'
create schema if not exists extensions; create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create table if not exists auth.users(id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
STUB

echo "==> migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  "${PSQL[@]}" -f "$f" >/dev/null 2>>"$RUN/err.log" || { echo "FAILED: $(basename "$f")"; tail -20 "$RUN/err.log"; exit 1; }
done

echo "==> seed (first run)"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null

echo "==> seed (second run — must be idempotent)"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null

echo "==> content seed (first run)"
"${PSQL[@]}" -f "$ROOT/supabase/seed-content.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/seed-commerce.sql" >/dev/null

# Twice, like seed.sql above. These two were only ever run once, so the
# "proves idempotency" claim never covered them at all.
#
# READ THE COUNTS: seed.sql IS idempotent and the reference-data rows below
# hold steady. seed-content.sql is NOT — posts, comments, reviews, listings and
# vacancies all double on this second pass, because they have no natural
# conflict key and never had a guard. That is pre-existing and is not fixed
# here; it is surfaced rather than hidden, because a script named for
# idempotency that quietly skipped two of the three seed files was worse.
#
# The identity and moderation rows this script now counts DO hold steady --
# they are guarded explicitly in seed-content.sql.
echo "==> content seed (second run — reference data must hold; content is known to double)"
"${PSQL[@]}" -f "$ROOT/supabase/seed-content.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/seed-commerce.sql" >/dev/null

echo "==> invariants with data present"
"${PSQL[@]}" -f "$ROOT/scripts/schema-invariants.sql"

echo "==> row counts"
"${PSQL[@]}" -tAF'  ' <<'COUNTS'
select 'university', count(*) from ref.university
union all select 'email_domain', count(*) from ref.university_email_domain
union all select 'term',        count(*) from ref.term
union all select 'faculty',     count(*) from ref.faculty
union all select 'instructor',  count(*) from ref.instructor
union all select 'course',      count(*) from ref.course
union all select 'section',     count(*) from ref.course_section
union all select 'meeting',     count(*) from ref.section_meeting
union all select 'room',        count(*) from ref.room
union all select 'board',       count(*) from public.board
union all select 'app_user',    count(*) from public.app_user
union all select 'post',        count(*) from public.post
union all select 'comment',     count(*) from public.post_comment
union all select 'review',      count(*) from public.review
union all select 'listing',     count(*) from public.listing
union all select 'employer',    count(*) from public.employer
union all select 'vacancy',     count(*) from public.vacancy
-- The identity and moderation rows seed-content adds for the admin console.
-- They are counted HERE specifically because they were the seed's first
-- inserts with no natural conflict key, which is exactly the shape that
-- silently doubles on a second run.
union all select 'verif_attempt', count(*) from identity.verification_attempt
union all select 'subject',      count(*) from identity.subject
union all select 'mod_case',     count(*) from moderation.mod_case
order by 1;
COUNTS
echo "==> OK"
