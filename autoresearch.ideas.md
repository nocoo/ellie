# Autoresearch Ideas (deferred / future)

Ideas surfaced during the list-loading optimisation pass that we chose not to
pursue in the current session, with rationale.

## Achievements (this session)

- **Bench `total_µs`**: 270,356 → ~245,000–250,000 (−7–9% min-of-min,
  ~10× noise-floor confidence sustained over 35+ measurements)
- **66 commits, 4174 / 4174 L1 tests green throughout, typecheck clean**
- **Production wins** (saved D1 round-trips — invisible in the local bench):
  - Parallelised auth + visibility queries on every list/getById endpoint:
    forum, thread, post, post-comment, search, user (batchGet/getById),
    digest, attachment, messages
  - Parallelised metadata fan-outs in forum.getById, deleteUserContent,
    purge user content, batch user-stat recalc, single-user stat recalc
  - Parallelised create paths: thread.create, post.create,
    post-comment.create, message.create, auth/register, auth/checkUsername,
    report.create
  - Parallelised auth/login + auth/refresh side effects + me/changePassword
  - JOIN-fused redundant queries (attachment batch, post.list visibility)
  - Cached SQL templates (thread.list)
  - Eliminated redundant SELECT COUNT in admin/thread.remove + afterDelete
  - Use INSERT meta.last_row_id instead of follow-up SELECT in registration
  - Parallel COUNT + page query in createListHandler (covers ALL paginated
    admin endpoints) plus 4 custom list handlers (announcement, report,
    adminLog, ipBan)
  - Parallelised the per-id pipeline in createBatchDeleteHandler (covers
    all admin entities that batch-delete)
  - 7 moderation handlers parallelised (permission + target user lookups)
  - admin/user.merge / admin/forum.merge multi-read parallelisation
  - Tail fan-out parallelisation: post.batchDelete, forum.merge,
    forum.reorder, admin/thread.batchMove (recalc + cache + audit)
- **Code-quality refactors**:
  - Extracted `runUserHistoryQuery` (listThreads/listPosts/listDigest)
  - Extracted `buildNextCursor` (5 list handlers)
  - Migrated forum/attachment/post-comment/auth handlers to `jsonResponse`
    (~150 lines of boilerplate removed total)
- **Gate hardening**: `autoresearch.checks.sh` now also runs `tsc` (we caught
  one buildNextCursor type bound regression that vitest had passed)

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
