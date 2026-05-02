#!/usr/bin/env bash
# Run vitest and bun:test in parallel; aggregate exit codes.
set -uo pipefail
cd "$(dirname "$0")/.."

vlog=$(mktemp); blog=$(mktemp); tlog=$(mktemp); elog=$(mktemp)
trap 'rm -f "$vlog" "$blog" "$tlog" "$elog"' EXIT

node_modules/.bin/vitest run --no-color --experimental.fsModuleCache --silent=passed-only >"$vlog" 2>&1 &
v=$!
# email.test.ts uses `mock.module(...)` to stub BOTH `src/lib/dove` and
# `src/lib/turnstile` at module top-level. bun's `mock.module` is process-global,
# so running email.test.ts in the same `bun test` invocation as dove.test.ts or
# turnstile.test.ts (which exercise the REAL modules) leaks the stubs into
# those files. Keep each in SEPARATE `bun test` processes to isolate scope.
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
bun test \
  "$PWD/apps/worker/tests/unit/lib/turnstile.test.ts" \
  >"$tlog" 2>&1 &
t=$!

wait "$v"; ve=$?
wait "$b"; be=$?
wait "$e"; ee=$?
wait "$t"; te=$?

cat "$vlog"; echo; cat "$blog"; echo; cat "$elog"; echo; cat "$tlog"

if [ "$ve" -ne 0 ] || [ "$be" -ne 0 ] || [ "$ee" -ne 0 ] || [ "$te" -ne 0 ]; then
  echo "FAIL vitest=$ve bun=$be email=$ee turnstile=$te" >&2
  exit 1
fi
