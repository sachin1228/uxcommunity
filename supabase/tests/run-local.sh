#!/usr/bin/env bash
# Real disposable Supabase; active migrations only. Never replays archived SQL.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec python3 "$ROOT/scripts/db/test_fresh.py" "$@"
