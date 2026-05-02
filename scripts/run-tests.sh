#!/usr/bin/env bash
# Run vitest and bun:test in parallel; aggregate exit codes.
set -uo pipefail
cd "$(dirname "$0")/.."

vlog=$(mktemp); blog=$(mktemp); elog=$(mktemp)
trap 'rm -f "$vlog" "$blog" "$elog"' EXIT

node_modules/.bin/vitest run --no-color --experimental.fsModuleCache --silent=passed-only >"$vlog" 2>&1 &
v=$!
# email.test.ts uses `mock.module(...)` to stub `src/lib/dove` at module
# top-level. bun's `mock.module` is process-global, so running email.test.ts
# in the same `bun test` invocation as dove.test.ts (which exercises the REAL
# module) leaks the stubs. Keep each in SEPARATE `bun test` processes.
bun test \
  "$PWD/tests/unit/loader.test.ts" \
  "$PWD/tests/unit/verify.test.ts" \
  "$PWD/tests/unit/migration-0029-schema.test.ts" \
  "$PWD/apps/worker/tests/unit/lib/dove.test.ts" \
  "$PWD/apps/worker/tests/unit/lib/email-verify.test.ts" \
  >"$blog" 2>&1 &
b=$!
bun test \
  "$PWD/apps/worker/tests/unit/handlers/email.test.ts" \
  >"$elog" 2>&1 &
e=$!

wait "$v"; ve=$?
wait "$b"; be=$?
wait "$e"; ee=$?

cat "$vlog"; echo; cat "$blog"; echo; cat "$elog"

if [ "$ve" -ne 0 ] || [ "$be" -ne 0 ] || [ "$ee" -ne 0 ]; then
  echo "FAIL vitest=$ve bun=$be email=$ee" >&2
  exit 1
fi
