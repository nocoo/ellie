#!/bin/bash
# Benchmark unit test wall time + per-project breakdown
# Outputs METRIC lines for autoresearch.
set -eo pipefail
cd "$(dirname "$0")/.."

t0=$(date +%s%N)
out=$(bun run test 2>&1)
t1=$(date +%s%N)
total_ms=$(( (t1 - t0) / 1000000 ))

# Vitest reports a single "Duration" line for combined projects.
vitest_dur=$(echo "$out" | grep -oE 'Duration[[:space:]]+[0-9]+\.?[0-9]*s' | head -1 | grep -oE '[0-9]+\.?[0-9]*')
bun_dur=$(echo "$out" | grep -oE 'Ran [0-9]+ tests across [0-9]+ files\.[[:space:]]*\[[0-9.]+s\]' | grep -oE '\[[0-9.]+s' | tr -d '[s')

# Counts
total_tests=$(echo "$out" | grep -oE 'Tests[[:space:]]+[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
bun_tests=$(echo "$out" | grep -oE '[0-9]+ pass' | tail -1 | grep -oE '[0-9]+')

vitest_ms=$(awk -v v="${vitest_dur:-0}" 'BEGIN{printf "%d", v*1000}')
bun_ms=$(awk -v v="${bun_dur:-0}" 'BEGIN{printf "%d", v*1000}')

echo "$out" | tail -50
echo ""
echo "METRIC total_ms=$total_ms"
echo "METRIC vitest_ms=$vitest_ms"
echo "METRIC bun_ms=$bun_ms"
echo "METRIC vitest_tests=${total_tests:-0}"
echo "METRIC bun_tests=${bun_tests:-0}"
