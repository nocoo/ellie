# Changelog

All notable changes to this project will be documented in this file.

## [1.6.8] - 2026-06-05

### Changed

- **Dependency maintenance**: patch/minor bumps across the JS and Rust toolchains. No behavior or API change.
  - JS: `@cap.js/widget` 0.1.54, `@cloudflare/workers-types` 4.20260605.1, `dompurify` 3.4.8, `lucide-react` 1.17.0, `next` 16.2.7, `react`/`react-dom` 19.2.7, `@types/react` 19.2.16, `@types/react-dom` 19.2.3, `@types/node` 25.9.1, `vitest`+`@vitest/coverage-v8` 4.1.8, `happy-dom` 20.10.1, `lint-staged` 17.0.7, `tailwindcss`+`@tailwindcss/postcss` 4.3.0, `@tiptap/*` 3.25.0.
  - Rust: `cargo update` patch-level bumps across the `cli-rs` workspace (`rustls` 0.23.40, `chrono` 0.4.45, `clap` 4.6.1, `serde_json` 1.0.150, etc.).
- Verified by full G1 (typecheck + lint), L1 (vitest 7343 + bun 119), and Rust `cargo test --workspace` (141) — all green.

## [1.6.7] - 2026-06-02

### Fixed

- **Anonymous post restoration**: Discuz `pre_forum_post.anonymous` was dropped during migration, exposing 8,474 originally-anonymous posts (912 threads). Restored end-to-end:
  - Migrations 0047–0050: add `posts.anonymous`, `threads.anonymous_author`, `threads.anonymous_last_poster`, ship 8,474 backfill UPDATEs, and re-mirror thread denorms.
  - Worker masking via `toPost(viewer)` / `toThread(viewer)` — staff and the post's own author see the real identity; everyone else sees `匿名` with `authorId=0`. Surfaces covered: thread detail, forum index, thread/digest list, search, recommended cards, forum last-poster, user history (`/users/:id/threads|posts|digest`).
  - `/users/:id/{threads,posts,digest}` now also filters anonymous content out of the listing entirely (URL itself implies ownership). Staff / profile owner exempt.
  - Post-rating refuses both `author_id=0` and `anonymous=1` to keep the anonymous social contract; rating button hidden in the UI to match.
  - Admin statistics recalc now reads `posts.anonymous` and writes `threads.anonymous_last_poster`; without this, every admin recalc silently re-leaked the original last-poster.
  - Thread/forum cache validators reject pre-mask payloads via `anonAware` build stamp; thread:list:v2 validator requires `anonymousAuthor` on items.
- **Web rendering**: anonymous-post avatar/sidebar/header/list/digest/quoted-reply all branch three ways:
  - `anonymous=1 && authorId=0` → `匿名` (no profile link)
  - `authorId=0` alone (tombstoned/placeholder) → `未知用户` (also no link, distinct copy)
  - `authorId>0` → real profile + popover (covers staff/self after worker unmask)

### Added

- `packages/migrate` POST_LOAD_DDL infra: fresh imports re-derive `threads.anonymous_*` from `posts.anonymous` after rows land and indexes are built (correlated-subquery would otherwise full-scan posts).
- `packages/migrate` extractor + loader: `posts.anonymous` propagates through `extractPost()` and `TABLE_COLUMNS.posts`, so re-imports preserve the flag.
- 33 worker tests, 8 web tests, 3 migrate tests covering masking, history filter, post-rating refusal, recalc propagation, and the three-way author rendering.

## [1.6.6] - 2026-05-30

### Fixed

- **Stats recalc batches**: Cap IN-list chunks at D1's 100-bound-variable ceiling (was sized for SQLite's 999 default). Lowered `IN_CHUNK`/`BATCH_SIZE` from 500 to 90, fixing `D1_ERROR: too many SQL variables at offset 282` on all four recalc jobs (forums / threads / users / post-forums).

## [1.6.4] - 2026-05-30

### Changed

- **Stats optimization**: Replaced expensive COUNT(*) queries in `/api/v1/stats` with pre-computed counters stored in settings table and KV. Reduces D1 row reads from ~49B/day to near-zero for this endpoint.

### Added

- **Stats counters**: Pre-computed counters for totalThreads, totalPosts, totalMembers, yesterdayPosts, todayPosts
- **Stats increment logic**: Automatic counter increment on thread/post creation and user registration
- **Daily rollover**: Cron-based daily rollover for today/yesterday posts at midnight Beijing time
- **Admin stats calibration page**: `/admin/statistics/calibrate` for viewing stored vs real values and manual adjustment

### Fixed

- **Stats cache TTL**: Increased from 60s to 600s as first-line optimization
- **Rollover TTL issue**: Removed TTL from date marker and today_posts to prevent data loss if cron is down

### Removed

- **newestMember field**: Removed unused "newest member" display from stats

## [1.6.3] - 2026-05-26

### Chores

- Dependency updates: hono 4.12.23, lucide-react 1.16.0, tailwind-merge 3.6.0, @base-ui/react 1.5.0, @cap.js/widget 0.1.53, @cloudflare/workers-types 4.20260525.1, @radix-ui/* patches/minors
- Major upgrades: @types/node 22→25, bun 1.3.11→1.3.14

## [1.6.2] - 2026-05-26

### Added

- **Thread title editing**: authors and moderators can now edit thread titles via inline dialog
- **Admin 增量管理 page**: review recent content (threads/posts) with filters

### Fixed

- **Memory leak: keepalive fetch**: instrumentation ping every 10s now consumes response body to prevent socket buffer accumulation
- **Memory leak: analytics ingest fetch**: proxy page-view POST now consumes response body and adds 5s timeout
- **Admin user detail dialog width**: widened to 80vw to properly utilize screen space
- **Reply submit navigation**: added `router.refresh()` after reply submit
- **Moderated thread visibility**: aligned across all endpoints for author/staff
- **Thread view counter**: wrapped D1 chain in Promise.resolve and bound to ctx.waitUntil
- **Mobile E2E tests**: fixed BoundingBox property access, auth gates, and forum-card assumptions

### Changed

- **Mobile layout polish**: iPhone-targeted improvements (wave 2) including unified emoji/smiley picker

## [1.6.1] - 2026-05-23

### Added

- **IP lookup buttons in admin tables**: login attempts, IP bans, operation logs, and log detail dialog now show inline IP lookup via `IpLookupInline`
- **`general.site.host` setting**: configurable site domain used for absolute forum links in analytics audit tab
- **ISR caching for `forumApi`**: `revalidate` option + `React.cache()` deduplication for `fetchPublicSettings`

### Fixed

- **User detail dialog width**: widened from `max-w-6xl` (1152px) to `max-w-[90vw]` for better data visibility
- **Analytics audit forum links**: now use absolute URLs (from `general.site.host`) instead of relative paths that resolved against the admin host
- **D1 analytics flush sink**: chunked into batches of 100 to avoid SQLite variable/statement limits on high-traffic windows
- **Post editor UX**: focus behavior, popover sizing, close-on-pick for emoji/smiley panels
- **Login double-click prevention**: disabled submit button during pending `signIn()` call
- **`forumApi.get()` signature**: refactored to unambiguous 3-arg signature
- **IP header forwarding**: renamed `X-Real-IP` to `X-Ellie-Client-IP` to bypass Cloudflare header overwrite; strip client-supplied `X-Forwarded-Client-IP` to prevent spoofing

### Changed

- **Admin analytics**: split into 趋势 / 审计 / 登录 tabs with two-way `?tab=` URL state

### Chores

- Dependency bumps: lint-staged 17.0.5, @playwright/test 1.60.0, @types/bun 1.3.14, tiptap 3.23.6, vitest 4.1.7, dompurify 3.4.5, hono 4.12.22
- CI smoke test URLs updated to bbs.tongji.net / admin.tongji.net

## [1.6.0] - 2026-05-22

### Added

- **Site branding configurable via settings**: logo (light/dark), footer background (light/dark), home label, and copyright years are now read from `general.site.*` KV settings with hardcoded defaults as fallback
- **Admin brand settings form**: new fields in the 站点品牌 group (home_label, logo_light, logo_dark, footer_bg_light, footer_bg_dark, copyright_years) so admins can configure branding from the UI
- **Admin statistics job-mode recalc (Phase A–F)**: KV-backed state machine for forums, threads, users, and post-forum-IDs recalculation with polling progress cards and lease-based concurrency

### Fixed

- **`general.site.home_label` wired end-to-end**: all breadcrumb callers (thread-list, thread-detail, new-thread, user-profile, messages, checkin, me, search, digest, verify-email) and the default header nav tab now follow the configured home label
- **Auth page metadata fail-soft**: login/register `generateMetadata()` catches Worker failures and falls back to the default title instead of propagating errors

### Removed

- Dead `buildNewThreadBreadcrumbs` function (superseded by `buildNewThreadBreadcrumbsFromAncestors`)

## [1.5.0] - 2026-05-22

### Added

- **CSRF `ALLOWED_ORIGINS` env var**: comma-separated extra origins can be added without code changes
- **Recommended threads React cache**: `loadRecommendedThreads` wrapped with `cache()` to deduplicate within a single RSC render pass

### Fixed

- **Forum announcement not displaying**: tree cache now carries the `announcement` field so the forum list endpoint returns real content instead of always-empty string
- **Announcement button size mismatch**: "添加公告" button uses default size matching "发表新帖"
- **Recommended threads layout**: switched to 2-column grid (3 per column) with right-aligned metadata and proper text truncation
- **Forum page section order**: sub-forums now appear above recommended threads

## [1.4.0] - 2026-05-21

### Added

- **Admin analytics platform (P1–P5)**: trend-query indexes on D1 (P1); dashboard query-only endpoints + UI cards for KPIs/trends (P2); in-isolate event collector with explicit flush contract on the Worker (P3); today-login-history audit endpoints + admin UI with mask + per-row "查看完整" reveal that writes `analytics.login_history.reveal` to the audit log (P4); page-view ingest pipeline + today-visits admin panel with per-target detail and 10-bucket `path_kind` filter (P5)
- **Admin UI primitives**: `PageHeader` (title + subtitle + optional action slot) and `Section` (label + hairline + action slot) as the two structural building blocks for every admin page; shared `ChartTooltip` primitive replaces the previously invisible default Recharts tooltip on light cards

### Changed

- **Admin L0 background switched to cool-blue palette** + new chart tokens, replacing the warm-grey system across the admin app
- **`Card` primitive simplified**: dropped the soft ring border, surface is now plain L2 white — relies on shadow + spacing instead of a hairline ring
- **Admin pages adopt `PageHeader` + `Section`**: dashboard, content (censor-words/attachments/forums/reports/threads), users + access (users/ip-bans/logs), statistics (recalc/kv), settings (general/features/nav-links/friend-links), and analytics all migrated to the same structural rhythm
- **Forum identity surface refresh**: post sidebar campus/level rows aligned; redundant thread stats removed and group title right-aligned; identity rows merged into a centered card above the data list

### Security

- **Forum BFF stops trusting inbound `X-Real-IP`**: client IP is now derived from the trusted edge headers only, closing a header-spoof window in the Next.js forum proxy
- **Login/register success guards against open redirect**: post-auth navigation only honours same-origin destinations; cross-origin or scheme-mismatched `next=` params are dropped
- **HTML attribute values escaped in `sanitizeInlineHtml`**: attribute context now goes through proper escaping, eliminating an XSS vector when callers pass user-controlled attribute values
- **Legacy Discuz `CETagParser` posts rendered safely**: legacy CE-tagged bodies pass through the same sanitisation pipeline as modern posts instead of being injected raw

### Fixed

- **Worker analytics queue tail flush**: idle isolates now flush their bucket on tail instead of leaving the last batch stuck until the next event arrives
- **`loginHistory` list page-param NaN guard**: `?page=` is coerced and clamped, so a non-numeric value no longer 500s the endpoint
- **Nested `KpiCell` contrast on white cards**: KpiCells switched from `bg-secondary` to `bg-muted` so they remain visible inside the new white `Card` surface
- **`TodayVisitsPanel` actually mounts** on the analytics page (previously the import existed but the component was not rendered)

### Performance

- **D1 trend-query indexes** added for the admin analytics dashboard (P1), avoiding full-table scans on the daily-trend queries

### Chore

- **Dependency cleanup**: removed zero-use deps and pinned patched transitive versions (lockfile-level fixes for known advisories)
- **Migrate tooling**: 2026-05-20 incremental D1 sync generator; read-only audit of `users.email` / `reg_ip` against the 2026-05-20 dump; backfill dry-run generator + SQLite validator for the same columns
- **Web test isolation**: per-file isolation + raised `waitFor` timeout to stabilise flakey pre-commit runs

## [1.3.2] - 2026-05-20

### Security

- **CAPTCHA fail-closed across all forms**: Login, register, and report dialog now treat CAP as REQUIRED. When `NEXT_PUBLIC_CAP_API_ENDPOINT` is missing, submit stays disabled and a banner explains the outage — previously the report dialog silently allowed submissions through a "skipped" state, and login/register hid the widget instead of failing closed
- **Inline CAP endpoint into client bundle**: Dockerfile + release.yml now pass `NEXT_PUBLIC_CAP_API_ENDPOINT` as a build-arg so Next.js inlines it into the browser bundle. Setting it only at container runtime left SSR Node seeing a real value while the browser saw an empty string, producing a React #418 hydration mismatch and a hidden widget on prod login/register
- **Dependency CVE cleanup**: Stale osv-scanner ignore removed (GHSA-q4gf-8mx6-v5v3 Next.js SSRF fixed by next@16.2.6); 8 CVEs now resolved by existing overrides + lockfile pins (brace-expansion, fast-uri, hono, ip-address, next, path-to-regexp, postcss, ws)

### Fixed

- **L3 dev server env**: `scripts/run-l3.ts` no longer hard-overrides `NEXT_PUBLIC_CAP_API_ENDPOINT` to empty when spawning Next.js — it forwards the parent env so CI can supply the value via secrets
- **CI L3 secret**: `NEXT_PUBLIC_CAP_API_ENDPOINT` injected into the browser-e2e job env block

### Changed

- **`loginAs` E2E fixture**: drives the NextAuth credentials callback directly via the API instead of submitting the /login form. The widget is purely a front-end speed bump (authorize() doesn't validate the token), so this keeps the auth path genuine — real CSRF, real password hashing, real JWT — while making CI deterministic. Cuts L3 from 25 min hang to ~5 min
- **Per-test Playwright timeout**: raised to 90 s so the CAPTCHA wait can finish on the slower GitHub free runner; form-only specs (AU-02 / AU-04 / UA-03) skipped on CI

## [1.3.1] - 2026-05-19

### Added

- **Post rating system** (6 phases): `post_ratings` D1 schema + shared types/limits; Worker create/read/revoke APIs with guarded quota batch + PM notification; aggregate in posts list/get; Next.js proxy routes + ActionBar entry + dialog wired into PostCard; summary + revoke UI; migrate ETL dry-run for legacy ratelog (with BBCode/HTML strip)
- **Forum thread types (Discuz 主题分类)**: D1 migrations 0038/0039 restore thread categories; `forum_thread_types` table + 4-switch config; admin CRUD + reorder + audit logging; Worker `GET /forums/:id/thread-types` + typeId filter/validation/denorm on threads; web picker in NewThreadDialog + list filter UI + prefix display
- **Site-wide announcements**: `sticky=2` read-path with cross-forum visibility (post-rating list included), enforced singleton with cache invalidation, red Megaphone icon, dedicated `idx_threads_sticky` index
- **Admin IP-lookup**: Worker endpoint + KV cache; admin BFF passthrough + viewmodel; user-detail inline ip-lookup panel; unified trusted client-IP extractor with operator real-IP forwarding
- **Admin user-detail enrichments**: Check-in panel + history-based recompute via user-scoped checkin endpoints; meta card semantic upgrade; threads list enriched with forum/type/lastPoster/createdAt + author/forum filters; thread-detail with forum breadcrumb + highlight badge + grouped meta chips
- **Email correction**: One-shot pre-verification email correction with same-email rejection
- **Profile fields**: Campus + signature on `PATCH /me` (email rejected); duplicate-email allowance via auto-cleared `email_normalized`
- **Check-in history table**: Per-day `checkin_history` written by public POST; extracted `shanghaiTime` helpers + `CheckinHistoryEntry` type
- **Contact-admin hint**: CAPTCHA-gated hint on login & register
- **User profile lists**: Unified shared row + `forumName` map across tabs; `/users/:id/posts` joins thread fields as `UserPostHistoryItem`; 5-col grid layout
- **L3 E2E coverage**: Bench harness + rules; suite stabilised and grown from 21/41 to 62/62 passing (header/footer, already-logged-in, navigation, not-found, theme/logout, etc.)
- **Migrate tooling**: Local pre_forum_thread loader, thread-categories prod-import generator, read-only typeid coverage stats helper

### Changed

- **WriteGateDialog**: Show 3-step onboarding progress; `/me` lands `REQUIRE_AVATAR` CTA directly on an avatar uploader; profile edit dialog widened with unified identity/campus fields
- **Forum-card UI**: Clickable last-poster username, split date span, mobile last-post date split, grid title flex shrink, prevent stats wrap on 5-6 digit counts, baseline aligned to home-footer text-sm
- **B05 background semantics**: Replace `bg-muted`/`bg-card` misuse with `bg-background`/`bg-secondary` across admin (login, kv stats, censor-words, json-code-block, post-floor, user-edit-dialog, stat-card icon, nav-links-editor) + ui table component
- **Font baseline**: Align post-card/content/comments, post-sidebar, user-detail tabs/info-card, forum-card to 14/12 mix; clear remaining `text-2xs`/`text-[10px]` to 12px floor
- **Online stats**: Thousand-separator formatting; friend links pipe layout → responsive grid; sidebar message dialog opens in place
- **Admin dialogs**: Unified wide-dialog width via shared preset; KV monitor `KeyDetailDialog` width cap + JSON syntax highlight
- **Sticky priority**: `sticky=2` (site announcement) outranks `sticky=3` (category pin)

### Fixed

- **Worker**: Sticky=GLOBAL read pass-through extended to post-rating list; PM permalink uses `/threads/<id>` (plural); refund UPDATE guarded by `changes() > 0`; strict integer parsing in `coerceTypeIdInput`; admin thread-type create UNIQUE-safety + reorder full-set; tighten `forum:tree:v2`/`forum:meta:v2` KV validators; ip-lookup IPv6 doc-block + echo upstream shape; reject future ts in online snapshot guard; exclude thread first-posts from `/users/:id/posts`
- **Web**: Duck-type `ApiError` in write-gate + post-rating components; post-rating reason optional; guard posts tab against legacy `Post[]` payload; admin login uses `VERSION_DISPLAY` instead of hardcoded badge; admin/threads wraps `useSearchParams` page in Suspense; admin filters per-key local state for multi-search; only treat real non-empty→'' transitions as parent-driven clears
- **Migrate**: Strip BBCode/HTML in legacy reason; kill `type_id=0` + `type_name<>''` mismatch; placeholder thread/forum NOT NULL fixes; GBK byte-count fallback; derive `threadtypes.enabled` from `types.size`; reviewer pins
- **KV monitor**: Use Fragment with key on `OverviewTable` rows; surface fetch errors instead of silent empty page
- **Check-in**: Sync `checkin_history` schema baseline + drift test; reject same-email correction so one-shot is not wasted

### Performance

- **`idx_threads_sticky`**: Keeps `/api/v1/threads` off full-table scan as the threads table grows

### Security

- **CI**: Pass `--ignore-scripts` to `bun install` (Shai-Hulud defense)
- **CAPTCHA gating**: Contact-admin hint protected by CAPTCHA on login & register
- **Admin XFF**: Gated behind non-production in client-IP helper

### Chore

- Bump `brace-expansion` + `ws` to patched versions
- Remove autoresearch scratch files
- Ignore `test-results/` in biome config

## [1.3.0] - 2026-05-12

### Added

- **KV Monitor admin panel**: Full admin UI for inspecting Worker KV state — overview, per-family key listing, key detail with sensitivity masking, per-key delete, and manual refresh (`apps/admin` + `apps/worker`)
- **KV metrics pipeline**: D1-backed op-dimension metrics (read/write/bump/delete) with in-request accumulator flush and admin metrics API (`/api/admin/kv/metrics`)
- **Write-gate preflight**: Unified permission check before all write actions (post, reply, report, message, comment) with action-aware cache isolation
- **Registration enhancements**: Email required at registration, profile fields (birthday, QQ, site, education), anti-bot CAPTCHA, email uniqueness pre-check
- **Email verification UX**: Resend cooldown, code expiry countdown, redirect after verify, "修改邮箱" entry
- **Post-comments batch endpoint**: `POST /api/v1/post-comments/batch` for SSR thread detail
- **User profile fields**: Campus and check-in summary exposed via API and shown in user info / post sidebar
- **Newbie stamp**: Visual indicator for author's first thread
- **FloatingToolbar**: Unified floating toolbar component replacing old FloatingActions
- **Thread page links**: Inline page links with `?page=N` support and jump-to-page input
- **Discuz thread icons**: Thread status icons replacing user avatars in thread list
- **Data migration tooling**: D1 import executor with dry-run/resume/verification, upsert loader, source resolver, post-comments pipeline, bounded retry

### Fixed

- **Login page**: Show "已登录" card for authenticated users instead of silent redirect
- **Thread pagination**: Convert from cursor-based to page-based; fix last/page priority resolution
- **Nuke user**: Subquery-based deletes with chunked batches and step-level error labels
- **FTS5 triggers**: Fix delete/update triggers for regular `threads_fts` table
- **Mobile layout**: Author truncation, avatar shadow, UserPopover shrinkable container, toolbar overflow protection
- **SSR fallback**: Surface batch-fetch failures and recover via fallback; demote SSR fallback logs to `console.warn`

### Changed

- **Forum route proxy**: Migrated all Next.js route handlers to shared `proxyRoute` helper with architecture guard
- **API client refactor**: Funnel all client network calls through `apiClient` with static guard + React cache TTL boundaries
- **Header profile card**: Redesigned layout with coins display
- **Forum list toolbar**: Rearranged with new post button
- **Worker KV cache**: Forum v2 two-generation scheme with full invalidation parity; thread:list:v2 schema
- **Quality infrastructure**: 6DQ gate scripts (`gate:g1`/`gate:g2`/`gate:full`), L2 100% coverage gate, L2 route×method coverage audit
- **Admin UI**: SectionHeader/SegmentedSwitch components, sidebar split for statistics/KV sections, user-edit field expansion

## [1.2.5] - 2026-05-07

### Added

- **Admin batch operations**: Batch move dialog for threads with typed-confirm batch delete; batch purge for users with serial loop execution
- **Admin range filters**: Numeric range and date range filter types for user list (主题/帖子/站内信/附件 counts + registration date)
- **Admin user avatars**: UserAvatar component with CDN avatar URL helpers; expose avatarPath on admin user payload
- **Admin inline actions**: Inline action buttons on users and threads tables with cross-reference links across admin pages
- **Admin badges**: Centralized badge variant mapping via `badges.ts`

### Fixed

- **Worker cascade deletes**: Clear child rows before thread and post deletes; clear child rows in user content deletion
- **Admin UI polish**: Consistent user-status colours, line tabs in user detail, thread subject display for posts, empty filter select states, table header hover state prevention
- **Tailwind v4**: Scan `@ellie/ui` sources for utility emission in admin app
- **Dependencies**: Update hono for OSV advisory fix

### Changed

- **Worker parse helpers**: Reuse `parseIdFromPath`, `parsePathSegment`, and `clampLimit` across all handlers (admin reports, user history, forum, user, attachment, post, message, search)
- **Admin controls**: Standardized filter controls, shared Select in form dialogs, default pagination to 100/page
- **Deploy contract**: `bun run worker:deploy` now applies pending D1 migrations before deploying

## [1.2.4] - 2026-05-06

### Performance

- **Worker parallelization** (82 commits): Systematic fan-out of independent D1/KV queries across all handlers — auth, threads, posts, forums, messages, attachments, moderation, admin, search. Benchmarks show 14.2% latency reduction on list-loading critical path.
- **Response helpers**: `jsonListResponse` skips `...meta` spread for keyset endpoints; `buildJsonHeaders` eliminates `corsHeaders` spread in hot path
- **Query optimization**: Single-pass `getQueryParam` replaces `URLSearchParams`; hand-rolled `parseModeratorIds` avoids intermediate array allocations; SQL template caching at module load
- **Inline mapping**: `toThread`/`toForum` inlined into list loops with pre-allocated result arrays; indexed for-loop for moderator-id set construction; frozen singleton `VisibilityContext` for anonymous callers

### Fixed

- **E2E test stability**: Dialog layout tolerance increased to 4px for sub-pixel flexbox variance; post-comments locator uses `.first()` for duplicate text; L3 env config supplies AUTH_SECRET via `apps/web/.env.test`
- **Worker query string**: Catch `URIError` on malformed percent-encoding in query params
- **Worker batch delete**: Deduplicate IDs before parallel fan-out in `createBatchDeleteHandler`

### Changed

- **Refactored response flow**: Unified `jsonResponse` helper usage across auth, attachment, post-comment, thread, and user handlers
- **Cursor pagination**: Extracted `buildNextCursor` helper for consistent keyset pagination across user history and admin list endpoints

## [1.2.3] - 2026-05-04

### Added

- **KV-cached forum tree** (Phase 1): Two-layer KV cache for forum structural metadata (10min TTL) with explicit invalidation on admin operations
- **Volatile forum data cache** (Phase 2): KV cache for forum counts and last-post info (60s TTL) with write-path invalidation
- **Forum ancestors endpoint**: Lightweight `GET /api/v1/forums/:id/ancestors` for breadcrumbs without fetching the full forum list
- **Schema validation**: Cached payloads are validated on read to reject stale/corrupt data after schema changes

### Fixed

- **E2E dialog locator**: Use `data-slot="dialog-content"` selector to avoid Playwright strict mode violation when smiley popover coexists
- **E2E viewport resize**: Wrap narrow-viewport assertions in `expect().toPass()` to handle CSS media query settle delay on CI

### Changed

- **Enable KV forum cache**: Set `USE_KV_FORUM_CACHE=true` in production — forums endpoint serves from KV on cache hit (0 D1 queries)
- **Remove dead origin**: Removed non-existent `ellie.nocoo.cloud` from production `ALLOWED_ORIGINS`
- **New-thread breadcrumbs**: Migrated to ancestors endpoint (avoids full forum list fetch)

## [1.2.2] - 2026-05-03

### Added

- **Batch attachment endpoint**: `POST /api/v1/posts/attachments/batch` fetches all attachments for a thread's posts in a single query (eliminates N+1)
- **Batch user endpoint**: `GET /api/v1/users/batch?ids=` fetches multiple user profiles in a single query (eliminates N+1)
- **Last page navigation**: `last=1` param on posts endpoint + auto-navigate to last page after reply

### Fixed

- **Quote not in editor**: Fixed quote content not appearing in editor, close dialog on reply, prevent double submit
- **PostEditor focus border**: Removed unintended blue focus-within border
- **Editor dialog sizing**: Enlarged to 80vw width and 85vh height
- **Error propagation**: Preserved POST_NOT_FOUND error code in attachment visibility chain and user-profile tab fetch

### Performance

- **Thread page SSR**: Reduced Worker requests from ~42 to ~6 per page load (batch endpoints + React cache + parallel fetches)
- **Visibility chain JOINs**: Consolidated 3 serial D1 queries into single JOIN for post listing, post-comments, and attachment handlers
- **React cache() deduplication**: `generateMetadata` and page component share thread/forum fetches within same render pass
- **Parallel page loaders**: `getSelfForumUser` now runs in parallel with `loadThreadDetail`/`loadThreadListPaged`
- **User profile parallelization**: Profile data and tab data fetched concurrently

## [1.2.1] - 2026-05-03

### Added

- **Post image upload**: Magic-byte sniffing for image validation on upload + serve endpoints
- **L3 E2E test suite**: 15 new spec files covering post CRUD, thread CRUD, pagination, search, digest filter, user journey, messages, post-comments, and redirect security (39 total L3 tests)

### Fixed

- **CSRF origin allowlist**: Added E2E port (27031) to allowed origins, unblocking write operations in L3 tests
- **Open redirect**: `buildRedirectUrl` no longer trusts forwarded-host header
- **Post-comments API**: Client uses `searchParams` object form for correct query forwarding
- **DM receiver validation**: Reject receivers with `status < 0` as `USER_NOT_FOUND`
- **Post-comment permissions**: Route `post-comment:create` through `checkPostingPermission` gate
- **Thread metadata on delete**: Recalculate thread replies/last_poster when deleting non-first posts
- **CI build failures**: `force-dynamic` on forum/admin layouts prevents pre-render env var errors
- **CI migrations**: Fix D1 migration command and vitest isolation for GitHub Actions

### Changed

- **Worker refactors**: Consolidated cursor responses, pagination clamping, forum status guards, and removed dead exports/aliases
- **Proxy error passthrough**: Unified error forwarding across all v1 proxy routes

## [1.2.0] - 2026-05-02

### Added

- **Email verification flow**: Request-code + verify endpoints with HMAC-signed codes, KV-backed state, and Dove email relay integration
- **Email verification UI**: `EmailVerificationCard` on `/me` and `/verify-email` pages with 6-digit code input
- **Email verification gate**: `withVerifiedEmail` middleware rejects unverified users on write endpoints (§5.4 dialog)
- **EmailVerificationBanner**: Server-rendered banner nudging unverified users to verify
- **EmailVerificationDialog**: Client-side dialog triggered on §5.4 403 responses

### Changed

- **CAPTCHA unified to Cap.js**: Replaced Cloudflare Turnstile with Cap.js for email verification (client-side only gate, matching login/register pattern)
- **FOUC prevention**: Externalized inline script to `public/fouc.js`
- **Button variants**: Extracted `buttonVariants` to dedicated module

### Fixed

- **Cap widget event listeners**: Fixed listeners not attaching after mount (stable refs + `[mounted]` dependency)
- **KV send-lock TTL**: Raised from 10s to 60s (Cloudflare KV minimum)

## [1.1.0] - 2026-04-12

### Added

- **GUID-based avatar storage**: New upload system generates unique paths (`avatars/{uuid}.{ext}`) to bypass cache issues
- **Avatar path endpoint**: New internal API `/api/v1/users/:id/avatar-path` for avatar proxy resolution
- **Legacy avatar support**: Users with `has_avatar=1` (legacy system) can still post when avatar is required

### Fixed

- **Avatar cache handling**: Distinguish API errors from no-avatar cases; errors cache 5 min instead of 1 day
- **Banned user avatars**: Avatar proxy can now resolve avatars for banned/archived users whose posts are visible
- **Posting permission**: Check both `avatar_path` (new) and `has_avatar` (legacy) for avatar requirement

### Changed

- Avatar upload now stores GUID-based paths in `avatar_path` field
- Avatar proxy uses new `/avatar-path` endpoint instead of public user API

## [1.0.0] - Initial Release

- Forum thread and post viewing
- User authentication and profiles
- Private messaging system
- Moderation tools
- Admin panel
- Rust TUI client
