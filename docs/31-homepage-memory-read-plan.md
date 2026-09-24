# Homepage memory reads and mutation invalidation

## Scope

Approved on 2026-09-24: reduce homepage Worker calls by caching bounded,
reconstructible display data in the Next.js Web process. Keep Admin writes direct
and unthrottled. Reuse the current memory runtime and Worker KV invalidators.
No deployment, push, forum-list page caching, durable event bus or Redis in this task.

The authenticated homepage server-rendered data path previously performed five warm Worker
calls (structure, summary gates, digest, public user, self), nine fully cold calls
including settings and stats. Browser notification polling, assets, refresh tokens, prefetches and gate chunks
are additional. Target one warm homepage-context call, excluding periodic settings,
assets, browser notification polling and token refresh. This is a server-render call-count
target, not a measured production latency claim.

## Read design

- Add a bounded, read-only POST `/api/v1/home/context`, authorized with Key A and
  optional verified forum JWT. No view side effects. Reject supplied invalid JWTs.
- Request carries a cached bucket hint (never authority), explicit missing display
  and stats flags and bounded summary/digest candidate IDs. Derive the actual bucket
  on Worker; a changed bucket forces fresh audience-correct sections.
- Always return a narrow verified current-user projection and fresh permitted forum
  IDs and topic gates. One verified identity and batched SQL, not nested HTTP calls.
- Statistics query failure omits only the optional stats section. Web keeps verified
  content and uses its existing display defaults without caching them; the next
  context request retries statistics. Authority failures still fail closed.
- One optional coherent display snapshot supplies current forum structure, summaries
  and five digest display rows; public stats are a separate optional section. Rebuild these from D1, not an older KV payload whose age
  would be reset. Reuse existing SQL/mappers/authorization wherever possible.
- Gates cover forum status/visibility/ancestry, topic location/sticky/anonymity/author
  and digest eligibility. Never share author-specific or pending content. Failed
  current checks suppress cached sensitive content; a role hint cannot authorize it.
- Web stores one coherent `home-display` snapshot per bucket (four entries), with
  a thirty-minute fallback TTL. The homepage stops separately populating per-forum
  summary entries; existing non-home readers keep the current family. Clear the
  bounded home-display family on every relevant domain mutation rather than track
  several dependent section versions. Keep time-dependent public stats
  at five minutes and Shanghai day-boundary expiry. Settings keep existing policy.
- Cache limits cover entries, bytes, string lengths and in-flight work. Use the
  existing runtime and management overview; avoid unbounded full Thread/User state.
  A home-display entry has at most 512 KiB admission size. Oversized data may be
  served fresh without admission, never silently truncate
  real forums. Keep total estimated cache payload at 8 MiB.
- Share one request-scoped home loader between layout and page. Proxy overwrites a
  trusted homepage marker; non-home routes retain their current behavior. Header
  personal fields and email state come from the same verified user result.
- Peek only to prepare a context request; after its current checks filter cached
  content again. Preserve invalidation fencing when a write races a fill. Reset
  or invalidate affected sections before any bounded retry; never loop on gates.
- Restart has no persisted process snapshots: first read rebuilds correctly.
  Failure never becomes a cached zero/empty success. No stale TTL renewal on hits.

## Mutation design

- Keep Worker as owner of KV invalidation for business writes, including direct
  Admin/CLI calls. Next.js owns memory invalidation after confirmed Web writes.
- Consolidate existing Web display-invalidation calls into a small typed domain
  change helper. Reuse its existing family/key clearing and in-flight fences.
  Support memory-only actions; the normal write path naturally covers both layers
  (Worker KV first, Web memory second). Never make Web independently bump KV gens.
- Cover create/reply/edit/delete/restore/move/sticky/digest/highlight/forum config
  and profile display changes. Move clears both source and destination; unknown
  affected IDs clear the bounded family conservatively. Views do not invalidate
  whole lists or homepage content. No per-forum dirty booleans or timer per forum.
- Invalidate immediately after a successful business write; refill on next read,
  deduplicating layout/page within a render. Independent cold contexts retain their
  own authority checks. No need to eagerly rebuild unused data or batch Admin.
- Admin may notify the configured Web through its existing authenticated memory
  management channel after successful relevant writes; notification is best effort
  and must not turn a committed write into an error. Never flush statistics merely
  to clear display data. Direct CLI/out-of-process ordinary edits converge through
  fallback TTL; sensitive access changes remain guarded on every read.
- Memory management remains separate from KV management. Explain layer ownership
  and business-write invalidation in API/docs instead of adding a distributed cache
  coordinator or generic event framework.

## Validation and delivery

Independent Codex plan review precedes implementation. Freeze shared contracts;
Grok owns Worker/context and focused Worker tests; coordinator owns shared memory
contract/runtime and Web home integration; Pi owns bounded write-path integration
once those helper contracts are frozen. No overlapping edits, staging or hooks.

Verify warm/cold Worker call counts, authorization and cross-role isolation,
anonymization/deletion/move/digest removal, restart/expiry/failure, bounded cache
admission, same-key load sharing, write-versus-fill races, Admin best-effort direct
writes, no double activity/view events and unchanged non-home pages. Run configured
normal commit gates, targeted real local HTTP/browser flows and independent final
review. No thresholds lowered; configured coverage is not full 95% L1 certification.

## Status

- [x] Investigation and proposed scope recorded.
- [x] Independent plan review and contract freeze.
- [x] Implementation and focused verification.
- [x] Independent final implementation review; all findings closed.

Delivery uses a normal gated local atomic commit. No push or deployment is included.

## Independent review disposition and frozen transport limits

The initial independent review found five reuse hazards; all are accepted:

1. Home context uses uncached D1 authority for users, forums and topic candidates,
   never `currentForums()`'s isolate/KV generation hints. Compute ancestor-aware
   allowed forum IDs. Filter entire forum rows, not only latest-topic text.
2. Shared digest always masks anonymous authors even when its owner fills first;
   no pending/owner-specific projection. Current user and gates are never cached.
3. Context POST gets a 15-second deadline through response consumption and a
   bounded response reader; business POST timeout behavior stays unchanged.
4. Home snapshot and stats expire at Shanghai midnight; reject fills crossing it.
   Home TTL30min is family-specific; never change the five-minute flush constant.
5. Freeze summary candidate limit512, digest candidate limit5, request body32768
   bytes before JSON.parse. No unknown fields, duplicate/invalid IDs or caller-set
   identity. Candidate overflow is NOT truncated: send empty candidate arrays with
   includeDisplay=true, serve complete fresh display without cache admission.
   Worker authorizes candidates from newly selected display on cold/bucket-change
   and overflow paths in the same call. Use batched SQL within D1 parameter limits.

Request: {cachedBucket: ReadingBucket|null, includeDisplay:boolean,
includeStats:boolean, summaryTopicIds:number[], digestTopicIds:number[]}.
Response data: {bucket, user: HomeUser|null, allowedForumIds:number[],
summaryGates: ForumSummaryGate[], digestGates: HomeDigestGate[],
display?: HomeDisplay, stats?: HomeStats}. Standard Worker meta fields remain.
HomeDisplay contains {forums: HomeForum[], summaries: ForumSummaryTopic[],
digest: HomeDigestTopic[]}; no user, gates, settings or full thread bodies.
HomeForum is the structural projection needed by homepage cards; HomeDigestTopic
contains only id/forumId/subject/digest/createdAt/replies/views/anonymousAuthor/
authorId/authorName. HomeDigestGate contains topicId/forumId/sticky/digest/
anonymousAuthor/authorId; anonymously projected authorId is always0.
HomeUser contains id/username/role/status/credits/coins/groupTitle/email/
emailVerifiedAt/emailChangedAt. Actual D1 identity controls bucket and gates;
cachedBucket is only a rebuild hint. A mismatch forces a fresh display.

Runtime admission: capture one fixed per-family epoch and request start time
BEFORE network I/O (also for empty caches and unknown buckets). Every key/family/
all clear advances the family epoch even when empty. Conditional admission uses
actual response bucket and matching epoch/day. Peek clones without renewing TTL.
Keep existing read-flight fences. Never cache or share context user/gates by role.
Independent cold context reads are allowed: every request has fresh authority;
each context reserves a slot in the existing 64-load process cap before cloning
or fetching and releases it on success or failure. No private response is shared;
do not invent a scheduler to collapse private responses. Per-entry home limit is
512KiB and total remains8MiB; candidate overflow also prevents admission. A bounded
2MiB response reader may reject unsupported oversized responses explicitly; never
silently remove real forums to make a response fit.

## Integration evidence (2026-09-24)

- Independent plan review approved before implementation. Independent Web review
  approved the main slice and final integration with no open P0–P3 findings.
- Real local Next.js + Wrangler browser run:
  `bun run scripts/run-l3.ts tests/e2e/bdd/mobile.spec.ts --grep homepage --reporter=line`
  passed seven scenarios, including anonymous, authenticated and 320/375/390/430px
  layouts. Logs recorded eighteen successful homepage renders and exactly eighteen
  `POST /api/v1/home/context` calls. Avatars and notification polling were additional.
  Local development timings were 1769 ms for the first compile and 30–58 ms for
  subsequent renders; these are fixture measurements, not production latency claims.
- Initial full Web coverage run passed 172 files / 2444 tests: statements 96.27%,
  branches 93.66%, functions 95.46%, lines 97.56%. Additional focused tests and
  review fixes were added afterward; the normal commit hook supplies the final configured gate receipt.
- Review found and corrected missing Admin post/recalculation notification paths,
  independent avatar upload invalidation and unregistered background notification
  lifetime. Avatar/profile changes now clear both forum-summary and home-display;
  Admin notifications use Next.js `after()` and never delay the business response.

- Final review also closed stale digest author names after Admin rename, a detached
  optional-statistics rejection path, and Worker router call arity. Cold digest
  rebuilds join current users; hot gates omit display text/counters. A real-SQL
  delayed-authority/fast-stat-failure regression passes. The pre-gate focused handler/router
  run passed 182 tests; the reviewer independently reran all twelve context cases.
- Both Next.js production builds, full `bun run typecheck`, and root check-only lint
  passed before normal commit gates. Review approval covers the final implementation,
  not a deployment or a claim that the repository meets every declared 6DQ target.

- The first normal hook correctly rejected Worker statement coverage at 94.87%.
  Added transport/auth failures, 513-forum non-truncation and SQL-bind limits,
  missing/cyclic ancestry, a concurrent moderation hide, and D1 failure cases.
  The subsequent full Worker run passed 3856 tests with statements 95.04%, branches
  90.40%, functions 98.23%, lines 96.64%; configured thresholds were unchanged.

- A fresh independent Codex review reproduced two P2 gaps: homepage contexts
  bypassed the runtime's load cap, and optional statistics failure rejected the
  whole context. Contexts now share the existing bounded load counter; statistics
  failure preserves verified content and retries without caching default values.
  Regressions cover mixed-family capacity, failure release and statistics recovery.
