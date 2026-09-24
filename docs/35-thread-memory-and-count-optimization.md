# Thread detail memory and count read optimization

Status: implemented and independently reviewed; release verification in progress.

Authorized v1.14.5 scope: reduce expensive D1 topic recounts and cache thread detail in existing Next.js bounded memory runtime, at most 100 distinct threads, active expiry and mutation invalidation; release Z+1 and monitor every 30 min ten times vs three days ago.
Proposed minimal design:
1. Count: decouple forceDisplay from needCount except effective bucket/type mismatch, preserve cachedCount in Web even when display reloads. Count TTL30min (existing midnight cap), scope count invalidation to affected forum when known, full clear for unknown/global announcements/privilege changes. Current hasNext and gates remain fresh.
2. New read-only Key A POST /api/v1/threads/context with optional verified JWT. Request {threadId,limit,cursor:string|null,last:boolean,cachedRevision:string|null,includeDisplay:boolean,includeStats:boolean}; strict parse, bounded body, no query params. Worker route reads D1 directly; existing maintenance settings already use D1. Return current user(HomeUser|null), fresh projected Thread, revision, cacheable:boolean, nextCursor, optional display {posts:Post[],authors:PublicUser[],attachments:Attachment[],forum:ThreadForumContext,ancestors:ThreadAncestor[]}, optional HomeStats. All outputs envelopes/meta/no-store as other context routes. cursor strict position decoder; preserve last-page and pending-review semantics. No browsing side effect on Worker.
3. Every request reads authoritative user/thread/forum ancestor access and bounded current post-page membership/privacy (limit+1), plus relevant author status gates. Warm hit skips post bodies, ratings, attachments and author profile expansion. Direct existing D1 loaders on fill (no KV). Revision tracks selection, membership, privacy/ownership/public flags/author status and forum permission/moderator shape; never hash hidden anonymous IDs into public revision. Edits/rating/profile changes invalidate via existing mutation notifications, absolute TTL fallback.
4. Shared display always public-safe masked projection. Privileged viewers, pending topics or users whose anonymous identity must be revealed on this page get cacheable:false and a fresh viewer-projected display; never admitted to shared memory. Common viewers share one display. Project anonymous attachment ownership through the shared public mapper; inspect structural storage identity without rewriting arbitrary filenames.
5. Memory family thread-detail max100 entries, one key thread:ID, value {selection,revision,display}; cache only most recently read page per thread, so no unbounded pages/variants. Per entry256KiB, family4MiB within existing8MiB total. Oversize display renders but not admitted. Absolute30min expiry capped Shanghai midnight; timer prune actively expires without reads; mutation clear fences in-flight fills. Preview must omit body/profile/content. Current permissions/user not stored. Expose family in existing Admin UI.
6. Web context dedupes via React cache in forum-cache.ts across metadata/layout/page using sanitized trusted proxy header containing thread selection, parallel settings/session. No per-user promises across requests. Existing enrichPosts/breadcrumb/UI stays; counted views recorded once on successful non-prefetch render with existing 5min buffer.
7. Extend existing Web invalidation and Admin notification families. Thread writes/replies/edit/delete/hide/move/anonymity/ratings/attachments and affected author/profile changes invalidate thread-detail; bounded full clear acceptable initially for broad/unknown scope, no new framework. Preserve existing KV invalidation ownership. Admin operations remain direct.
8. No migration assumed unless demonstrated necessary. Validate privacy, warm no-KV paths, pagination, mutation fences, 100-thread cap/bytes/timer/restart with meaningful tests; normal hooks, production builds, L3 as relevant; independent final review, migration-first Worker deploy, exact CI/Docker receipts.
Independent design review approved these resolutions. Implementation uses disjoint file ownership and serial heavy validation.

## Production acceptance

Capture the immediate pre-release baseline and September 21 Shanghai-day baseline.
Deploy v1.14.5 through normal hooks and exact-revision CI, Worker before Web.
The final rollout check found that v1.14.4 Web rejects a refreshed display with
an omitted count, while v1.14.5 Web also needs a new Worker endpoint. Therefore
v1.14.5 retains the original Worker recount condition while publishing the
new endpoint and Web reader. After that Web revision is verified live, v1.14.6
removes the single recount coupling. No compatibility flag or obsolete route is
added. The ten observation windows begin after the v1.14.6 cutover; the v1.14.5
transition remains separate evidence.
Record ten nonoverlapping thirty-minute windows after cutover, with a short
analytics lag, version/process identities, Worker/KV/D1 totals and normalized
rates, HTTP errors, KV storage and bounded memory counters. Do not treat
a partial window, missing metrics or an adaptive estimate as invoice evidence.
Additional evidence-based improvements are authorized; each deployment receives
a new patch version and its windows must remain separately attributable.

## Independent design review resolutions

- Fresh `Thread`, `HomeUser`, `nextCursor`, stats and cacheability remain outside
  the shared display. The display contains posts, public author profiles,
  attachments, forum context and ancestors only. Each request independently
  determines cacheability; private/pending/privileged responses always provide
  a complete fresh display and Web neither reuses nor admits it.
- Anonymous attachment owner IDs are projected against the owning post for the
  context and both existing public attachment endpoints. Public author lists
  use projected positive IDs. Inspect storage naming for automatic identity
  exposure; do not rewrite user-authored filenames or break resource URLs.
- Cache admission is separate from transport: use the existing ordinary
  `post`/`postAuth` transport for variable-size detail responses. A response
  exceeding 256 KiB still renders and is not cached. Do not silently inherit
  the 2 MiB `postRead` response ceiling or truncate content/attachments.
- Forward membership reads use limit+1 and derive the cursor from the last
  returned item. Last-page reads preserve the current latest-N semantics:
  read limit rows descending, reverse, and return nextCursor null.
- Expose one direct public-profile batch helper using existing batches of 80;
  do not call two single-user loaders per author. Fresh status gates remain
  mandatory before reuse; public profile projection stays public for staff too.
- Rating creation and revocation need explicit success-only invalidation.
  Inspect actual attachment association writes separately from avatar uploads.
  Known topic mutations clear thread:ID, unknown scope clears at most 100 topics.
- Count reuse never renews its lifetime. Only proven local count mutations use
  a forum prefix; global announcements, visibility ancestry, moves of unknown
  source/destination and unknown scope clear all counts. Replies and ratings
  do not invalidate counts. SQL composition is unchanged; forums.threads is
  not a substitute for the correctly filtered total.
- Retain the existing maintenance gate (its settings already read D1 directly)
  and existing Admin family-less clear. The minute timer actively prunes;
  expired entries can remain physically retained until its next tick but are
  never served after expiry. The 100-topic limit is per Next.js process.

The independent static review is retained at
`/tmp/ellie-thread-plan-review.md`. Required validation includes anonymous
attachment ownership, owner/staff/common requests sharing a key, privacy/status
changes without notifications, last 20 of 25 posts, 100 distinct authors, a
response larger than 2 MiB, successful/failed rating invalidation, count reuse
and scope changes, 101 topics, page replacement, bytes, timer and clear races.

## Final implementation review resolutions

- Context reads retain a fifteen-second abort deadline independently of response
  size. Oversize thread displays render without admission.
- Home, forum-list and thread-detail loaders recheck snapshots after awaiting
  authority. Expiry, clear and incompatible replacement trigger one fresh read;
  a second incomplete result fails. Home replacements must use topic selections
  covered by the requested gates. Expired optional statistics are omitted.
- Public cacheability requires the existing anonymous thread access rule in
  addition to matching breadcrumbs. A members-only source beneath an ancestor
  hidden from both viewers cannot qualify just because both chains are empty.
- Page/gate races retry once; unresolved membership or missing bodies fail with
  a private no-store 503 instead of returning partial content or a false end page.
- Successful Admin attachment deletions notify the existing memory runtime.
  Attachment masking changes owner IDs only; inspected storage naming did not
  justify guessing identity from arbitrary filenames or breaking stored URLs.

Independent Codex final static review completed on September 24 at 16:32 Asia/Shanghai
against the working change from `d9a280a38561594a3beea099cb956f02a93510a6`.
All reported P2/P3 findings were resolved; no open P0/P1/P2/P3 remained.
The reviewer did not execute tests. Coordinator verification passed all seven
coverage suites (8,641 tests), lint, integrated TypeScript, production builds and
383 local real-HTTP integration tests. Worker statement coverage is 95.06%; its
90.25% branch coverage passes the existing 90% gate but retains the documented
gap against the 95% standard. Browser/release gates and production observations
remain separate acceptance evidence.

The local navigation/content browser run also passed 46 scenarios, with three
existing skipped scenarios retained and no new skips. It exercised real thread
pagination, new-topic publication, reply creation/edit/delete and rendering.
