#!/usr/bin/env bash
# Stands up a throwaway Postgres with migrations + seed, then runs the API's
# integration tests against it. Nothing touches a real database.
set -euo pipefail
export LANG=C LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
RUN="/tmp/kiksu-itest-$$"; PORT="${PGPORT:-54412}"
cleanup(){ "$PGBIN/pg_ctl" -D "$RUN/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$RUN"; }
trap cleanup EXIT

mkdir -p "$RUN/data"
"$PGBIN/initdb" -D "$RUN/data" -U postgres --no-sync -A trust --locale=C --encoding=UTF8 >/dev/null
# listen on TCP as well as the socket, since node connects over TCP
"$PGBIN/pg_ctl" -D "$RUN/data" -o "-p $PORT -k $RUN -h 127.0.0.1" -l "$RUN/pg.log" start >/dev/null
for _ in $(seq 1 20); do "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PORT" >/dev/null 2>&1 && break; sleep 0.5; done
PSQL=("$PGBIN/psql" -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

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

for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" >/dev/null; done
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql" >/dev/null
"${PSQL[@]}" -f "$ROOT/supabase/seed-content.sql" >/dev/null
echo "==> database ready on 127.0.0.1:$PORT"

cd "$ROOT/apps/api"
DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/postgres" npx vitest run "$@"
