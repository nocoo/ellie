# Next.js memory statistics and management

## Authorization and status

Documentation, implementation and local commits are authorized. Independent
plan signoff was completed before implementation.
Deployment, release and push are not authorized. Codex reviews before implementation;
Grok and Pi implement separate scopes, followed by independent Codex code review.
Resolve all actionable findings before reporting completion.

- [x] Record the proposed design.
- [x] Independent plan review and disposition (Codex, 2026-09-23 17:02 Shanghai).
- [x] Implement the Web/Worker core and integration.
- [x] Implement admin management and remove retired analytics UI.
- [x] Complete local validation and independent implementation review.
- [x] Record commits, evidence, remaining deployment requirements.

This supersedes the blanket-cache policy in docs/20 and proposed phase 2 in
docs/28 for the families explicitly migrated below. Other families are unchanged.
All new cache state and statistical buffers live in the Next.js Web process,
never in Worker isolates. No Redis, distributed cache coordinator or new cache
framework. Persistent truth remains D1; authentication, moderation, anonymity and
business writes are not approximate.

## Product behavior

Remove application today-visits collection, dashboard visits cards and the
analytics audit tab. Keep business trends, login audit and login records. Remove
online KV presence and the admin current-IP/current-page/presence timestamp
display; keep last activity. Cloudflare request analytics is not equivalent PV.

Keep the existing latest-reply UI wording and layout. Calculate its topic using
the latest visible nonanonymous topic by creation time, then id descending,
within each forum. Display that topic's author and creation time, not its latest
reply author/time. Replies do not reorder this summary. Anonymity/deletion/move
checks remain authoritative before exposing cached titles or authors.

Views become approximate successful Web page reads. Metadata, identifiable
prefetch, unauthorized, failed and pending-review reads do not count. Deduplicate
within a request. Browser reuse can undercount. Direct Worker/CLI reads no longer
count or update browsing activity. Do not add per-view browser or Worker beacons.

Online becomes recently active members, using D1 last_activity within 30 minutes.
Only verified existing user context contributes, without extra auth requests.
Five-minute collection and display delays are accepted. Per-user persistence
remains throttled around 15 minutes; database updates are monotonic.

## Bounded process state

Reuse the existing TTL cache helper where appropriate; retain browser callers'
semantics. Own server state in one server-only runtime singleton so management,
RSC, route bundles and instrumentation inspect the same instance in a process.
Use Next instrumentation register for one runtime timer, never during build.
Admin and Web are separate processes; the management target is Web.

| Family | Maximum entries | Freshness / action |
| --- | ---: | --- |
| Site display statistics | 1 | 5 minutes |
| Forum numeric/latest-topic summaries | 256 | 5 minutes |
| Forum/type list totals | 1024 | 5 minutes |
| Pending view increments | 2048 thread IDs | Flush every 5 minutes |
| Activity observations | 4096 user IDs | Inspect every 5 minutes, throttle writes |

Bound field lengths, composite keys, in-flight loads, detached flush batches,
generation bookkeeping and telemetry as well as resident entries. Use an 8 MiB
estimated payload ceiling for these families, not an asserted V8 heap bound.
Do not cache text bodies, complete users, arbitrary search results or attachments.
Embed bounded author display fields in forum summaries; no additional global
author cache. At capacity evict display entries; count dropped statistical work
instead of growing without bound. Never silently omit real forums from output
because they exceed cache admission limits.

Cold reads load authoritative values through Worker, with concurrent miss
deduplication. Errors are not cached as zero. Expired entries are reclaimed;
failed refresh never extends freshness indefinitely. Start with blocking refresh
on expiration rather than a stale-while-revalidate framework. Daily statistics
also expire on Shanghai date changes. Successful local business writes invalidate
affected display entries; UI optimistic state rolls back on failure. Clear must
prevent an old in-flight load from repopulating a deleted entry.

## Read and write integration

Pure numeric warm reads terminate in Next.js. Worker cold-read implementations
read D1 directly for migrated statistics, avoiding KV generation and payload reads.
Forum summaries retain one combined current visibility/anonymity check before
rendering cached content; a role bucket cannot authorize personal access. On
failed checks hide the summary. Do not restore the previously removed unguarded
Next forum-response cache. Auth/maintenance checks must not be bypassed by hits.

Separate list data from totals: allow offset page reads without a total, expose a
bounded authoritative count operation with the same forum/type/announcement
semantics, and cache only that numeric result in Next.js. Next-page availability
comes from data, not stale total. Keep actual page numbers navigable even when
the cached total is low; empty final pages allow returning to the prior page.
No shared privileged counts are served to a less privileged reader.

Add a server-only Worker statistics batch endpoint with an independent
WEB_STATISTICS_WRITE_KEY held only by Web and Worker (never CLI/Key A alone),
strict bounded payload validation and no arbitrary SQL or values. Batches contain
only positive thread IDs/increments and verified-user ID/activity timestamps.
Validate finite integer ranges and timestamp bounds. Write views additively and
activity using MAX. Chunk within installed D1 statement/parameter limits.
Return explicit confirmed results; do not assume a multi-chunk HTTP failure means
no statements committed. An uncertain view batch is dropped, never retried; track
it as unconfirmed, not certainly lost. Activity is idempotent but remains bounded.

Use one flush lock for timer and manual operations. Detach pending work before
I/O, retain fixed bounds across active/in-flight state, impose timeouts, and let
new requests populate the next window. UI +1 must not double-add committed deltas
to a refreshed D1 base. Invalidate affected local display baselines on confirmed
flush. Restart discards unsent work and reloads D1; no durability claims for views.
Shutdown flush is optional best effort, not a correctness requirement.

Delete Worker view buffering and per-request online/activity tracking. Remove
online KV aggregation, but retain cron daily rollover and login cleanup. Append
the proper DO deletion migration when retiring TodayVisitsMemory; do not rewrite
historical migration tags. Add last_activity and latest nonanonymous-topic
indexes only with local EXPLAIN evidence; do not scan all users for online counts.
Retire the migrated KV registry/rebuild/invalidation paths and consumers together.
Thread stats combine views with replies and identity fields: do not blindly move
the entire mixed family to a public memory cache.

## Admin management contract

Add /admin/statistics/memory next to KV management, using installed Basalt
components and MVVM. Browser calls authenticated admin BFF; BFF calls Web over
the configured Docker internal origin, never Worker/KV. Configure
WEB_MEMORY_ADMIN_URL and MEMORY_CACHE_ADMIN_KEY on admin, and the same management
key on Web. No keys in browser output, URLs, logs or cache entries. Reject missing
configuration; no fallback to a public arbitrary origin. Use constant-time secret
verification, strict request validation, no-store, and bypass forum login proxy
only for the exact internal management route with its own independent secret gate.
Admin mutations retain existing auth and CSRF protections. Do not accept arbitrary
target origins from browser input or forward unrelated headers/credentials.

Freeze a small shared contract before parallel coding (a shared type file is
acceptable). Web internal route: /api/internal/memory-cache. Admin BFF route:
/api/admin/memory-cache. GET accepts bounded family/page filters for overview and
entries; POST accepts instanceId and action clear or flush, plus optional known
family/key for clear. Clear affects display entries only. Flush never permits
editing/dropping arbitrary buffer values. Unknown actions/families fail closed.
Reject a mutation against an old instanceId with 409. No remote hot configuration.

Show instance ID, version, start time, uptime, process heap/RSS separately from
estimated cache payload; per-family count/capacity, hit/miss/eviction/load failure,
snapshot age and expiration; bounded safe value previews; pending views/activity,
oldest work, in-flight status, confirmed/unconfirmed results and last flush time.
Do not leak sessions, credentials, private user fields or hidden topic values in
general previews. Management reads never affect business hit statistics, TTL or
LRU order. Chart a fixed 60 one-minute samples in process memory; no persistent
telemetry writes. Poll only while the admin page is visible, with no overlapping
requests. Disconnected/restarted instances must not look like empty healthy caches.

Initial topology is the documented single Web service. Multiple processes have
independent state; do not claim global totals or global clearing. Operations must
target a concrete instance, not silently traverse a load balancer.

## Ownership and sequence

1. Main: plan, review resolution, interface freeze and integration coordination.
2. Grok: Worker, shared contracts/types, migrations and their unit tests.
3. Pi: Admin UI/BFF/removals/tests and Web page integration/tests; consume the
   frozen shared contracts and coordinator-owned memory runtime API.
4. Main: docs/20, docs/28, API/deployment documentation, cross-layer integration
   tests and validation; agents must flag contract changes before editing them.
5. Serialize staging/commits and port-using tests; no agent stages another's work.
   Keep each committed feature usable and honor all hooks. No push/deploy/release.

After explicit ownership handoff, the coordinator owns Web memory-runtime.ts,
instrumentation.ts, the internal management route, ttl-cache.ts and their focused
tests. The independent Codex reviewer remains read-only and reviews these changes
as well as the Grok/Pi implementation before final signoff.

`GET /api/v1/forums?view=structure` returns the caller-visible Forum structure and
`meta.bucket`, with zeroed aggregate/latest-topic fields. Web combines this with
cached summaries and current summary gates. This avoids recomputing summaries in
the structural read on every warm request; default and names views retain their
documented shapes.

## Validation and completion evidence

Required focused cases: cross-user leakage; moderator/anonymous/delete/move after
cache fill; same-request view dedupe and prefetch exclusion; cold-start baseline;
date rollover; clear during load; capacity/byte/in-flight saturation; concurrent
timer/manual flush; uncertain/partial writes; monotonic activity; stale pagination;
unauthenticated management, CSRF, forged instance, wrong/missing secret; safe
previews and polling lifecycle. Use local fixtures only.

Run lint, typecheck, coverage and local real-HTTP L2 through required hooks. Run
Web/Admin builds and appropriate sequential local browser verification for the new
management interactions and forum flows. Preserve thresholds; report pre-existing
contract gaps honestly. Verify standalone Bun runtime shares the cache between
page reads and management, and has exactly one flush timer per process.

Independent Codex code review must inspect the final diff and resolve P0-P3
findings. Record commands/results, review dispositions and atomic commits here.
No production savings claim until deployment and comparable traffic observations.
Deployment checklist must cover new internal management configuration, D1 indexes,
DO retirement, and coordinated Web/Worker cutover to prevent double counting.

## Plan review corrections and frozen handoff

Independent Codex first review identified one P0, four P1 and three P2 findings.
The following requirements resolve them. Independent second plan review signed
off with no remaining P0-P3 design findings on 2026-09-23 at 17:02 Shanghai.
The reviewer-only prohibition on commits did not prohibit the coordinator's
authorized documentation commit. Grok and Pi implementation started after signoff;
implementation validation and final independent code review are recorded below.

1. **Statistics trust:** POST /api/internal/statistics/batch is dispatched through
   its own constant-time WEB_STATISTICS_WRITE_KEY gate before the generic Key A/B
   router. Missing/wrong key fails closed, even with valid Key A/B. Web sends it
   in X-Ellie-Statistics-Key. Validate existing active users in Worker SQL and
   reject future/out-of-range observed times; Web observations come only from a
   successful Worker auth/me identity load already required by the page, never
   from unverified cookie claims. Skip collection without that result. Thread
   increments must reference existing non-pending, non-hidden topics. No new
   per-observation verification request. Body limit and bounded arrays apply
   before allocating/parsing unlimited input.
2. **Current summary gates:** cached candidate checks include forum status and
   current visibility, topic forum_id, sticky, anonymous_author and author_id.
   Never use anonymous_last_poster to decide topic-author disclosure. Re-select
   the next eligible candidate after deletion, hiding, move or anonymization;
   hide on failed authoritative checks. General admin cache previews omit topic
   titles/author identities; display only numeric summary and IDs.
3. **Pagination contract:** offset reads support includeTotal=false and return
   page, limit and hasNext without total/pages. Fetch one additional eligible
   item after composing global announcements and local topics; filtered lists
   retain existing announcement semantics. The separate count uses the identical
   composition. Web derives displayed pages as at least currentPage and, when
   hasNext, currentPage+1. PagePagination, JumpToPage and ForumFloatingToolbar
   consume this lower bound, never clamp a real requested page to the cached
   total, and retain previous-page navigation for empty pages. Permission-filtered
   pages and global-pin boundaries have local real-HTTP regression tests.
4. **View baseline:** loadThreadStats reads its existing bounded D1 batch directly;
   retire thread:stats KV reads/fills/rebuild/registry references together. Keep
   its replies/identity fields subject to existing authoritative projection.
   Web optimistic +1 uses the returned base for that request, not base plus an
   aggregate that may already have committed. Only pending writes are buffered;
   no persistent Web per-thread view-base cache is necessary.
5. **Bounds:** replace helper's unbounded generation history with per-flight
   identity invalidation that can be discarded when the flight settles. Limit
   tracked loads to 64; saturation rejects before invoking any additional loader,
   while existing same-key loads remain shared. Forum summaries load in chunks
   of 32 with one request-local batch; more than 256 forums remain visible via
   bounded eviction. Worker GET requests time out after 15 seconds. Update no-adhoc-cache architecture tests for the
   one approved server runtime, not a blanket exemption for arbitrary Maps.
6. **Migration:** remove TodayVisits bindings from default and env.test config,
   entry.ts export, Env binding, route handlers, report dispatch/registry and
   consumers. Append deleted_classes migration using installed Wrangler schema;
   preserve historical tags. Retain daily rollover/login-cleanup cron work.
   Future deployment order: configure secrets/internal URL; migration-first
   Worker cutover removes old collectors and adds new endpoints; Web/Admin
   cutover enables buffers and management. Accept the interval's missing stats;
   never overlap old and new view writers. No deployment in this task.
7. **Runtime proof:** build Web and Admin, launch their standalone servers with
   Bun against the same disposable local Worker. Populate a display cache through
   a page read, observe the same instance/key through authenticated admin BFF,
   clear and observe next-read refill, test old-instance rejection after Web
   restart. Use existing local admin auth fixture, not production credentials.
   Verify timer/manual single-flight and no live timer during next build.

The shared management module will be packages/types/src/memory-cache.ts, exported
from @ellie/types. Grok owns that file; Pi waits for it before wiring management.
Use family IDs site-stats, forum-summary, thread-count; buffers are separate from
clearable families. GET data contains instance {id, version, startedAt, uptimeMs},
memory {rssBytes, heapUsedBytes, estimatedPayloadBytes, payloadLimitBytes}, families
(id, entries, maxEntries, hits, misses, evictions, loadErrors), entries (family,
key, createdAt, expiresAt, estimatedBytes, preview), pagination (page, limit, total),
buffers (pendingThreads, pendingViews, pendingUsers, oldestPendingAt, flushing,
lastFlushAt, lastSuccessAt, unconfirmedViews, droppedViews, droppedActivities),
and history (at, estimatedPayloadBytes, pendingViews). Nullable timestamps use null.
Payload envelopes use {data} or {error:{code,message}}. POST returns {data:{ok:true}}
or typed error; caller reloads overview after success. Management secret header
is X-Ellie-Memory-Key. Fixed overview limits: limit 1..100, page positive integer,
default 50; preview <=512 encoded bytes. All counters are since process start.

Primary files: Web lib/ttl-cache.ts, lib/forum-cache.ts, lib/forum-data.ts,
lib/forum-api.ts, lib/forum-self.ts, viewmodels/forum/*-list.server.ts,
viewmodels/forum/stats.server.ts, thread-detail.server.ts, pagination components,
src/instrumentation.ts and app/api/internal/memory-cache/route.ts; Worker index.ts,
lib/cache/{forum-read,public-stats-read,thread-list-read,thread-loaders,kv-registry}.ts,
internal handlers and migrations; Admin navigation, dashboard/analytics views,
user-detail-panel, app/api/admin/memory-cache/route.ts and statistics/memory page.

## Local runtime verification

After building both applications, run `bun run scripts/verify-memory-runtime.ts`.
The fixture copies standalone artifacts into an owned temporary directory, uses
fresh local D1 state and loopback ports, and supplies synthetic credentials. It
checks the real Admin-to-Web management path, page-read cache population,
clear/refill, authorization, CSRF, buffered views, prefetch exclusion and restart
instance fencing. Chromium exercises clear/flush interactions and captures
desktop/light and mobile/dark evidence under `test-results/memory-runtime-*`.
It never deploys or addresses production endpoints. Shutdown kills owned process groups and
requires the ownership marker and canonical directory checks before cleanup.
The complete fixture passed on 2026-09-23 against the production standalone
builds. The forum fixture verifies the configured 20-item first page and empty
requested page 6 with working previous-page navigation.

## Final implementation review and local evidence

Independent Codex final code review signed off on 2026-09-23 at 19:18 Shanghai
with no remaining actionable P0-P3 findings. This is code-review evidence;
execution gates are recorded separately. Grok delivered Worker/contracts and Pi
delivered Admin/Web integration; the coordinator completed runtime integration,
review fixes and verification after explicit file handoff.

Review corrections included current anonymity/visibility gates, filtering global
announcements before pagination, detached-buffer bounds, invalidated-load fencing,
Admin confirmation instance capture and refresh ordering, prefetch exclusion in
the installed Next.js runtime, and deletion of retired online DTO fields. Final
load saturation rejects additional loaders at 64 active loads while preserving
same-key sharing; a real-runtime 300-forum regression verifies bounded chunking
without dropping rows. Worker GET calls have a 15-second deadline. Non-POST
statistics requests reach their own 405 handler before generic authorization.

Validation completed locally:

- Web and Admin production builds passed, sequentially.
- Real HTTP L2: 376 tests passed, no failures; strict inventory 179/179 routes,
  zero uncovered routes or exemptions.
- Standalone Bun Web/Admin plus local Worker and Chromium passed. Evidence:
  `test-results/memory-runtime-dea3f186-5f18-4c9f-a2b7-dddc2f84390d/`.
  Verified Web/Admin instance identity, cold/warm cache use, clear/refill,
  unauthorized/CSRF rejection, prefetch exclusion, single view accounting,
  explicit flush into D1, abrupt restart loss of unsent work, old-instance 409,
  Admin desktop/light and mobile/dark interactions, and forum empty-page navigation.
  Screenshot inspection found no viewport overflow; no browser page errors.
- Strict lint, root TypeScript, fixture TypeScript and diff whitespace checks passed.
- G2: full-history gitleaks and Bun-lock OSV scan passed without findings.
- All seven configured coverage suites passed: 8,304 tests across 451 files.
  The normal commit hook re-runs coverage, local L2, lint-staged, staged secret
  scanning and TypeScript; the containing commit exists only if those gates pass.

| Package | Tests | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: | ---: |
| Worker | 3,837 | 95.00% | 90.44% | 98.11% | 96.56% |
| Web | 2,424 | 96.27% | 93.67% | 95.32% | 97.48% |
| Admin | 940 | 96.59% | 93.60% | 96.79% | 97.94% |
| Shared | 245 | 98.59% | 95.62% | 100% | 98.41% |
| Test mocks | 73 | 99.58% | 97.07% | 98.73% | 100% |
| Types | 211 | 99.39% | 99.47% | 98.68% | 99.29% |
| Migrate | 574 | 97.88% | 90.79% | 100% | 99.27% |

Seeded local SQLite EXPLAIN using the actual indexed queries reports
`SEARCH t USING INDEX idx_threads_forum_visible_created (forum_id=?)` without a
temporary sort, and `SEARCH users USING COVERING INDEX
idx_users_active_last_activity (last_activity>?)`. Both queries explicitly name
their partial index; the fixture planner otherwise chooses the older forum index
and a temporary sort for the latest-topic query.

The configured package gates retain their existing thresholds. The repository's
95% all-four-metrics L1 contract is stricter than its existing 90% branch gates
for Web/Admin/Worker; passing the configured gates does not certify full L1.
No thresholds were lowered, no hooks bypassed, and no production resources used.

Plan commits: `0557c7f4`, `e650788a`. The implementation is one coordinated local
commit because the shared contracts, retired collectors, replacement reads and
management UI must remain usable together. Its normal hook receipt is reported
with the final commit ID; the ID cannot be embedded in its own content.

No push, release or deployment was performed. Production rollout still requires
the two distinct server secrets, Admin's concrete internal Web origin, migration
0055, TodayVisits DO deletion migration and coordinated Worker/Web/Admin cutover
as documented in [Docker deployment](docker-deployment.md). Savings require
post-deployment traffic-normalized Cloudflare and process-memory observation.
