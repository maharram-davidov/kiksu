#!/usr/bin/env bash
# Applies the full schema to a throwaway PostgreSQL instance and asserts the
# architectural invariants. Exits non-zero on any error or violation.
#
# Three of the four defects found during stage 1 were invisible to review and
# instant to catch by execution. Run this before committing any migration.
set -euo pipefail

export LANG=C LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@16/bin}"
RUN="/tmp/kiksu-verify-$$"
PORT="${PGPORT:-54401}"

cleanup() {
  "$PGBIN/pg_ctl" -D "$RUN/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$RUN"
}
trap cleanup EXIT

command -v "$PGBIN/initdb" >/dev/null || { echo "postgres not found at $PGBIN (set PGBIN)"; exit 2; }

mkdir -p "$RUN/data"
# LC_COLLATE=C for deterministic ordering; LC_CTYPE must be UTF-8 or lower()
# only touches ASCII and util.fold_text() leaves every uppercase Azerbaijani
# letter unfolded ('Nigar Əliyeva' -> 'nigar Əliyeva'), which makes search
# silently miss. See scripts/test-integration.sh for the full explanation.
"$PGBIN/initdb" -D "$RUN/data" -U postgres --no-sync -A trust \
  --lc-collate=C --lc-ctype=C.UTF-8 --encoding=UTF8 >/dev/null
"$PGBIN/pg_ctl" -D "$RUN/data" -o "-p $PORT -k $RUN" -l "$RUN/pg.log" start >/dev/null
for _ in $(seq 1 20); do
  "$PGBIN/pg_isready" -h "$RUN" -p "$PORT" >/dev/null 2>&1 && break
  sleep 0.5
done

PSQL=("$PGBIN/psql" -h "$RUN" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

# Supabase surface the schema expects but a bare Postgres does not have.
"${PSQL[@]}" <<'STUB'
create schema if not exists extensions;
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin bypassrls; end if;
end $$;
create table if not exists auth.users(id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
STUB

echo "==> applying schema"
if ! "${PSQL[@]}" -f "$ROOT/docs/01-schema.sql" >"$RUN/apply.log" 2>&1; then
  echo "SCHEMA FAILED TO APPLY:"; grep -i error "$RUN/apply.log" | head -20; exit 1
fi

echo "==> asserting invariants"
"${PSQL[@]}" -f "$ROOT/scripts/schema-invariants.sql"

"${PSQL[@]}" -tAc "
select 'tables='||(select count(*) from pg_tables where schemaname in
        ('public','ref','internal','identity','career','moderation','util'))
     ||' indexes='||(select count(*) from pg_indexes where schemaname in
        ('public','ref','internal','identity','career','moderation'))
     ||' policies='||(select count(*) from pg_policies)
     ||' triggers='||(select count(*) from pg_trigger where not tgisinternal);"

echo "==> OK"
