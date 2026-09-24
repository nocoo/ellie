# Forum list memory reads

Status: implemented; independent final static review passed on 2026-09-24.
The owner authorized v1.14.4 publication on 2026-09-24, resuming final runtime
validation and normal commits. Release measurements are recorded in document 34.

## Outcome

Extend the homepage pattern to forum lists: one request-scoped context shared by
metadata, layout and page; bounded display snapshots in the Next.js Web process;
fresh Worker authorization and page membership. Warm authenticated full-page SSR
currently has approximately eight explicit Worker reads. Target one context read,
apart from independently expiring public settings and auth token refresh.

The owner explicitly approved anonymous degradation: list authors and anonymous
last posters are masked for everyone, including owners and staff. Thread details
keep their current viewer-dependent behavior. Recommended cards also stay masked.

## Transport and ownership

Add read-only Key A `POST /api/v1/forums/context`, optional verified user JWT,
JSON only, bounded body, strict parser, no query parameters, `Cache-Control: no-store`.
Register before dynamic forum routes. No browser proxy is needed: RSC calls Worker.

Request contains `forumId`, `page`, `limit`, nullable `typeId`, nullable
`cachedBucket`, nullable `cachedRevision`, `includeDisplay`, `includeStats`, and
`includeCount`. Page and ids are safe positive integers, limit 1..100, offset must
be safe. Revision is a SHA-256 hex string. The bucket is a hint, never authority.

Response contains current `bucket`, `user`, `revision`, `page`, `limit`, normalized
`typeId`, `hasNext`, and optional `display`, `stats`, `count`. Display contains
relevant `forums` (current, ancestors and visible descendants), `threads`, public
`threadTypes`, and at most six `recommended` rows. Store only list-rendered thread
fields; no bodies, complete users, personalized permissions, or relative-time text.
Structural subforum cards preserve their existing representation. Numeric forum
headers are populated from D1 display counters instead of the zeroed structure
endpoint; display counters may remain approximate for the display lifetime.
When the verified bucket or normalized type differs from the request hint, Worker
must return the corresponding count regardless of `includeCount`; Web must not
reuse a total from the old bucket/type. Forced display refresh also returns count
so a membership change cannot strand pagination behind an old total.

Worker reuses `home-read.ts` identity/ancestor visibility, `thread-list-read.ts`
fresh membership, `thread-loaders.ts` direct entity/stat loaders, and catalog
type loaders. No list-context read/write of KV. Current page composition stays
global announcements followed by local topics; type filters do not merge global
announcements. Invalid/disabled/non-listable/cross-forum type selections normalize
to no filter, matching the Web page. Empty pages are not clamped.
Use `loadUserMiniProfilesFromDb` directly after caller-independent anonymity masking; fetch
only non-anonymous authors/last posters. Do not enrich list rows through KV.

Each request verifies current membership/order with limit+1 and fresh topic access.
If a delete, move or pin change invalidates that window before the access read,
repeat the bounded membership/gate read once. Continued inconsistency returns
503 instead of reporting a shortened page with an incorrect `hasNext`.
A revision hashes the normalized query, current authority-relevant forum state,
public type configuration, current page membership and safety projections, and
recommendation membership/safety projections. It excludes views and activity.
Changed or missing revisions force a fresh display in the same Worker request.
Anonymity-state changes and hidden ancestors must invalidate reuse.
Revision inputs use zero for masked author and last-poster ids, including
recommendations. A hash must not expose an offline oracle for anonymous identities.
Changing an identity that remains masked does not change the public display or
require a different revision.
Global announcements must pass the complete source-forum ancestor gate, including
announcements whose own forum is public but whose parent is restricted.
Warm authority queries select only bounded permission/structure fields. Forum
descriptions, announcements, icons and display counters load only on display
refill for the relevant forum ids. Ordinary forum text is not part of the revision.
Ordinary text/profile edits missed by Web/Admin notifications converge by TTL.
Never renew a cached display's lifetime merely because its revision matched.

## Next.js integration

`forum-cache.ts` remains the sole React cache boundary. Extend the existing
trusted Proxy request-header pattern to normalized forum id/page/type, including
the canonical `/forums/:id/:page` rewrite. Always overwrite inbound hints.
Layout, metadata and page call the same argument-free request-scoped loader.
Fail closed on context/authorization failures; never serve a display-only fallback.
Cold or expired display fills come directly from D1. Settings retain their existing
five-minute cache. Site statistics and counts reuse existing five-minute families;
missing stats may use request-local defaults but must not cache failed reads as zero.
Group pages skip topic/recommendation reads and preserve child forum navigation.

## Bounded memory

Add `forum-list` to the existing management contract and UI. Initial ceilings:
128 entries, 128 KiB per entry, 4 MiB for this family inside the existing total
8 MiB payload ceiling. Key by forum, authorized bucket, page, limit and type.
Use lazy admission and existing LRU/epoch/day fencing. Thirty-minute absolute TTL,
capped at Shanghai midnight. No prewarm, per-forum timer or distributed coordinator.
Oversize entries still render but are not admitted. New list admissions must evict
their own family or be rejected rather than evicting homepage/statistical data.
All in-flight work is bounded. Never share identity-bearing context promises
between requests; shared display admission retains invalidation race fencing.
Admin can inspect counts, bytes, hits, misses and clear existing families/entries.
Reuse `forumApi.postRead` with its two-MiB streamed response bound and shared
64-flight runtime ceiling before snapshot cloning. Worker returns a bounded error
for an oversized context; cache admission at 128 KiB is distinct from response
size. Do not silently drop topics, truncate paging or authorize from client hints.
Worker intermediate reads have explicit limits too: at most 2,048 forum authority
rows and 512 global-announcement candidates, queried with LIMIT ceiling+1 and
rejected with a bounded 503 error on overflow. Local membership is at most 101
rows; recommendations at most six; entity/profile IN queries use existing chunks.
The context's category read uses SQL LIMIT 257 and rejects more than 256 types.
Authority SQL bounds each moderator-id field to 2,048 characters before returning
it, and the display fill rejects more than 256 unique moderator ids before profile
queries. These bounds do not change unrelated catalog endpoints.
Do not call an unbounded `.all()` and check the size afterward. Add a bounded
variant to an existing helper only where reusable; preserve existing unrelated
routes. Overflow fails the request rather than pretending truncated rows are an
accurate page or count. The new context uses only bounded authority/structure
loads; the homepage helper's unbounded whole-forum load is not reused directly.

## Write invalidation

Extend `display-invalidation.ts`, not a second notification system. Web successful
thread/reply mutations clear every cached page/filter for the affected forum.
Use authoritative mutation result forum ids when available; no preliminary Worker
read just to determine invalidation scope. Move clears both forums when known;
unknown scope and global announcements clear the bounded family. Admin keeps its
direct writes and existing best-effort all-family notification. View increments
and five-minute statistics flushes never clear list displays.

Reply success includes `meta.threadSticky` from the existing authoritative thread
read. Only known local sticky values (0 or 1) permit forum-scoped invalidation;
global announcements or missing metadata clear all list snapshots without another
Worker request.

Worker KV invalidation and Web memory invalidation retain separate ownership.
Delete invalid snapshots; refill on the next read. Restart discards memory and
the first context fetch reconstructs current D1 state.

## Files and atomic commits

1. Shared contract `packages/types/src/forum-list.ts`, export and parser tests;
   Worker handler/read helper, route registration and tests; memory runtime/admin
   family support; Next context/page/layout/proxy integration, invalidation tests.
   These pieces form one usable cross-layer feature commit after normal gates.
2. Independent review fixes are separate verified atomic commits as needed.
3. Update this plan, API architecture and documentation index with final evidence.

Implementation owners avoid overlapping files. Coordinator stages explicit paths
and owns normal commits; no parallel hooks, push, version bump, deployment, or
production measurements during implementation. Independent Codex reviews plan and
final implementation. The owner initially deferred tests and commits, then
authorized Z+1 release and verification on 2026-09-24. Resume normal checks and
hooks under that authorization; retain the no-popup requirement.

## Verification

- Unit coverage: strict request bounds, cache admission/eviction, expiry/restart,
  concurrent invalidation, role mismatch, anonymous owner/staff masking, no cached
  user, warm/cold request counts, settings and count expiry, Proxy spoof/rewrite.
- Local real Worker HTTP: current/ancestor visibility, user demotion, anonymous
  changes, delete/move/pins, filtered and empty offset pages, exact hasNext and
  no KV use in context. Keep detail anonymity unchanged.
- Local browser lane: home to forum, canonical pagination and filters, reply then
  return, metadata/layout shared context, header counts, group navigation, admin
  memory family. Run relevant browser lanes sequentially with local fixtures only.
- Normal commit hooks, root typecheck/lint, both Next production builds, and
  repository-required coverage/local HTTP/security gates. Do not lower floors.
  Existing documented 6DQ attainment gaps remain gaps; passing hooks is not a
  claim that all four repository coverage metrics meet 95%.

## Review and validation receipt

- Plan review: independent Codex sign-off on 2026-09-24 after count-key mismatch,
  bounded intermediate reads, and direct profile loader corrections.
- Implementation: shared contract, Worker context, Web SSR integration, bounded
  memory family, Admin visibility and existing write invalidation are present.
- Independent final static review: passed on 2026-09-24 after fixing anonymous
  revision identity disclosure, bounded pagination race retries, category and
  moderator read bounds, and duplicate recommendation SQL. Earlier Web/runtime
  review fixes covered Proxy matching for asset-like forum paths, global reply
  invalidation, and obsolete loaders. The reviewer reported no remaining
  P0/P1/P2/P3 findings in the reviewed scope. Final runtime validation resumed
  for the authorized v1.14.4 release; publication evidence belongs in document 34
  and the GitHub Release receipt.
- Completed before the pause: full Web coverage (177 files, 2,507 tests), full
  Admin coverage (958 tests), focused Web runtime/invalidation/context (69 tests),
  reply metadata (42 tests), pagination alias/page (14 tests), and root typecheck
  with both Next production builds. Web coverage was 96.36% statements, 93.98%
  branches, 95.65% functions and 97.67% lines. These receipts cover intermediate
  revisions and do not validate the final Worker and review changes.
- Release validation: final integrated typecheck/lint/build, all required coverage gates,
  local real-HTTP L2 and browser lanes, security gates and normal commit hook.
- Publication: authorized as v1.14.4 after baseline capture and normal checks.

## Resumed release validation

Feature commit `5a503297` passed the normal pre-commit hook on 2026-09-24:
strict staged lint, root typecheck, staged secret scan, all seven configured
coverage suites, and 380 local real-HTTP tests. Worker coverage initially failed
at 94.98% statements; expired/invalid credentials and bounded request-body
regressions were added before the complete successful retry. No floor changed.

The successful run included 3,891 Worker, 2,508 Web, 958 Admin and 1,134 shared,
mock, type and migration tests. Worker coverage was 95.06% statements, 90.30%
branches, 98.29% functions and 96.70% lines; the existing repository-wide 95%
branch attainment gap remains documented in `AGENTS.md`.

Both Next production builds passed with v1.14.4. Sequential local headless browser
lanes passed 78 forum and 38 Admin tests; four existing cases were skipped.
No browser/report popup was opened. Full push/security and exact-revision CI
receipts are recorded with the release, not inferred from these local runs.
