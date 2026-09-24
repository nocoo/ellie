# Retrospective

### 2026-09-24: Carry statistics semantics into browser contracts

- The v1.14.2 browser gate still asserted the retired 15-minute activity label
  after the approved implementation changed the metric to active members over
  30 minutes. Unit and standalone checks passed, but this older mobile contract
  blocked CI and correctly prevented Web/Admin deployment.
- Update consumer assertions across unit and browser suites when a metric changes;
  preserve the responsive geometry checks and assert the new numeric label rather
  than loosening the test. Worker-first cutover remained healthy while CI blocked.

### 2026-09-23: Verify role enums before review guidance

- During cache integration review, the coordinator inferred Admin's numeric role
  from a test seed and sent an incorrect correction to an implementing agent.
  Reading the actual enum and visibility bucket helper disproved that assumption;
  the correction was withdrawn immediately and the new HTTP tests now use UserRole.
- Treat fixture usernames as labels, not permission definitions. Read the shared
  enum and authoritative visibility mapping before writing role-sensitive tests or
  directing another agent to change access logic.

### 2026-09-23: Explicit Herdr pane targeting

- A pane resize using `--current` resolved to a different focused workspace in this tool environment. Immediately restored that split to its prior ratio and resized the intended pane by its verified ID.
- Use explicit verified pane IDs for all layout mutations in this session; do not assume inherited CLI context remains attached to the agent's pane.

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

### 2026-09-23: Editor paragraph splitting failed in Chrome

- A real browser reproduced Enter doing nothing and Ctrl+Enter changing content before submission. Chrome reported multiple `prosemirror-model` instances; the lockfile retained older nested model, transform and view packages after Tiptap updates.
- Pin the ProseMirror runtime packages to one compatible version each and remove duplicate lockfile resolutions. Handle submission inside the editor before its hard-break keymap, with composition and held-key guards.
- Existing component tests passed even while Chrome failed. Keep browser regressions for paragraph splitting, a caret inside existing text, exact submitted HTML, Windows/macOS keymaps and Chinese composition. Dependency updates affecting the editor require the browser checks as well as unit tests.

### 2026-09-23: Composer drafts and responsive dialog duplication

- Browser verification found two draft lifecycle errors: an editor could mount before session storage restoration, and Tiptap's default `setEditable` update event could recreate a draft immediately after successful publication cleared it. Wait for restoration before enabling the fields, disable synthetic updates when changing editability, and derive preview content from the live editor instance.
- A single comment action opened two dialogs because desktop and mobile layouts both mounted `PostContent`, including its portal-based interactions. CSS hiding an ancestor does not hide a portal. Render one responsive content/action tree and vary only the author layout.
- Keep behavior checks for reload restoration, exact preview content, successful draft cleanup, and one dialog per action at desktop and phone sizes. Simulated paste tests must await the browser's selection-change event before dispatching clipboard data; a synthetic keydown alone does not guarantee that ProseMirror has synchronized its selection and can produce a false insertion-position regression.

### 2026-09-23: Cache regression test scope

- A broad test replacement accidentally applied immutable-avatar metadata expectations to post images. Focused tests caught the mistake before commit; the assertion was restricted to avatar uploads.
- The installed Next.js release exports `unstable_doesMiddlewareMatch`, despite the application using the proxy convention. Read installed testing types before choosing experimental helper names; mock authentication when importing proxy configuration in unit tests.
- Section-wide review also found obsolete cache bullets left beside the replacement policy. Remove contradictory historical statements when updating operational docs, and verify the full resulting section rather than only the changed lines.

### 2026-09-23: Standalone verification build ownership

- The memory-runtime harness initially assumed a root Wrangler binary instead of reusing the Worker workspace path. After correcting it, a concurrent typecheck detected stale Admin route types and rebuilt both apps while the harness copied Web standalone output, causing a missing-file error before startup.
- Finish the root typecheck and its possible builds before copying standalone artifacts. Treat typecheck as a potential build until route freshness is confirmed; serialize all consumers and producers of `.next`.

### 2026-09-24: Homepage cache integration boundaries

- Transpile-only Worker tests passed while the new router supplied an extra handler argument and a conditional promise lost its display type. Full typecheck caught both before any commit or deployment; preserve the explicit read-result union and verify integrated types after shared contracts land.
- Parallel optional statistics initially started before an awaited authority query, leaving early failures detached from the request. Independent review reproduced an unhandled rejection. Start independent reads together only when they can immediately join the same awaited promise; retain the delayed-authority/fast-stat-failure regression.
- Cache clearing cannot repair a rebuild that reads denormalized old author names. Cold homepage digest projection now joins the current user row; rename/rebuild tests verify that restart and invalidation recover current display data.
- The normal commit hook rejected Worker statement coverage at 94.87%, despite all tests passing. Add meaningful failure, moderation-race and oversized-forum cases in the new handler rather than lowering thresholds or counting focused tests as full gate evidence.
- Repeated small agent handoffs and review of changing slices duplicated work. Freeze contracts and file ownership, send one compact task, and review a stable revision. Run integrated typecheck and affected-package coverage before staging; include the tracked declarations emitted by typecheck so the commit does not leave stale public contracts behind.
