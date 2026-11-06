#!/usr/bin/env bash
# Verifies that the checked-out tree is the dispatched release commit and that
# main has not moved since dispatch. Runs inside the production deploy job,
# after the Production environment approval, so a queued release cannot publish
# a commit that is no longer the head it was approved for.
set -euo pipefail

expected="${EXPECTED_SHA:-${GITHUB_SHA:-}}"
if [ -z "$expected" ]; then
  echo "::error::No expected release SHA was provided."
  exit 1
fi

checked_out=$(git rev-parse HEAD)
echo "Dispatch SHA:  $expected"
echo "Checked out:   $checked_out"
if [ "$checked_out" != "$expected" ]; then
  echo "::error::Checked out $checked_out but this release was dispatched for $expected."
  exit 1
fi

if [ -n "${CI_RESULT:-}" ]; then
  echo "Required CI:   $CI_RESULT"
fi

if ! current_main=$(git ls-remote origin refs/heads/main | cut -f1); then
  echo "::error::Could not read refs/heads/main from origin; refusing to deploy."
  exit 1
fi
if [ -z "$current_main" ]; then
  echo "::error::origin did not return refs/heads/main; refusing to deploy."
  exit 1
fi
if [ "$current_main" != "$expected" ]; then
  echo "::error::main moved to $current_main after this release was dispatched for $expected. Re-dispatch the workflow for the new commit."
  exit 1
fi

echo "Release commit is still the head of main."
