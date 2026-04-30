#!/usr/bin/env bash
# Run vitest and bun tests in parallel; aggregate exit codes.
set -uo pipefail
cd "$(dirname "$0")/.."

vitest_log=$(mktemp)
bun_log=$(mktemp)
trap 'rm -f "$vitest_log" "$bun_log"' EXIT

node_modules/.bin/vitest run --no-color >"$vitest_log" 2>&1 &
v_pid=$!

bun test tests/unit/loader.test.ts tests/unit/verify.test.ts >"$bun_log" 2>&1 &
b_pid=$!

wait "$v_pid"; v_exit=$?
wait "$b_pid"; b_exit=$?

cat "$vitest_log"
echo ""
cat "$bun_log"

if [ "$v_exit" -ne 0 ] || [ "$b_exit" -ne 0 ]; then
  echo "FAIL vitest=$v_exit bun=$b_exit" >&2
  exit 1
fi
