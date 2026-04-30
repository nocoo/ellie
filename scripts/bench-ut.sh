#!/bin/bash
# Benchmark unit test wall time + per-project breakdown.
set -uo pipefail
cd "$(dirname "$0")/.."

t0=$(date +%s%N)
out=$(bun run test 2>&1)
exit_code=$?
t1=$(date +%s%N)
total_ms=$(( (t1 - t0) / 1000000 ))

vitest_dur_str=$(echo "$out" | grep -oE 'Duration[[:space:]]+[0-9]+\.?[0-9]*(ms|s)' | head -1)
vitest_dur_val=$(echo "$vitest_dur_str" | grep -oE '[0-9.]+(ms|s)' | head -1)
vitest_ms=$(awk -v v="$vitest_dur_val" 'BEGIN{ if (index(v,"ms")) { sub("ms","",v); printf "%d", v } else if (index(v,"s")) { sub("s","",v); printf "%d", v*1000 } else { print 0 } }')
bun_dur_str=$(echo "$out" | grep -oE 'Ran [0-9]+ tests across [0-9]+ files\.[[:space:]]*\[[0-9.]+(ms|s)\]' | head -1)
bun_ms_val=$(echo "$bun_dur_str" | grep -oE '[0-9.]+(ms|s)\]' | head -1 | sed 's/\]$//')
bun_ms=$(awk -v v="$bun_ms_val" 'BEGIN{ if (index(v,"ms")) { sub("ms","",v); printf "%d", v } else if (index(v,"s")) { sub("s","",v); printf "%d", v*1000 } else { print 0 } }')
total_tests=$(echo "$out" | grep -oE 'Tests[[:space:]]+[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
bun_tests=$(echo "$out" | grep -oE '[0-9]+ pass' | tail -1 | grep -oE '[0-9]+')
fail_count=$(echo "$out" | grep -oE 'Tests[[:space:]]+[0-9]+ failed' | grep -oE '[0-9]+' | head -1)


echo "vitest=${vitest_ms}ms  bun=${bun_ms}ms  total=${total_ms}ms"
echo "vitest_tests=${total_tests:-0}  bun_tests=${bun_tests:-0}  fail=${fail_count:-0}"
echo "METRIC total_ms=$total_ms"
echo "METRIC vitest_ms=$vitest_ms"
echo "METRIC bun_ms=$bun_ms"
echo "METRIC vitest_tests=${total_tests:-0}"
echo "METRIC bun_tests=${bun_tests:-0}"

# Audit meaningfulness (after timing, ~50ms)
node scripts/audit-tests.mjs 2>/dev/null || true

if [ "$exit_code" -ne 0 ] || [ -n "${fail_count:-}" ] && [ "${fail_count:-0}" != "0" ]; then
  echo "FAIL exit=$exit_code fails=${fail_count:-0}" >&2
  exit 1
fi
exit 0
