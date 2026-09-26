#!/usr/bin/env bash
# ============================================================================
# Run the SQL tests in this directory against a REAL schema, locally.
#
#   bash supabase/tests/run-local.sh [test-file ...]
#        (default: every supabase/tests/*.test.sql)
#
# WHY THIS EXISTS
#   supabase/schema.sql is a partial snapshot (it does not contain the
#   constraints later migrations add — `communities_enabled_tabs_check` reads no
#   match there). A scratch database built from the snapshot alone therefore
#   accepts SQL that a real project rejects, and a fixture can look green
#   locally while failing with a check-constraint error in the SQL editor. This
#   script applies schema.sql AND every file in supabase/migrations in order, so
#   the constraints, column defaults and functions under test are the real ones.
#
# WHAT IT NEEDS
#   A local PostgreSQL install (initdb, pg_ctl, psql). No Docker, no Supabase
#   CLI, no network. Everything it writes lives in /tmp/uxc-pg and is removed on
#   exit; the scratch cluster listens on a unix socket only, so it cannot clash
#   with a server already using 5432.
#
# LIMITS (read before trusting a green run)
#   * pgTAP is not installed, so plan/ok/is/has_index/has_function/throws_ok/
#     finish are provided as stand-ins. Unlike real pgTAP they print
#     "NOT OK ..." and continue, so one run reports every failure at once.
#   * Migrations needing Supabase-only objects (the `auth` and `storage`
#     schemas, the `companies` table) cannot apply here, so functions defined
#     by them are missing and assertions about those functions report NOT OK.
#     Verify those against a Supabase test project.
#   * A bare Postgres has none of Supabase's project-level default grants, so
#     service_role is granted read access explicitly to keep that assertion
#     meaningful.
# ============================================================================
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK=/tmp/uxc-pg
PGDATA=$WORK/data
SOCK=$WORK/sock
DB=uxc
LOG=$WORK/apply.log

FILES=("$@")
if [ "${#FILES[@]}" -eq 0 ]; then
  FILES=("$ROOT"/supabase/tests/*.test.sql)
fi

cleanup() {
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

stop_now() {
  echo "!! $1"
  exit 1
}

rm -rf "$WORK"
mkdir -p "$PGDATA" "$SOCK"
initdb -D "$PGDATA" -U postgres --encoding=UTF8 -A trust >/dev/null 2>&1 || stop_now "initdb failed"
pg_ctl -D "$PGDATA" -o "-k $SOCK -c listen_addresses= -c wal_level=logical" -l "$WORK/pg.log" -w start >/dev/null 2>&1 || stop_now "postgres failed to start"

PSQL="psql -h $SOCK -U postgres -v ON_ERROR_STOP=0 -q"
$PSQL -d postgres -c "create database $DB" >/dev/null 2>&1 || stop_now "could not create database"

# Supabase-only primitives the migration history expects to exist.
$PSQL -d $DB -c "create role anon; create role authenticated; create role service_role;" >/dev/null 2>&1
$PSQL -d $DB -c "create publication supabase_realtime;" >/dev/null 2>&1
$PSQL -d $DB -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" >/dev/null 2>&1

echo "=== 1/3 applying schema.sql ==="
$PSQL -d $DB -f "$ROOT/supabase/schema.sql" >>"$LOG" 2>&1

COUNT=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d " ")
echo "=== 2/3 applying $COUNT migrations in order ==="
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "-- $f" >>"$LOG"
  $PSQL -d $DB -f "$f" >>"$LOG" 2>&1
done
$PSQL -d $DB -c "grant all on all tables in schema public to service_role;" >/dev/null 2>&1

echo "--- migration errors (normalised; Supabase-only objects are expected) ---"
grep "ERROR:" "$LOG" | sed "s/^.*ERROR: //" | sed -E "s/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/UUID/g" | sort | uniq -c | sort -rn | head -8

echo "=== 3/3 running tests ==="
psql -h "$SOCK" -U postgres -d $DB -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQLEOF'
-- pgTAP stand-in (see LIMITS above).
create or replace function public.plan(n integer) returns text
  language sql as $$ select 'plan ' || n $$;
create or replace function public.ok(cond boolean, description text default '')
  returns text language sql as $$
    select case when cond then 'ok   ' else 'NOT OK ' end || description $$;
create or replace function public.is(got anyelement, expected anyelement, description text default '')
  returns text language sql as $$
    select case
      when got is not distinct from expected then 'ok   ' || description
      else 'NOT OK ' || description || '  [got ' || coalesce(got::text, 'NULL')
           || ', want ' || coalesce(expected::text, 'NULL') || ']'
    end $$;
create or replace function public.has_index(sch text, tbl text, idx text, description text default '')
  returns text language sql as $$
    select case when exists (
      select 1 from pg_indexes where schemaname = sch and tablename = tbl and indexname = idx
    ) then 'ok   ' || description else 'NOT OK ' || description end $$;
create or replace function public.has_function(sch text, fn text, description text default '')
  returns text language sql as $$
    select case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = sch and p.proname = fn
    ) then 'ok   ' || description else 'NOT OK ' || description end $$;
create or replace function public.has_function(sch text, fn text, args text[])
  returns text language sql as $$
    select case when exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = sch and p.proname = fn
    ) then 'ok   ' || fn || '(' || array_to_string(args, ',') || ')' || ' exists'
    else 'NOT OK ' || fn || '(' || array_to_string(args, ',') || ')' || ' exists' end $$;
create or replace function public.throws_ok(sql text, errcode text, errmsg text, description text default '')
  returns text language plpgsql as $$
  declare raised text;
  begin
    begin
      execute sql;
    exception when others then
      get stacked diagnostics raised = returned_sqlstate;
      return case when raised = errcode then 'ok   ' || description
                  else 'NOT OK ' || description || '  [raised ' || raised || ', want ' || errcode || ']' end;
    end;
    return 'NOT OK ' || description || '  [no exception raised]';
  end $$;
create or replace function public.finish() returns text
  language sql as $$ select 'done' $$;

-- Rows the fixtures select from (they insert their own content on top).
insert into public.users (id, name, email, password_hash) values
  ('11111111-1111-1111-1111-111111111111', 'Viewer', 'viewer@example.test', 'x'),
  ('22222222-2222-2222-2222-222222222222', 'Author', 'author@example.test', 'x'),
  ('33333333-3333-3333-3333-333333333333', 'Third', 'third@example.test', 'x')
on conflict (id) do nothing;

insert into public.communities (id, name, type, is_active) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Fixture A', 'interest', true),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'Fixture B', 'interest', true),
  ('cccccccc-0000-0000-0000-00000000000c', 'Fixture C', 'interest', true),
  ('dddddddd-0000-0000-0000-00000000000d', 'Fixture D', 'interest', true)
on conflict (id) do nothing;

-- Oldest membership becomes the sidebar fixture's community A / viewer pair.
insert into public.community_members (community_id, user_id, joined_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', now() - interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', now() - interval '25 days')
on conflict (community_id, user_id) do nothing;
SQLEOF

FAILED=0
for f in "${FILES[@]}"; do
  NAME=$(basename "$f")
  RUN=$WORK/run-$NAME
  sed "/create extension if not exists pgtap/d" "$f" > "$RUN"
  echo "────────── $NAME ──────────"
  OUT=$(psql -h "$SOCK" -U postgres -d $DB -v ON_ERROR_STOP=1 -q -f "$RUN" 2>&1)
  STATUS=$?
  echo "$OUT" | grep -E "NOT OK|ERROR|DETAIL" | sed "s/^ *//" | head -25
  OKS=$(echo "$OUT" | grep -cE "^ *ok   ")
  BADS=$(echo "$OUT" | grep -cE "NOT OK")
  echo "   ok: $OKS   failed: $BADS   psql exit: $STATUS"
  if [ "$STATUS" -ne 0 ] || [ "$BADS" -ne 0 ]; then FAILED=1; fi
done

echo "────────── $([ "$FAILED" -eq 0 ] && echo "all files clean" || echo "see failures above") ──────────"
exit "$FAILED"
