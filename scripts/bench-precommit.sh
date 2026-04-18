#!/bin/bash
# Benchmark script for pre-commit hook
# Tests full pre-commit performance with parallel execution

set -e

cd "$(dirname "$0")/.."

get_ms() {
  python3 -c "import time; print(int(time.time() * 1000))"
}

# Create temp dir for metric files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Track PIDs for parallel execution (matching pre-commit structure)
declare -a PIDS=()

START=$(get_ms)

# lint-staged
(
  S=$(get_ms)
  bunx lint-staged 2>&1 || true
  E=$(get_ms)
  echo $((E-S)) > "$TEMP_DIR/lint_ms"
) &
PIDS+=($!)

# Typecheck
(
  S=$(get_ms)
  bun run typecheck 2>&1
  E=$(get_ms)
  echo $((E-S)) > "$TEMP_DIR/typecheck_ms"
) &
PIDS+=($!)

# Worker tests
(
  S=$(get_ms)
  cd apps/worker && bun test --concurrent 2>&1
  E=$(get_ms)
  echo $((E-S)) > "$TEMP_DIR/worker_ms"
) &
PIDS+=($!)

# Rust checks (all three in parallel)
(
  S=$(get_ms)
  if [ -f "packages/cli-rs/Cargo.toml" ]; then
    cd packages/cli-rs
    cargo fmt --check --all 2>&1 &
    cargo clippy --all-targets --all-features -- -D warnings 2>&1 &
    cargo test --workspace 2>&1 &
    wait
  fi
  E=$(get_ms)
  echo $((E-S)) > "$TEMP_DIR/rust_ms"
) &
PIDS+=($!)

# Wait for all
for pid in "${PIDS[@]}"; do
  wait $pid
done

END=$(get_ms)

# Read timings
echo "METRIC lint_staged_ms=$(cat $TEMP_DIR/lint_ms)"
echo "METRIC typecheck_ms=$(cat $TEMP_DIR/typecheck_ms)"
echo "METRIC worker_test_ms=$(cat $TEMP_DIR/worker_ms)"
echo "METRIC rust_ms=$(cat $TEMP_DIR/rust_ms)"
echo "METRIC total_ms=$((END-START))"
