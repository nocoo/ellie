# 19 — Worker KV Cache Architecture

> **Status:** v3.2 frozen — architecture / rationale only.
>
> **Authoritative KV reference lives in `docs/20-worker-kv-reference.md`.**
> Per-key payload, TTL, gen wiring, read path, write path, and invalidation
> trigger all live there. This file keeps the architecture rationale: the
> bucket model, gen-bump algorithm, route → cache layering, phase plan, and
> risk register. If this file and docs/20 ever disagree about a key's
> shape / TTL / gen / CRUD, **docs/20 wins** — open a doc-fix PR against
> this file.
>
> Companion to `docs/18-quality-baseline.md`.

---

## 1. Boundary & layering

### 1.1 Single business cache layer
- **Worker KV is the only business-data cache.** All other layers stay
  cache-free for forum/thread/post/digest/user/PM data.
- **Next.js fetch cache is disabled by contract.** `apps/web/src/lib/forum-api.ts`
  always sets `cache: "no-store"` when calling the Worker. This is a binding
  architectural constraint; reverting it requires updating this doc first.
- **`apps/admin/src/lib/api-client.ts`** also passes `cache: "no-store"`
  (line 82) so the admin frontend never accidentally relies on the Next
  data cache.
- **HTTP / Cloudflare edge cache** is reserved for **immutable** static
  assets only (e.g. `lib/postImage.ts:156-163` `Cache-Control: public,
  max-age=31536000, immutable`). API JSON responses do not opt into edge
  cache.

### 1.2 What we cache
v3 caches **response-ready payloads**, i.e. the JSON the route handler would
return for the current API contract. Caching DB rows directly is allowed only
for primitives that are reused across many list views (`user:mini`,
`user:public`, `settings:all`).

> **Caches do not change API contract.** The cached payload must be byte-identical
> to what the route would return today. If a list response should later carry
> author/attachment fan-out, that is an API-contract change — open a separate
> task; do not bundle it with caching.

### 1.3 Correctness vs. TTL
- Correctness comes from **explicit invalidation**, not TTL.
- TTL is a performance safety net for unexpected miss storms and to bound
  memory inside KV. It is not a substitute for a missing invalidation hook.
- Every cache entry must declare both a TTL and an invalidator (gen bump or
  delete) in docs/20, except explicitly documented low-criticality TTL-only
  entries such as `public-stats` (docs/20 §8.2).

---

## 2. Key schema

### 2.1 Naming
```
<domain>:<view-or-entity>:<schemaVer>:<scopeKeys...>:[g<gen>]
```
- `domain`: `forum | thread | post | digest | user | pm | search | settings | stats | sys`
- `schemaVer`: `v2`. (`v1` is the historical schema; the `forums:tree:v1` /
  `forums:volatile:v1` forum cache has been removed. Any remaining `v1` keys
  for unrelated domains — `user:mini:`, `settings:all`, `public-stats` — are
  scheduled to migrate to the `v2` schema in their respective phases.)
- Trailing `g<gen>`: optional generation token embedded in the key. After a
  bump, old gens are simply unreferenced and expire by TTL — no fanout delete.

### 2.2 Visibility bucket
Cross-forum or forum-visibility-sensitive cache keys must include a
visibility bucket derived from `buildForumVisibilityFilter`
(`apps/worker/src/lib/visibility.ts:107-125`):

| Bucket   | Maps to                                                 | Forum visibilities seen |
|----------|---------------------------------------------------------|--------------------------|
| `anon`   | not logged in                                           | `public`                 |
| `member` | logged in, `UserRole.User`                              | `public`, `members`      |
| `staff`  | logged in, `UserRole.Mod` or `SuperMod`                 | `public`, `members`, `staff` |
| `admin`  | logged in, `UserRole.Admin`                             | `public`, `members`, `staff`, `admin` |

`UserRole` is defined in `packages/types/src/types.ts:81-86` and is
**non-monotonic** (`User=0, Admin=1, SuperMod=2, Mod=3`). All bucket logic
must use `===` enumerations, never `<=` thresholds. `admin` is **always
independent**; mixing Admin into `staff` would leak admin-only forums to
mods.

### 2.3 Viewer bucket (for `user:public`)
A separate, smaller bucket exists for the `PublicUser` cache because of the
conditional `regIp/lastIp` fields (`packages/types/src/types.ts:228-231`):

| Viewer bucket | Maps to                                       |
|---------------|-----------------------------------------------|
| `public`      | anon, member                                  |
| `staff`       | Mod, SuperMod, Admin                          |

Two-bucket because non-staff viewers see the same field set. This bucket is
**named differently** from the visibility bucket to avoid confusion.

### 2.4 Per-user keys
Private data (PM, unread count, future per-user reads) must include `userId`
and **must not** carry a visibility bucket — the user is their own bucket.

### 2.5 Page bucket
Only `page=1` (or no cursor / no `page` param) is cached. Deep pagination
goes straight to D1. Limit is collapsed to a few canonical buckets
(e.g. `20|50|100`) so the key space stays small.

---

## 3. Generation / epoch

### 3.1 Bump algorithm
A generation token is a string in KV. `bumpGen` produces a fresh token:
```
gen = `${Date.now()}-${crypto.randomUUID()}`
```
`Date.now()` alone is unsafe — same-millisecond bumps could collide and let
post-bump readers re-populate the cache under the previous gen. The UUID
suffix guarantees uniqueness per bump.

### 3.2 Reads
On read, the handler resolves the current gen via `getGen(env, genKey)` and
embeds it into the cache key. A miss falls through to D1 and writes back at
the new gen. Older gens are unreachable and expire by TTL — there is no
delete fanout.

Within one request, gens are memoized per request to avoid multiple
`KV.get(genKey)` calls for the same scope.

### 3.3 Generation key inventory

> **Authoritative table:** docs/20 §11. The full list of gen keys, their
> bump helpers, and the cache keys they control lives there. Keep design
> changes (e.g. introducing a new gen dimension) in this section; keep
> per-key facts in docs/20.

### 3.3.1 `admin/statistics/recalc-threads` and per-thread caches
Phase 1 only invalidated `forum:summary:gen` from `recalc-threads`, which was
sufficient because no per-thread / per-forum thread-list cache existed yet.

**Phase 3 ships option (b)** for `thread:list:v2`: a global
`thread:list:gen:all` is embedded into the cache key alongside the per-forum
`thread:list:gen:<forumId>`. The thread-list key is therefore stamped with
**both** gens (`...:p1:gf<forumGen>:ga<allGen>`), and `recalc-threads` bumps
exactly one of them:

- **scoped** (`{forumId: N}`) → `bumpThreadListGen(env, N)` only.
- **unscoped** → `bumpThreadListGenAll(env)` only — a single KV write
  invalidates every per-forum thread-list cache in one stroke.

Option (a) (targeted per-thread/per-forum bumps after collecting touched rows)
was rejected for `recalc-threads` because the operation is rare, low-frequency,
and a coarse global bump is cheaper than collecting and deduping touched
forums. Phase 4 (`thread:meta:v2`) will revisit this for `thread:meta:gen`
when it ships.


### 3.4 Single-key delete inventory

> **Authoritative list:** docs/20 §6, §7, §8 (per-domain CRUD/invalidation
> rows). KV has no wildcard delete, so all variants must be enumerated;
> `deleteUserPublicVariants` is a thin helper that deletes both viewer-
> bucket variants (`public` and `staff`) every time.

---

## 4. Cache key inventory (v2)

> **Authoritative table:** docs/20 §1–§8. The full per-key reference
> (key pattern, payload, TTL, gen, read/write paths, status) lives there.
>
> `public-stats` (v1 literal key, see docs/20 §8.2) is the only entry
> whose correctness relies on TTL alone. Public stats are non-critical
> and slowly-moving; explicit invalidation would add invalidator wiring
> in many admin paths for marginal value.

### 4.1 `forum:summary:v2` / `forum:meta:v2` visible-last-thread semantics

The `last_thread_*` and `last_poster*` fields exposed on `forum:summary:v2`
list rows and on `forum:meta:v2` (single-forum meta on the read-by-id miss
path) **must reflect the latest *visible* thread**, not the raw
`forums.last_thread_id` row, which can point at a hidden / recycled thread.

Concretely:
- "Visible" = `THREAD_VISIBLE` SQL fragment **plus** `sticky >= 0` (i.e. not
  a soft-hidden / recycled thread). The list snapshot uses
  `fetchVisibleLastThreadsForSnapshot` in
  `apps/worker/src/lib/cache/forum-read.ts`; the getById meta miss path
  uses `fetchVisibleLastThreads` in `apps/worker/src/handlers/forum.ts`.
- The cached row's `last_thread_id`, `last_thread_subject`, `last_post_at`,
  `last_poster`, `last_poster_id`, **avatar fields** are taken from the
  visible-last-thread query result. If no visible thread exists, all of
  these fields are cleared (empty / 0 / null).
- The avatar (`avatar`, `avatar_path`) is bound to the **visible
  `lastPosterId`**, never to whatever `forums.last_poster_id` happened to
  be at write time. Avatars are resolved via a single batched
  `SELECT ... FROM users WHERE id IN (...)` over moderator IDs ∪ visible
  last-poster IDs.
- The same semantics apply to the getById meta-miss path
  (`loadFullForumFromD1` in `apps/worker/src/handlers/forum.ts`): no
  `LEFT JOIN users` on `forums.last_poster_id`; instead resolve the
  visible last thread first, then fetch the visible poster's avatar.

This is enforced by `tests/unit/handlers/forum-v2-cache.test.ts`
(visible-overrides-hidden, no-visible-clears, miss-path-uses-visible-avatar).

---

## 5. Read route → cache layering

Layering legend:
- **cache** — full Worker KV cache via the helpers in §7 (live today)
- **planned cache** — handler currently no-cache; the listed key is
  scheduled for the named phase. Treat as "no-cache" for any reasoning
  about today's behavior.
- **cache via primitive** — handler does not cache its own response, but
  enriches via `user:mini` (live, opt-in via `USE_KV_USER_CACHE`)
- **edge cache** — Cloudflare HTTP cache only
- **no-cache** — direct D1 every request

| Route                                                | Layering            | Notes |
|------------------------------------------------------|---------------------|-------|
| `GET /api/live`                                      | no-cache            | health probe |
| `GET /api/v1/forums`                                 | cache               | `forum:tree:v2` + `forum:summary:v2`, per-bucket |
| `GET /api/v1/forums/:id/ancestors`                   | cache               | reuses `forum:tree:v2` |
| `GET /api/v1/forums/:id`                             | cache               | `forum:meta:v2` |
| `GET /api/v1/threads?forumId=…`                      | cache (page1) / no-cache (deep) | `thread:list:v2`; uses `user:mini` primitive when `USE_KV_USER_CACHE=true` |
| `GET /api/v1/threads/:id`                            | planned cache (Phase 4) | live: no-cache; planned `thread:meta:v2`; **view-count UPDATE preserved** (§6.4) |
| `GET /api/v1/posts?threadId=…`                       | planned cache (Phase 4) | live: no-cache; planned `post:list:v2` |
| `GET /api/v1/posts/:id`                              | no-cache            | low-traffic single-post fetch |
| `GET /api/v1/posts/:id/attachments`                  | no-cache            | considered for inline-with-post in a future API contract change, not now |
| `GET /api/v1/users/:id`                              | planned cache (Phase 6) | live: no-cache; planned `user:public:v2:<id>:<viewerBucket>` |
| `GET /api/v1/users/:id/avatar-path`                  | no-cache            | covered by edge cache via `apps/web/src/lib/avatar-proxy.ts` (7d / 24h / 0) |
| `GET /api/v1/users/:id/threads\|posts\|digest`       | no-cache            | low ROI; revisit in Phase 7 |
| `GET /api/v1/users/search`                           | no-cache            | user-supplied query |
| `GET /api/v1/users/batch`                            | no-cache (first release) | future variant could fan-out via `user:public:v2`, separate task |
| `GET /api/v1/search/threads`                         | no-cache (uses `user:mini` primitive when `USE_KV_USER_CACHE=true`) | FTS query varies; settings lookup goes through `getSetting` |
| `GET /api/v1/digest`                                 | planned cache (Phase 5) | live: no-cache; planned `digest:list:v2` |
| `GET /api/v1/digest/stats`                           | planned cache (Phase 5) | live: no-cache; planned `digest:stats:v2` |
| `GET /api/v1/digest/filters`                         | planned cache (Phase 5) | live: no-cache; planned `digest:filters:v2` (via `digest:gen`) |
| `GET /api/v1/stats`                                  | cache (TTL only)    | `public-stats` (v1 literal key, 60 s TTL) |
| `GET /api/v1/settings`                               | cache               | `settings:all` (v1 literal key, 24 h TTL, explicit delete on PUT) |
| `GET /api/v1/auth/me`                                | no-cache            | per-request identity |
| `GET /api/v1/auth/check-username`                    | no-cache            | mutating gate |
| `GET /api/v1/messages?box=…`                         | planned cache (Phase 6) | live: no-cache; planned short private cache `pm:inbox:v2` |
| `GET /api/v1/messages/unread-count`                  | planned cache (Phase 6) | live: no-cache; planned short private cache `pm:unread:v2` |
| `GET /api/v1/messages/:id`                           | no-cache            | GET writes `is_read = 1`; planned PM caches must invalidate inbox + unread on write |
| `GET /api/v1/post-comments`                          | no-cache            | low traffic; future cache uses `post-comments:list:gen:<postId>`, **not** `post:list:gen` |
| `GET /api/v1/posting-permission`                     | no-cache            | per-user, real-time |
| `GET /api/v1/checkin/status`                         | no-cache            | per-user, daily |
| `GET /api/v1/post-images/*`                          | edge cache          | already `Cache-Control: public, max-age=31536000, immutable` |
| `GET /api/admin/*`                                   | no-cache            | admins always see fresh data |
| `GET /api/v1/moderation/users/:id/status\|ip-records` | no-cache           | mod live data |

---

## 6. Write path → invalidation matrix

> **Authoritative matrix:** docs/20 §3.1, §6, §7, §8 (per-domain
> invalidation rows). The legacy combined matrix below has been split into
> the per-key sections in docs/20 so each row lives next to the cache it
> invalidates.

### 6.4 View-count semantics
`GET /api/v1/threads/:id` currently issues a fire-and-forget
`UPDATE threads SET views = views + 1 WHERE id = ?`. Even when the cache is
hit, the handler must still issue this write via `ctx.waitUntil`. Cache hit
must not silently drop the view increment. View-count batching is a
**separate** optimization task and is intentionally out of scope for the
first release.

---

## 7. Foundation modules

Implemented under `apps/worker/src/lib/cache/`:

| Module               | Surface                                                                                       |
|----------------------|-----------------------------------------------------------------------------------------------|
| `keys.ts`            | Pure key builders: `forumTreeKey(bucket, gen)`, `forumSummaryKey(bucket, gen)`, `forumMetaKey(forumId, bucket, gen)`, `threadListKey(...)`, `threadMetaKey(...)`, `postListKey(...)`, `digestListKey(...)`, `digestStatsKey(...)`, `digestFiltersKey(...)`, `userMiniKey(id)`, `userPublicKey(id, viewerBucket)`, `pmInboxKey(userId, box)`, `pmUnreadKey(userId)`, `settingsAllKey()`, `statsPublicKey()` |
| `bucket.ts`          | `computeVisibilityBucket(visCtx) → "anon" \| "member" \| "staff" \| "admin"`; `computeViewerBucket(visCtx) → "public" \| "staff"` |
| `epoch.ts`           | `getGen(env, genKey) → Promise<string>` (per-request memoized); `bumpGen(env, genKey) → Promise<string>` (`${Date.now()}-${crypto.randomUUID()}`) |
| `wrap.ts`            | `cacheGetOrSet<T>(env, ctx, key, ttl, loader, validator?)`: KV.get → optional validator → on miss/invalid call loader → `ctx.waitUntil(KV.put(...))` → return value |
| `invalidate.ts`      | One function per write category; `deleteUserPublicVariants(env, id)`; bump-gen helpers grouped per domain |
| `metrics.ts`         | Optional `X-Ellie-KV: hit/miss/<key>` debug header, only when `env.KV_DEBUG === "true"`. (Admin-token gating is intentionally **not** wired in Phase 7 — it would pull auth into the cache helper. Re-evaluate later.) |

### 7.1 Test ownership
- Unit tests under `apps/worker/tests/unit/lib/cache/*.test.ts` exercise key
  builders, bucket builder, epoch (mock KV), `cacheGetOrSet` hit/miss/validator
  paths, and invalidator helpers.
- L2 integration tests verify **behavior only**: "GET → write → GET returns
  new value"; they do not assert on KV key strings or KV call counts.

---

## 8. Schema migration history

- `forum:tree:v2` / `forum:summary:v2` / `forum:meta:v2` / `forums/:id/ancestors`
  fully replaced the `v1` `forums:tree:v1` + `forums:volatile:v1` forum cache.
  The legacy `apps/worker/src/lib/forum-cache.ts` module and the
  `USE_KV_FORUM_CACHE_V2` feature flag have been removed. The forum read path
  goes directly through v2 KV cache; correctness is enforced by the v2
  invalidation matrix in §6.
- All forum write paths invalidate v2 only via
  `invalidateForumStructureV2` / `invalidateForumReorderV2` /
  `invalidateForumUpdateV2({affectsDigest})` / `invalidateForumSummaryV2`.
  `apps/worker/src/handlers/admin/statistics.ts` continues to bump
  `forum:summary:gen` directly.
- Any orphaned `v1` KV keys still present in production naturally expire by
  TTL (10 min for `forums:tree:v1`, 60 s for `forums:volatile:v1`); no
  reader path resolves them.

---

## 9. Implementation phases & first release scope

| Phase | Scope                                                                                          | Status   |
|-------|------------------------------------------------------------------------------------------------|----------|
| 0     | This doc.                                                                                      | Phase 0  |
| 1     | Foundation helpers under `apps/worker/src/lib/cache/`. Fix existing invalidation gaps (thread/post create → forum volatile; admin statistics recalc-{forums,threads,users}; admin user batch-status / batch-role / batch-recalc-counters; single recalcCounters). `search.ts` reads `general.search.enabled` via `getSetting`. `apps/admin/src/lib/api-client.ts` sets `cache: "no-store"`. **No new business cache.** | Phase 1  |
| 2     | `forum:tree:v2` + `forum:summary:v2` + `forum:meta:v2` + `forums/:id/ancestors`. Visible-last-thread semantics (§4.1). v2 invalidation wired across forum CRUD/reorder/update/merge via `invalidateForumStructureV2` / `invalidateForumReorderV2` / `invalidateForumUpdateV2({affectsDigest})` / `invalidateForumSummaryV2`. Reuses `lib/cache/` from Phase 1. v1 forum cache + `USE_KV_FORUM_CACHE_V2` flag removed in the same release; forum read path is v2-only. | Phase 2  |
| 3     | `thread:list:v2` for `GET /api/v1/threads?forumId=…&page=1`. Two-gen scheme (`thread:list:gen:<forumId>` + `thread:list:gen:all`); bucket-independent payload guarded by `forum:meta:v2` visibility gate before cache lookup. §3.3.1 option (b) implemented for `recalc-threads`. Full invalidation matrix wired across moderation / admin / user-content write paths. | Phase 3  |
| 4     | `post:list:v2` + `thread:meta:v2`. View-count batching not included. **Same §3.3.1 gate applies for `thread:meta:v2`.** | deferred |
| 5     | `digest:list:v2` / `digest:stats:v2` / `digest:filters:v2`.                                     | deferred |
| 6     | `user:public:v2` + PM short private cache.                                                     | deferred |
| 7     | Hardening: cache metrics, evaluate per-forum `forum:meta:gen`, evaluate `users/batch` cache, view-count batching evaluation. | deferred |

**First release = Phase 0 + 1 + 2 + 3.** Phases 4–7 are dispatched separately
after Phase 3 lands and is observed.

---

## 10. Risk register

| Risk                                                                          | Mitigation |
|-------------------------------------------------------------------------------|------------|
| Bucket misuse leaks admin-only forum content to anon                          | bucket builder centralized in `lib/cache/bucket.ts`; unit tests cover all role inputs; review checklist requires bucket annotation per v2 key |
| Missing gen bump leaks stale read after write                                 | invalidators centralized in `lib/cache/invalidate.ts`; §6 matrix is authoritative; L2 covers key write→read chains |
| Schema drift breaks deserialization of older v2 payloads                      | bump key suffix to `v3` for breaking changes; `cacheGetOrSet` accepts a `validator` so each entry enforces its own minimum field guard |
| KV.get for gen lookup adds latency to hot paths                               | per-request in-memory memo of resolved gens; KV.get is colo-local |
| Cache miss storm after gen bump                                               | TTLs staggered; high-traffic loaders may use `ctx.waitUntil` for async warm without blocking response |
| Admin frontend silently re-enables Next data cache via fetch defaults         | Phase 1 adds explicit `cache: "no-store"` |
| `users/batch` accidentally fan-outs `user:mini` and leaks the wider PublicUser shape | first release keeps `users/batch` no-cache; future cache uses `user:public:v2`, never `user:mini` |
| KV wildcard delete assumed to exist                                           | `deleteUserPublicVariants` (and any future variant deleter) enumerates all bucket keys |

---

## 11. How to change this baseline

1. **Per-key facts** (pattern, payload, TTL, gen wiring, invalidation
   trigger) live in **docs/20**. Update docs/20 in the same commit as the
   code change.
2. **This file** (docs/19) covers architecture rationale: bucket model,
   gen-bump algorithm, route → cache layering, phase plan, risk register.
   Update §2 / §3 / §5 / §9 / §10 here when those rules change.
3. Adding a new cache key requires:
   - new section in docs/20 §1–§10 with key pattern, payload, TTL,
     gen wiring, read/write paths, status;
   - if it is gen-keyed, also a row in docs/20 §11;
   - bucket declaration here (§2.2) when introducing a new bucket dimension.
4. Adding a new generation key requires a row in docs/20 §11; if it
   introduces a new dimension (e.g. per-thread vs per-forum) discuss the
   tradeoff in §3.3.1 here.
5. Schema-breaking changes bump the key suffix from `v2` to `v3` (and so
   on). Old `v2` payloads then expire by TTL; no migration runtime needed.
   Document the migration step in docs/20 §12.
