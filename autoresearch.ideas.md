# Autoresearch Ideas (deferred / future)

Ideas surfaced during the list-loading optimisation pass that we chose not to
pursue in the current session, with rationale.

## Achievements (this session)

- **Bench `total_µs`**: 270,356 → 247,136 (−8.6% min-of-min)
- **Production wins** (saved D1 round-trips, not visible in the local bench):
  - `forum.list`: defer auth + parallelise mod-names / visible-last-thread fetch
  - `forum.getById`: parallelise 3 metadata queries + defer auth (4 RTTs → 2)
  - `thread.list`: Promise.all auth + visibility check + cached SQL templates
  - `thread.getById`: defer auth + parallel forum visibility query
  - `thread.create`: parallel censor + forum + author lookups (5 → 2 RTTs)
  - `post.list / getById`: defer auth + parallel visibility check
  - `post.create`: parallel visibility / position / author (3 reads in 1 hop)
  - `post-comment.list / create`: defer auth, parallel visibility + author
  - `search.list`: defer auth + parallel page query / total-count
  - `user.batchGet / getById`: parallel auth + user-row fetch
  - `messages.list (inbox)`: parallel page query + unread count
  - `messages.create`: parallel receiver / sender / 2 censor checks (4 reads)
  - `digest.filters`: parallel years + forums aggregates
  - `attachment.verifyThreadVisibility`: defer auth
  - `admin createListHandler`: parallel COUNT + page query (covers ALL
    paginated admin lists — forums, threads, posts, users, attachments,
    ipBan, censorWord, adminLog, announcement, report)
- **Code-quality refactors**:
  - `runUserHistoryQuery` extracted from listThreads/listPosts/listDigest
    (−0 functional change, ~120 lines saved)
  - `buildNextCursor` helper extracted from 5 list handlers
    (~40 lines saved, prevents drift on pagination edge cases)
  - `forum.list` legacy path: 3 `.map()` passes fused into 2 in-place loops

## Cross-cutting (still deferred)

- **Reduce list-payload size**: `forum.list` returns ALL forums (no pagination),
  `thread.list` returns up to 100 threads, each carrying ~22 fields including
  many empty strings (`lastPosterAvatarPath`, `customTitle`, etc). JSON.stringify
  is the dominant cost (~85% on thread.list) and trimming the wire shape would
  give a real win. Requires a coordinated frontend change so deferred.
- **Replace `crypto.randomUUID()` requestId with a shorter token** in `meta`. UUID
  cost itself is negligible (~30 ns) but the 36-char token bloats every list
  response. Also a contract change.
- **Speculative-execute posts query in `post.list`**: kick off the posts query in
  parallel with the visibility check; throw the result away if the visibility
  check fails. Saves one D1 RTT but wastes work on rejected requests; needs
  metrics before committing.

## Worker handlers

- **`createListHandler` (admin CRUD)**: combines `SELECT COUNT(*)` and the
  paginated `SELECT` into two sequential D1 queries. SQLite supports
  `COUNT(*) OVER ()` window function; could fold into one query. Verify D1
  optimiser actually computes the count once before changing.
- **`createBatchDeleteHandler`**: sequential per-id loop with `await fetchRow → before → DELETE → after`.
  In production this is N round-trips. Parallelising with `Promise.all` is safe
  (each id is independent) and would slash batch-delete latency.
- **`fetchVisibleLastThreads` self-join**: works but does an unindexed
  `MAX(last_post_at)` scan per forum batch in real D1. With KV cache enabled the
  whole call is bypassed, but the legacy path could materialise this once into
  KV with the existing cache invalidation.
- **DRY cursor extraction** across `digest.list`, `message.list`, `post.list`,
  `search.list`, `thread.list`, `user.list*`: every handler re-implements
  `if (items.length === limit) encodeGenericCursor({...last})`. Extract into a
  `buildNextCursor(items, limit, extract)` helper. Tiny but improves
  readability.

## Frontend (web / admin)

- **Virtualise long lists**: `messages-page`, admin `users` table, post comments
  all render N items into the DOM. React-virtual or similar would scale better
  for large lists.
- **Memoise list-item components**: list children re-render on parent state
  change; `React.memo` + stable keys would cut wasted renders on
  `forum-toast`, `move-dialog`.
- **Move list-data fetch into RSC/loader where possible**: a few client
  components fetch their own list data via `useEffect`. Promoting to a server
  component would skip the round-trip and avoid hydration mismatch.
