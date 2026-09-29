#!/usr/bin/env bash
# ============================================================================
# The company-directory suites that need a real database, on a scratch cluster.
#
#   bash scripts/run-company-directory-scratch.sh [test-file ...]
#        (default: every scripts/company-directory-*.test.mjs)
#
# WHAT IT RUNS
#   company-directory-roundtrip.test.mjs     the whole export/import path:
#     generator → CSVs → importer → database → read back → compare, which is
#     the only way to see a column the importer ignores.
#   company-directory-merge-guards.test.mjs  focused fixtures against seeded
#     rows: an existing identity, a verified claim, a member-created company, a
#     domain two companies claim, orphaned feeds.
#
#   One cluster serves both: they need the same schema and neither cares what
#   else is in the database, so a second harness would only be a second thing to
#   keep in step with the migration history.
#
# WHY IT BUILDS ITS OWN DATABASE
#   The importer connects with psql(1), so it needs a server; this script builds
#   one exactly the way supabase/tests/run-local.sh and
#   scripts/bench-company-directory.sh do — schema.sql plus every migration, in
#   order — so the tables, CHECK constraints and unique keys under test are the
#   ones the branch actually ships. schema.sql alone is a partial snapshot and
#   would accept rows a real project rejects.
#
# WHAT IT NEEDS
#   A local PostgreSQL install (initdb, pg_ctl, psql). No Docker, no Supabase
#   CLI, no network, and above all no project database: the cluster lives under
#   /tmp, listens on a unix socket only, and is removed on exit. There is no
#   `supabase` CLI call, no project ref and no connection string anywhere in
#   this file — PGHOST is a socket path, which is what makes "scratch" checkable
#   rather than merely intended.
# ============================================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/uxc-roundtrip"
PGDATA="$WORK/data"
SOCK="$WORK/sock"
DB=uxc_roundtrip
LOG="$WORK/apply.log"

FILES=("$@")
if [ "${#FILES[@]}" -eq 0 ]; then
  FILES=("$ROOT"/scripts/company-directory-*.test.mjs)
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
pg_ctl -D "$PGDATA" -o "-k $SOCK -c listen_addresses=" -l "$WORK/pg.log" -w start >/dev/null 2>&1 \
  || stop_now "postgres failed to start"

PSQL="psql -h $SOCK -U postgres -v ON_ERROR_STOP=0 -q"
$PSQL -d postgres -c "create database $DB" >/dev/null 2>&1 || stop_now "could not create database"

# Supabase-only primitives the migration history expects to exist.
$PSQL -d $DB -c "create role anon; create role authenticated; create role service_role;" >/dev/null 2>&1
$PSQL -d $DB -c "create publication supabase_realtime;" >/dev/null 2>&1
$PSQL -d $DB -c "alter default privileges in schema public grant all on tables to anon, authenticated, service_role;" >/dev/null 2>&1

COUNT=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d " ")
echo "=== 1/2 applying schema.sql and $COUNT migrations ==="
$PSQL -d $DB -f "$ROOT/supabase/schema.sql" >>"$LOG" 2>&1
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "-- $f" >>"$LOG"
  $PSQL -d $DB -f "$f" >>"$LOG" 2>&1
done
$PSQL -d $DB -c "grant all on all tables in schema public to service_role;" >/dev/null 2>&1
echo "--- migration errors (normalised; Supabase-only objects are expected) ---"
grep "ERROR:" "$LOG" | sed "s/^.*ERROR: //" | sed -E "s/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}/UUID/g" | sort | uniq -c | sort -rn | head -5

# The unix socket is the whole point: nothing here is reachable over a network.
export PGHOST="$SOCK"
export PGDATABASE="$DB"
export PGUSER=postgres

echo "=== 2/2 running ${#FILES[@]} company-directory suite(s) ==="
cd "$ROOT" || stop_now "cannot enter the repository root"
STATUS=0
for f in "${FILES[@]}"; do
  echo "────────── $(basename "$f") ──────────"
  node --test "$f" || STATUS=1
done
exit "$STATUS"
