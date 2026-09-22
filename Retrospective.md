# Retrospective

Accident narratives belong here. Keep only recurring project rules in `AGENTS.md`; cross-project lessons belong in global rules and deterministic checks in hooks/tests.

The remote test setup below is historical. Current L2/L3 runners use local Wrangler; it is not an instruction to provision or execute remote tests.


### 2026-05-10: Checkin Streak Bug from Pre-Fix Deployment
- **Issue:** 3 users who checked in on May 9 have `streak_days=1` instead of 2, despite checking in on consecutive days (import from May 8 → new checkin May 9).
- **Cause:** The initial Worker deployment included commit `3c36b33` which used `toLocaleString("en-US", { timeZone: "Asia/Shanghai" })` → `new Date()` for timezone conversion. In Cloudflare Workers (UTC runtime), this re-parses the Shanghai-formatted string as UTC, shifting `todayStart` by +8 hours. The fix in `bb4523c` (using `Intl.DateTimeFormat.formatToParts()` + `Date.UTC - 8h`) was committed locally but not deployed until later.
- **Fix:** `bb4523c` is now in production (Worker `8e8a6d7d`). Future streak calculations are correct. Optional D1 repair for 3 affected users.
- **Lessons:**
  1. **Don't deploy code with known review blockers.** The timezone bug was identified by the reviewer as a blocker — the initial deployment should not have happened before the fix was committed and verified.
  2. **Timezone logic in Workers must use `formatToParts()` + explicit UTC arithmetic**, never `toLocaleString → new Date()` round-trip.

### 2026-05-07: Worker Deploy Without Migration Apply
- **Issue:** Deployed worker `f1d00be` to production; admin `/api/admin/users` immediately broke with 500 ("无法加载 users 列表")
- **Cause:** Migration `0030_user_tombstone.sql` (adds `purged_at`/`purged_by` to `users`) was never applied to prod D1. Deployed worker's `USER_COLUMNS` SELECT references those columns → SQLite "no such column" → 500.
- **Fix:**
  1. `cd apps/worker && bun x wrangler d1 migrations apply tongjinet-db --remote` — applied 0030
  2. Hardened the deploy contract: `bun run worker:deploy` now runs `worker:migrate:prod` BEFORE `wrangler deploy`. `worker:deploy:test` does the same against the test env.
- **Lessons:**
  1. **Never run `wrangler deploy` directly.** Always use `bun run worker:deploy` so migrations apply first.
  2. **Schema and code must move together.** Any commit that touches `*_COLUMNS`/handlers + a new migration must be deployed atomically — migration first, code second.
  3. **Pre-deploy verification:** `bun x wrangler d1 migrations list tongjinet-db --remote` should print `✅ No migrations to apply!` once `worker:deploy` completes.

### 2026-04-06: D1 Test Isolation Setup
- **Issue:** L2 tests were failing because they couldn't connect to production D1 or used empty local D1
- **Solution:** Created isolated test environment with separate D1 and KV instances
- **Configuration:**
  - Test D1: `tongjinet-db-test` (940c7758-0a9e-44b2-aeb5-745fa3143371)
  - Test KV: `ellie-test-kv` (490227e961174fd38c6c14530a4ee3ee)
  - wrangler.toml `[env.test]` section configures isolated resources
  - `_test_marker` table with `env=test` for runtime verification
- **Running L2 tests:**
  1. `bun run verify:test-db` — verify D1 isolation
  2. Worker auto-starts with `--env test --remote` via `tests/integration/preload.ts`
- **Key files:**
  - `apps/worker/wrangler.toml` — [env.test] configuration
  - `scripts/verify-test-db.ts` — D1 isolation verification script
  - `apps/worker/migrations/0000_init_schema.sql` — base schema for test DB

### 2026-04-03: Worker + Next.js Proxy Sync Issues
- **Issue:** User moderation actions (mute/ban/nuke) returned 404 errors
- **Cause:** Worker API endpoints existed but Next.js proxy routes were missing; also Worker wasn't deployed
- **Fix:** Created all missing proxy routes in `apps/web/src/app/api/v1/moderation/`
- **Lessons:**
  1. **Always create proxy routes together with Worker endpoints** — browser calls go through Next.js
  2. **After modifying Worker code, remind user to deploy** — `bun run worker:deploy`
  3. **Check both layers when debugging 404s** — Worker route + Next.js proxy route
  4. **Keep docs in sync** — update relevant docs when adding new API endpoints

### 2026-04-03: API Proxy Routes Missing
- **Issue:** `/api/v1/settings` called by `useFeatureFlags` hook returned HTML 404 instead of JSON
- **Cause:** Next.js proxy route didn't exist; browser received HTML error page
- **Fix:** Created `apps/web/src/app/api/v1/settings/route.ts` to proxy to Worker
- **Lesson:** Every browser API endpoint must have a corresponding Next.js route

### 2026-04-03: SQL Syntax Error in Offset Pagination
- **Issue:** `LIMIT  OFFSET ?` (missing LIMIT parameter) caused SQLite syntax error
- **Cause:** `getThreadListQueryWithOffset` used `.slice(0, -1)` incorrectly
- **Fix:** Changed to append ` OFFSET ?` without slicing
- **Lesson:** Always test SQL query string generation

### 2026-04-05: D1 Schema Not Deployed
- **Issue:** 站内信页面报 "Internal server error"，实际是 `D1_ERROR: no such table: messages`
- **Cause:** Worker handler 引用了 `messages` 表，但没有创建对应的 migration
- **Fix:** 创建 `0022_create_messages.sql` 并运行 `wrangler d1 migrations apply`
- **Lessons:**
  1. **新增 Worker handler 涉及新表时，必须同时创建 migration**
  2. **单独 apply migration（不 deploy）:** `bun run worker:migrate:prod`
  3. **部署检查清单:** Worker 代码改动 → `bun run worker:deploy`（已自动先 apply migrations，再 deploy）；纯 schema 改动且暂不 deploy → `bun run worker:migrate:prod`
