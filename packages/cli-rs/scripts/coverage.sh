#!/usr/bin/env bash
# Coverage report for the Rust CLI workspace.
# Requires: cargo install cargo-llvm-cov && rustup component add llvm-tools-preview
#
# Usage:
#   ./scripts/coverage.sh          # run with 90% threshold (default)
#   ./scripts/coverage.sh --html   # also generate HTML report
#   COVERAGE_THRESHOLD=80 ./scripts/coverage.sh  # custom threshold

set -euo pipefail

THRESHOLD="${COVERAGE_THRESHOLD:-90}"
GENERATE_HTML=false

for arg in "$@"; do
  case "$arg" in
    --html) GENERATE_HTML=true ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

cd "$(dirname "$0")/.."

echo "=== Running tests with coverage ==="

# Ignore patterns:
# - main.rs: entry point, not unit-testable
# - actions.rs: network I/O dispatch, covered by L2 integration tests
IGNORE="--ignore-filename-regex=(main|actions)\\.rs"

# Generate JSON summary for machine parsing
cargo llvm-cov --workspace $IGNORE --json > /tmp/ellie-cli-cov.json 2>/dev/null

# Also print human-readable summary
cargo llvm-cov --workspace $IGNORE 2>/dev/null

if [ "$GENERATE_HTML" = true ]; then
  echo ""
  echo "=== Generating HTML report ==="
  cargo llvm-cov --workspace $IGNORE --html 2>/dev/null
  echo "HTML report: target/llvm-cov/html/index.html"
fi

# Extract line coverage percentage from JSON
# The totals.lines.percent field gives us the overall line coverage
LINE_COV=$(python3 -c "
import json, sys
with open('/tmp/ellie-cli-cov.json') as f:
    data = json.load(f)
pct = data['data'][0]['totals']['lines']['percent']
print(f'{pct:.1f}')
")

echo ""
echo "=== Coverage: ${LINE_COV}% (threshold: ${THRESHOLD}%) ==="

# Compare as integers (bash doesn't do floats)
COV_INT=$(python3 -c "print(int(float('${LINE_COV}')))")

if [ "$COV_INT" -lt "$THRESHOLD" ]; then
  echo "FAIL: Coverage ${LINE_COV}% is below ${THRESHOLD}% threshold"
  exit 1
else
  echo "PASS: Coverage ${LINE_COV}% meets ${THRESHOLD}% threshold"
fi
