#!/usr/bin/env bash
set -euo pipefail

# scripts/typecheck.sh — Typecheck with route type freshness guarantee.
#
# Next.js generates route types (.next/types/routes.d.ts) only during
# `next dev` or `next build`. If app/ source is newer than the generated
# types, tsc silently skips route type validation. This script detects
# staleness and rebuilds types before running tsc.
#
# Also gates: INIT_SQL freshness — when migrations change without a
# matching `bun run prepare:test-sql`, fail here so L2-fast keeps in sync.
# (See docs/23-local-test-stack.md §2.2.1.)

# INIT_SQL freshness check — fails fast if apps/worker/src/test-support/
# init-sql.generated.ts is out of sync with apps/worker/migrations/.
bun run prepare:test-sql --check

check_route_types() {
  local app_dir="$1"
  local routes_dts="$app_dir/.next/types/routes.d.ts"

  if [ ! -f "$routes_dts" ]; then
    echo "⚠️  $app_dir/.next/types/routes.d.ts not found — rebuild needed."
    return 1
  fi

  # POSIX-portable: find any app source file newer than routes.d.ts.
  # `find -newer` works on macOS (BSD) and Linux (GNU) without stat format differences.
  if find "$app_dir/src/app" -type f \( -name '*.ts' -o -name '*.tsx' \) -newer "$routes_dts" 2>/dev/null | grep -q .; then
    echo "⚠️  $app_dir/.next/types/routes.d.ts is stale — rebuilding..."
    return 1
  fi
  return 0
}

rebuild_needed=false

for app in apps/web apps/admin; do
  if [ -d "$app/src/app" ]; then
    if ! check_route_types "$app"; then
      rebuild_needed=true
    fi
  fi
done

if [ "$rebuild_needed" = true ]; then
  echo "   Rebuilding route types via next build..."
  bun run build
fi

exec bunx tsc --build
