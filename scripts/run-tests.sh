#!/usr/bin/env bash
# Run vitest and bun:test in parallel; aggregate exit codes.
set -uo pipefail
cd "$(dirname "$0")/.."

vlog=$(mktemp); blog=$(mktemp)
trap 'rm -f "$vlog" "$blog"' EXIT

node_modules/.bin/vitest run --no-color --silent=passed-only >"$vlog" 2>&1 &
v=$!
# bun:sqlite-bound migrate scripts stay on the bun runner permanently —
# vitest cannot import bun:sqlite. The worker dove / email-verify /
# handlers/email suites that used to live here were migrated to vitest in
# Phase 2A.
bun test \
  "$PWD/tests/unit/loader.test.ts" \
  "$PWD/tests/unit/verify.test.ts" \
  "$PWD/tests/unit/migration-0029-schema.test.ts" \
  "$PWD/tests/unit/migration-0036-schema.test.ts" \
  >"$blog" 2>&1 &
b=$!

wait "$v"; ve=$?
wait "$b"; be=$?

cat "$vlog"; echo; cat "$blog"

if [ "$ve" -ne 0 ] || [ "$be" -ne 0 ]; then
  echo "FAIL vitest=$ve bun=$be" >&2
  exit 1
fi
