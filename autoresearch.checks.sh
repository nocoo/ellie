#!/usr/bin/env bash
# Autoresearch gate: ensure handler/lib unit tests still pass after each kept change.
# Runs only the worker tests most relevant to list-loading optimisations.
# Full L1 (`bun run test`) should be invoked manually before a major refactor PR.
set -euo pipefail
cd "$(dirname "$0")"

bunx vitest run --experimental.fsModuleCache \
  -c apps/worker/vitest.config.ts \
  tests/unit/handlers/forum.test.ts \
  tests/unit/handlers/thread.test.ts \
  tests/unit/handlers/forum-cache-avatar.test.ts \
  tests/unit/handlers/forum-ancestors.test.ts \
  tests/unit/lib >/tmp/autoresearch_checks.log 2>&1
