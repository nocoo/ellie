#!/usr/bin/env bash
# Autoresearch backpressure: lightweight gates that catch obvious breakage
# without paying the full L3 bench cost twice. Runs after every passing
# benchmark in run_experiment.
set -euo pipefail
cd "$(dirname "$0")"

{
  # Typecheck the whole monorepo — catches type regressions introduced by new
  # test fixtures / page-object helpers.
  bash scripts/typecheck.sh

  # Biome on the e2e dir only — full repo lint is slow and not the gate's job.
  # `--no-errors-on-unmatched` keeps this resilient if the dir is empty.
  bunx biome check --error-on-warnings tests/e2e || {
    echo "[checks] biome failed on tests/e2e"
    exit 1
  }
} >/tmp/autoresearch_checks.log 2>&1
