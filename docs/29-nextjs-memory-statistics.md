# Next.js memory statistics and management

## Authorization and status

Implementation and local commits are authorized. Deployment, release and push are
not authorized. Independent Codex must review this plan before implementation;
Grok and Pi implement separate scopes, followed by independent Codex code review.
Resolve all actionable findings before reporting completion.

- [x] Record the proposed design.
- [ ] Independent plan review and disposition.
- [ ] Implement the Web/Worker core and integration.
- [ ] Implement admin management and remove retired analytics UI.
- [ ] Complete local validation and independent implementation review.
- [ ] Record commits, evidence, remaining deployment requirements.

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

Add a server-only Worker statistics batch endpoint with Key A authentication,
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
2. Grok: apps/web, apps/worker, shared contract/types, migrations, their unit tests.
3. Pi: apps/admin UI/BFF/removals and admin tests; consume frozen shared contract.
4. Main: docs/20, docs/28, API/deployment documentation, cross-layer integration
   tests and validation; agents must flag contract changes before editing them.
5. Serialize staging/commits and port-using tests; no agent stages another's work.
   Keep each committed feature usable and honor all hooks. No push/deploy/release.

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
