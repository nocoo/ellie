#!/usr/bin/env bash
# prepare-l2-local-db.sh — prepare local D1 for L2 integration tests
# Used in CI (GitHub Actions) where Cloudflare credentials are not available.
#
# Steps:
#   1. Apply all migrations to local SQLite (D1 simulator).
#   2. Seed minimal data required by the L2 tests.
#
# Idempotent: safe to run multiple times.

set -euo pipefail

CONFIG="apps/worker/wrangler.toml"
DB="tongjinet-db-test"

echo "[L2] Applying migrations to local D1 ($DB)..."
npx wrangler d1 migrations apply "$DB" --env test --local -c "$CONFIG"

echo "[L2] Seeding test data..."
npx wrangler d1 execute "$DB" --env test --local -c "$CONFIG" --file scripts/seed-test-db.sql

echo "[L2] Local D1 ready."
