#!/usr/bin/env bash
# One command to run the API locally against a real, seeded database.
#
# Stands up a throwaway PostgreSQL, applies every migration and both seeds,
# writes apps/api/.env with development values, then runs the API in watch mode.
# The database lives only as long as this script; Ctrl+C removes it.
#
# Nothing here touches the remote Supabase project.
set -euo pipefail
export LANG=C LC_ALL=C

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
RUN="/tmp/kiksu-dev-$$"
PGPORT="${KIKSU_PGPORT:-54420}"
APIPORT="${KIKSU_API_PORT:-3000}"

cleanup() {
  echo ""
  echo "==> stopping database"
  # -m immediate, and then a hard kill of anything still bound to the port.
  # Killing this script does not necessarily reap the postgres it started, and
  # a survivor silently holds the port so the NEXT run fails at initdb with a
  # message that says nothing about the real cause.
  "$PGBIN/pg_ctl" -D "$RUN/data" stop -m immediate >/dev/null 2>&1 || true
  lsof -ti ":$PGPORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  rm -rf "$RUN"
}
trap cleanup EXIT INT TERM

command -v "$PGBIN/initdb" >/dev/null || { echo "postgres not found at $PGBIN (set PGBIN)"; exit 2; }

# Clear a leftover from a previous run that was killed rather than exited.
# Without this the next run fails inside pg_ctl with "could not start server",
# which gives no hint that the cause is an orphan holding the port.
if lsof -ti ":$PGPORT" >/dev/null 2>&1; then
  echo "==> clearing a leftover database on port $PGPORT"
  lsof -ti ":$PGPORT" | xargs kill -9 2>/dev/null || true
  rm -rf /tmp/kiksu-dev-* 2>/dev/null || true
  sleep 1
fi

if lsof -ti ":$APIPORT" >/dev/null 2>&1; then
  echo "==> port $APIPORT is already in use; stop the other API first" >&2
  exit 2
fi

echo "==> starting database on port $PGPORT"
mkdir -p "$RUN/data"
"$PGBIN/initdb" -D "$RUN/data" -U postgres --no-sync -A trust --locale=C --encoding=UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$RUN/data" -o "-p $PGPORT -k $RUN -h 127.0.0.1" -l "$RUN/pg.log" start >/dev/null
for _ in $(seq 1 20); do
  "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1 && break
  sleep 0.5
done

PSQL=("$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
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

echo "==> applying migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
echo "==> seeding"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/seed-content.sql" >/dev/null

DB_URL="postgresql://postgres@127.0.0.1:$PGPORT/postgres"

# Pick a seeded student to develop as. There is no Supabase JWKS endpoint
# locally, so without this every authenticated route is unreachable and no
# screen can be built against real data. parseEnv() refuses to boot if these
# are ever set with NODE_ENV=production.
DEV_IDS=$("${PSQL[@]}" -tAF' ' <<'IDQ'
select au.id, au.university_id
  from public.app_user au
  join ref.university u on u.id = au.university_id and u.code = 'BDU'
 order by au.handle limit 1;
IDQ
)
DEV_APP_USER_ID=$(echo "$DEV_IDS" | awk '{print $1}')
DEV_UNIVERSITY_ID=$(echo "$DEV_IDS" | awk '{print $2}')

# Enrol that student in everything, so the timetable screen has content.
"${PSQL[@]}" >/dev/null <<ENROLQ
insert into public.enrollment (app_user_id, section_id, term_id, state)
select '$DEV_APP_USER_ID', s.id, s.term_id, 'enrolled'
  from ref.course_section s
  join ref.course c on c.id = s.course_id
 where c.university_id = '$DEV_UNIVERSITY_ID'
on conflict do nothing;
ENROLQ

# Written fresh each run. Development values only — no real Supabase project is
# involved, and the identity URL points at the same database because there are
# no separate roles locally. That collapses the Layer 1 boundary, which
# IdentitySqlProvider warns about and refuses outright in production. The
# boundary itself is verified by invariant 1 against the real grants, not here.
cat > "$ROOT/apps/api/.env" <<ENVEOF
NODE_ENV=development
PORT=$APIPORT

DATABASE_URL=$DB_URL
DATABASE_URL_IDENTITY=$DB_URL
DATABASE_POOL_MAX=10

CREDENTIAL_PEPPER=dev-only-pepper-not-for-any-real-deployment-32+
CURSOR_HMAC_SECRET=dev-only-cursor-secret-not-for-production-32+

SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=dev-placeholder-service-role-key
SUPABASE_JWT_AUDIENCE=authenticated

IDEMPOTENCY_STORE=memory
RATE_LIMIT_STORE=memory

# DEVELOPMENT ONLY. Every request is served as this student, with no token.
# parseEnv() refuses to boot if either is set while NODE_ENV=production.
DEV_AUTH_APP_USER_ID=$DEV_APP_USER_ID
DEV_AUTH_UNIVERSITY_ID=$DEV_UNIVERSITY_ID

IOS_STORE_URL=https://apps.apple.com/az/app/kiksu/id000000000
ANDROID_STORE_URL=https://play.google.com/store/apps/details?id=az.kiksu.mobile
MIN_SUPPORTED_CLIENT_IOS=0.1.0
MIN_SUPPORTED_CLIENT_ANDROID=0.1.0
RECOMMENDED_CLIENT_IOS=0.1.0
RECOMMENDED_CLIENT_ANDROID=0.1.0
ENVEOF

echo "==> database ready, .env written"
echo "==> developing as app_user $DEV_APP_USER_ID (BDU, email tier, no token needed)"
echo "==> API starting on http://localhost:$APIPORT  (Ctrl+C stops everything)"
echo ""
cd "$ROOT/apps/api"
npm run dev
