#!/usr/bin/env bash
# ============================================================================
# The directory benchmark, on a scratch database built from the real schema.
#
#   bash scripts/bench-company-directory.sh [tiers]
#        (default tiers: 1000,10000,100000,500000)
#
# WHY IT BUILDS ITS OWN DATABASE
#   The numbers that matter are for `public.search_companies` and for the real
#   importer, so the schema has to be the one this branch ships: schema.sql plus
#   every migration in order, exactly as supabase/tests/run-local.sh builds it.
#   Nothing here touches a project database, the cluster listens on a unix
#   socket only, and it is removed on exit.
#
#   The rows are synthetic and marked `source = 'bench'`. They exist to measure
#   index shapes and latency, never to be imported anywhere; every tier is
#   deleted before the next one is loaded.
#
# WHAT IT PRINTS
#   per tier: rows imported, load time, the idempotent re-run, how many of the
#   claims ended up verified (must be zero), search latency for five queries,
#   and the sequential-scan count per search arm.
# ============================================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/uxc-bench"
PGDATA="$WORK/data"
SOCK="$WORK/sock"
DB=uxc_bench
LOG="$WORK/apply.log"
TIERS="${1:-1000,10000,100000,500000}"

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
pg_ctl -D "$PGDATA" -o "-k $SOCK -c listen_addresses= -c shared_buffers=128MB" -l "$WORK/pg.log" -w start >/dev/null 2>&1 \
  || stop_now "postgres failed to start"

PSQL="psql -h $SOCK -U postgres -v ON_ERROR_STOP=0 -q"
$PSQL -d postgres -c "create database $DB" >/dev/null 2>&1 || stop_now "could not create database"

# Supabase-only primitives the migration history expects to exist, plus the
# roles the grants name.
$PSQL -d $DB -c "create role anon; create role authenticated; create role service_role;" >/dev/null 2>&1
$PSQL -d $DB -c "create publication supabase_realtime;" >/dev/null 2>&1
$PSQL -d $DB -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" >/dev/null 2>&1

echo "=== applying schema.sql and every migration ==="
$PSQL -d $DB -f "$ROOT/supabase/schema.sql" >>"$LOG" 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "-- $f" >>"$LOG"
  $PSQL -d $DB -f "$f" >>"$LOG" 2>&1
done
$PSQL -d $DB -c "grant all on all tables in schema public to service_role;" >/dev/null 2>&1
echo "--- errors (normalised; Supabase-only objects are expected) ---"
grep "ERROR:" "$LOG" | sed "s/^.*ERROR: //" | sed -E "s/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/UUID/g" | sort | uniq -c | sort -rn | head -5

export PGHOST="$SOCK" PGDATABASE="$DB" PGUSER=postgres
cd "$ROOT" || exit 1
node scripts/bench-company-directory.mjs --tiers "$TIERS"
