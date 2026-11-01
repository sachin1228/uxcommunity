#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="$(cat "$ROOT/supabase/cli-version")"
python3 -c 'import sys; sys.path.insert(0, sys.argv[1]); from test_fresh import validate_migrations; validate_migrations()' "$ROOT/scripts/db"
# Use this checkout even when called from apps/web; an explicit disposable
# --workdir supplied by the test harness takes precedence.
cd "$ROOT"
python3 "$ROOT/scripts/db/guard.py" "$ROOT" "$@"
exec npx --yes "supabase@$VERSION" "$@"
