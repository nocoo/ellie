#!/usr/bin/env bash
set -euo pipefail

# scripts/typecheck.sh — Typecheck with route type freshness guarantee.
#
# Next.js generates route types (.next/types/routes.d.ts) only during
# `next dev` or `next build`. If app/ source is newer than the generated
# types, tsc silently skips route type validation. This script detects
# staleness and rebuilds types before running tsc.

check_route_types() {
  local app_dir="$1"
  local routes_dts="$app_dir/.next/types/routes.d.ts"

  if [ ! -f "$routes_dts" ]; then
    echo "⚠️  $app_dir/.next/types/routes.d.ts not found — rebuild needed."
    return 1
  fi

  # Find newest source file under app/
  local newest_app routes_mtime
  if command -v fd &>/dev/null; then
    newest_app=$(fd -e ts -e tsx . "$app_dir/src/app/" -x stat -f '%m %N' 2>/dev/null | sort -nr | head -1 | awk '{print $1}')
  else
    newest_app=$(find "$app_dir/src/app" -type f \( -name '*.ts' -o -name '*.tsx' \) -exec stat -f '%m' {} \; 2>/dev/null | sort -nr | head -1)
  fi
  routes_mtime=$(stat -f '%m' "$routes_dts" 2>/dev/null || echo 0)

  if [ -n "${newest_app:-}" ] && [ "$newest_app" -gt "$routes_mtime" ]; then
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

exec tsc --build
