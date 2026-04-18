#!/bin/bash
# Optimized benchmark script for pre-commit checks
# Runs independent checks in parallel

set -e

cd "$(dirname "$0")/.."

get_ms() {
  python3 -c "import time; print(int(time.time() * 1000))"
}

START=$(get_ms)

# Create temp files for results
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# 1. lint-staged (must run first, quick)
S1=$(get_ms)
bunx lint-staged 2>&1 || true
E1=$(get_ms)
LINT_MS=$((E1-S1))

# Run these 3 in parallel:
# - typecheck
# - worker tests  
# - rust checks

S_PARALLEL=$(get_ms)

# Typecheck in background
(
  S=$(get_ms)
  bun run typecheck 2>&1
  E=$(get_ms)
  echo $((E-S)) > "$TEMP_DIR/typecheck_ms"
) &
PID_TYPECHECK=$!

# Worker tests in background
(
  S=$(get_ms)
  cd apps/worker && bun test 2>&1
  E=$(get_ms)
  echo $((E-S)) > "$TEMP_DIR/worker_ms"
) &
PID_WORKER=$!

# Rust checks in background
(
  S=$(get_ms)
  if [ -f "packages/cli-rs/Cargo.toml" ]; then
    cd packages/cli-rs
    cargo fmt --check --all 2>&1
    cargo clippy --all-targets --all-features -- -D warnings 2>&1
    cargo test --workspace 2>&1
    cd ../..
  fi
  E=$(get_ms)
  echo $((E-S)) > "$TEMP_DIR/rust_ms"
) &
PID_RUST=$!

# Wait for all parallel jobs
wait $PID_TYPECHECK
wait $PID_WORKER
wait $PID_RUST

E_PARALLEL=$(get_ms)

END=$(get_ms)

# Read individual timings
TYPECHECK_MS=$(cat "$TEMP_DIR/typecheck_ms")
WORKER_MS=$(cat "$TEMP_DIR/worker_ms")
RUST_MS=$(cat "$TEMP_DIR/rust_ms")

# Output metrics for autoresearch
echo "METRIC lint_staged_ms=$LINT_MS"
echo "METRIC typecheck_ms=$TYPECHECK_MS"
echo "METRIC worker_test_ms=$WORKER_MS"
echo "METRIC rust_ms=$RUST_MS"
echo "METRIC parallel_ms=$((E_PARALLEL-S_PARALLEL))"
echo "METRIC total_ms=$((END-START))"
