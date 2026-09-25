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
- A fresh review found that the context path bypassed the runtime's load cap and optional statistics failure rejected otherwise valid homepage content. Share load accounting across cached and request-specific reads, and acquire capacity before cloning or fetching. Failure tests must verify usable content and subsequent recovery as well as promise handling; never cache failed-statistics defaults.

### 2026-09-24: Forum list cache review boundaries

- Independent review found that asset-suffix exclusions could skip Proxy for dynamic forum paths such as `/forums/2.svg`. Match forum routes explicitly before generic asset exclusions, overwrite untrusted context hints, and verify the installed Next matcher rather than only calling Proxy directly in tests.
- A reply's forum id alone cannot identify all affected lists when its topic is a global announcement. Return the already-read sticky value in reply metadata; scope local invalidation only for known local values and clear the bounded list family otherwise. Never add a separate read just to rediscover mutation context.

### 2026-09-24: Count amplification and thread cache boundaries

- v1.14.4 reduced KV traffic but coupled display refills to exact topic recounts. The observed 04:15–07:15 UTC window read approximately 3.97 million D1 rows per hour; a costly count averaged about 49,082 rows per execution. Separate display freshness from total freshness, preserve absolute count expiry and invalidate totals only for count-changing events. Measure both storage systems after a cache migration; fewer KV reads alone cannot establish lower cost.
- Independent review caught a missing read deadline after choosing variable-size transport, and pre-await snapshot clones surviving expiry or clear. Keep transport deadlines independent of cache admission size, recheck after awaits, and test a stalled response body plus expiry/midnight during the request.
- Equal empty breadcrumb chains did not prove private source content was public. Reuse the existing anonymous access rule when deciding shared-cache eligibility. After one pagination retry, refuse unresolved membership instead of filtering it into a falsely complete page.
- The new Worker paths initially passed every test while statement coverage was below the existing 95% gate. Add actual authorization, malformed-body, statistics-failure and concurrent-hide cases; do not lower the gate or treat targeted tests as complete verification.
- Final deployment review found a protocol dependency in both directions: old Web required a count on display refill, while new Web needed a new Worker route. Checking only the final combined source missed this transition risk. Publish the endpoint and new reader first while retaining the old count policy, then remove the coupling in a second patch after Web is live. Verify both mixed-version combinations before choosing a rollout order.
- Production observation then showed another scan spike after the thirty-minute count expiry. Approximate pagination totals need an independent lifetime, and a forced display retry must not discard a still-valid count. Retain event invalidation and absolute expiry, and test a second in-flight count invalidation explicitly when separating the two lifetimes. Report cold-start costs and steady windows separately without removing cold starts from the aggregate comparison.


## 2026-09-25 — Daily statistics local bootstrap

The first browser-lane bootstrap returned 503 because its Worker lifecycle still
maintained a separate secret list and omitted the existing statistics credential.
The failure was caught before deployment. L3 now uses `TEST_WORKER_VARS`, seeds the
daily snapshot after Worker readiness, and passes the same test credential to Web.
When adding startup-dependent state, validate every local lifecycle through real
HTTP rather than assuming similarly named runners share their configuration.


## 2026-09-25 — Daily statistics deleted-forum sentinel

The first production bootstrap failed validation before writing KV or deploying
Worker: the imported database retains deleted forum `id=0`, while the new internal
statistics validator accepted only positive forum IDs. This known production shape
was absent from the daily aggregation fixture despite an earlier cache incident.
The internal snapshot now accepts the canonical zero sentinel while public request
IDs and current authorization stay unchanged. Real SQLite aggregation and transport
regressions retain the sentinel and reject negative or noncanonical IDs. New
whole-database projections must reuse documented import edge cases in fixtures.

## 2026-09-25 — Release registry URLs in the lockfile

The v1.14.10 release helper synchronized workspace versions with a temporary allowed registry. Bun also expanded 560 package download URLs to that mirror despite changing no dependency versions. The pre-commit review caught this before publication. The generated mirror URLs were removed, and the resulting file was asserted byte-for-byte equal to the previous lockfile apart from the intended workspace versions. Temporary registry selection is not enough: every release must also verify that no mirror URLs or dependency changes entered the lockfile.
