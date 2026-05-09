# 19 — Worker KV Cache Architecture

> **Status:** v3.1 frozen — architecture doc only. No code changes in this commit.
>
> Companion to `docs/18-quality-baseline.md`. This file is the canonical reference
> for Worker-side KV cache design. Any later change to key schema, bucket
> rules, TTLs, or invalidation semantics must update this file in the same
> commit.

---

## 1. Boundary & layering

### 1.1 Single business cache layer
- **Worker KV is the only business-data cache.** All other layers stay
  cache-free for forum/thread/post/digest/user/PM data.
- **Next.js fetch cache is disabled by contract.** `apps/web/src/lib/forum-api.ts`
  always sets `cache: "no-store"` when calling the Worker. This is a binding
  architectural constraint; reverting it requires updating this doc first.
- **`apps/admin/src/lib/api-client.ts`** must also pass `cache: "no-store"` so
  the admin frontend never accidentally relies on Next data cache. (Phase 1
  task — currently the option is omitted, which leaves behavior to Next
  defaults.)
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
  delete) in §6 below, except explicitly documented low-criticality TTL-only
  entries such as `stats:public:v2` (§4).

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

| Gen key                              | Bump on                                                                      |
|--------------------------------------|------------------------------------------------------------------------------|
| `forum:tree:gen`                     | admin forum create / update / delete / reorder / merge                       |
| `forum:summary:gen`                  | any thread / post create / delete / move / sticky / digest / highlight / admin forum write / admin statistics recalc-{forums,threads} |
| `thread:list:gen:<forumId>`          | thread create in forum / move IN/OUT of forum / delete / sticky / digest / close / highlight / admin batch / admin thread CRUD / moderation full set / scoped `recalc-threads` |
| `thread:list:gen:all`                | unscoped `admin/statistics/recalc-threads` (global thread-list invalidation; embedded into every `thread:list:v2` key alongside per-forum gen — see §3.3.1) |
| `thread:meta:gen:<threadId>`         | thread row writes / posts count change                                       |
| `post:list:gen:<threadId>`           | reply create / `editMyPost` / mod editPost / mod delPost / admin post.* / admin batch |
| `digest:gen`                         | mod digest set/unset, thread delete with `digestLevel > 0`, admin forum rename or visibility change |

Per-forum `forum:meta:gen:<forumId>` is **not** introduced in the first
release. The global `forum:summary:gen` is sufficient until measured write
frequency demands finer granularity (re-evaluate in Phase 7).

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
Used only for stable single-entity caches:

| Cache                           | Delete on                                                                     |
|---------------------------------|-------------------------------------------------------------------------------|
| `user:mini:v2:<id>`             | `me.updateProfile` (avatar) / admin user update / nuke / purge / ban / batch-status / batch-role / batch-recalc-counters / single recalcCounters / admin statistics recalc-users |
| `user:public:v2:<id>:public` + `user:public:v2:<id>:staff` (always both) | same triggers as `user:mini:v2:<id>`, called via `deleteUserPublicVariants(env, id)` |
| `settings:all:v2`               | admin settings PUT                                                            |
| `pm:unread:v2:<userId>` + `pm:inbox:v2:<userId>:inbox:p1` | `messages.markAsRead` (incl. via GET `/messages/:id`) / `messages.create` (for receiver) / `messages.markAllRead` / `messages.remove` |

**There is no wildcard delete in KV.** All variants must be enumerated.
`deleteUserPublicVariants` is a thin helper that deletes both viewer-bucket
variants (`public` and `staff`) every time.

---

## 4. Cache key inventory (v2)

| Key                                                                                  | TTL     | Bucket             | Generation           |
|--------------------------------------------------------------------------------------|---------|--------------------|----------------------|
| `forum:tree:v2:<bucket>:g<gen>`                                                      | 24h     | anon/member/staff/admin | `forum:tree:gen`     |
| `forum:summary:v2:<bucket>:g<gen>`                                                   | 5–10min | anon/member/staff/admin | `forum:summary:gen`  |
| `forum:meta:v2:<forumId>:<bucket>:g<gen>`                                            | 10min   | anon/member/staff/admin | `forum:summary:gen`  |
| `thread:list:v2:<forumId>:<sort>:<limitBucket>:p1:gf<forumGen>:ga<allGen>`            | 5min    | bucket-independent (forum visibility gate via `forum:meta:v2` BEFORE cache lookup) | `thread:list:gen:<forumId>` + `thread:list:gen:all` |
| `thread:meta:v2:<threadId>:<bucket>:g<gen>`                                          | 2min    | anon/member/staff/admin | `thread:meta:gen:<threadId>` |
| `post:list:v2:<threadId>:<limitBucket>:<bucket>:p1:g<gen>`                           | 2min    | anon/member/staff/admin | `post:list:gen:<threadId>` |
| `digest:list:v2:<bucket>:<forumId\|all>:<level\|all>:<year\|all>:p1:g<gen>`          | 30min   | anon/member/staff/admin | `digest:gen`         |
| `digest:stats:v2:<bucket>:g<gen>`                                                    | 1h      | anon/member/staff/admin | `digest:gen`         |
| `digest:filters:v2:<bucket>:g<gen>`                                                  | 24h     | anon/member/staff/admin | `digest:gen`         |
| `user:mini:v2:<id>`                                                                  | 24h     | —                  | delete               |
| `user:public:v2:<id>:<viewerBucket>` (`viewerBucket ∈ {public, staff}`)              | 1h      | public/staff       | delete (enumerate both) |
| `pm:inbox:v2:<userId>:<box>:p1`                                                      | 30s     | per-user           | delete               |
| `pm:unread:v2:<userId>`                                                              | 30s     | per-user           | delete               |
| `settings:all:v2`                                                                    | 24h     | —                  | delete               |
| `stats:public:v2`                                                                    | 60s     | —                  | TTL only             |

`stats:public:v2` is the only entry whose correctness relies on TTL alone.
Public stats are non-critical and slowly-moving; explicit invalidation would
add invalidator wiring in many admin paths for marginal value.

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
- **cache** — full Worker KV cache via the helpers in §7
- **cache via primitive** — handler does not cache its own response, but
  enriches via `user:mini:v2` / `user:public:v2` (which are cached)
- **short private cache** — per-user, ≤30s TTL
- **edge cache** — Cloudflare HTTP cache only
- **no-cache** — direct D1 every request

| Route                                                | Layering            | Notes |
|------------------------------------------------------|---------------------|-------|
| `GET /api/live`                                      | no-cache            | health probe |
| `GET /api/v1/forums`                                 | cache               | tree + summary, per-bucket |
| `GET /api/v1/forums/:id/ancestors`                   | cache               | reuses `forum:tree:v2` |
| `GET /api/v1/forums/:id`                             | cache               | `forum:meta:v2` |
| `GET /api/v1/threads?forumId=…`                      | cache (page1) / no-cache (deep) | `thread:list:v2` |
| `GET /api/v1/threads/:id`                            | cache               | `thread:meta:v2`; **view-count UPDATE preserved** (§6.4) |
| `GET /api/v1/posts?threadId=…`                       | cache (page1) / no-cache (deep) | `post:list:v2` |
| `GET /api/v1/posts/:id`                              | no-cache            | low-traffic single-post fetch |
| `GET /api/v1/posts/:id/attachments`                  | no-cache            | considered for inline-with-post in a future API contract change, not now |
| `GET /api/v1/users/:id`                              | cache               | `user:public:v2:<id>:<viewerBucket>` |
| `GET /api/v1/users/:id/avatar-path`                  | no-cache            | covered by edge cache via `apps/web/src/lib/avatar-proxy.ts` (7d / 24h / 0) |
| `GET /api/v1/users/:id/threads\|posts\|digest`       | no-cache            | low ROI; revisit in Phase 7 |
| `GET /api/v1/users/search`                           | no-cache            | user-supplied query |
| `GET /api/v1/users/batch`                            | no-cache (first release) | future variant could fan-out via `user:public:v2`, separate task |
| `GET /api/v1/search/threads`                         | no-cache            | FTS query varies; settings lookup goes through `getSetting` |
| `GET /api/v1/digest`                                 | cache (page1)       | `digest:list:v2` |
| `GET /api/v1/digest/stats`                           | cache               | `digest:stats:v2` |
| `GET /api/v1/digest/filters`                         | cache               | `digest:filters:v2` (via `digest:gen`) |
| `GET /api/v1/stats`                                  | cache               | `stats:public:v2` (TTL only) |
| `GET /api/v1/settings`                               | cache               | `settings:all:v2` |
| `GET /api/v1/auth/me`                                | no-cache            | per-request identity |
| `GET /api/v1/auth/check-username`                    | no-cache            | mutating gate |
| `GET /api/v1/messages?box=…`                         | short private cache | `pm:inbox:v2` |
| `GET /api/v1/messages/unread-count`                  | short private cache | `pm:unread:v2` |
| `GET /api/v1/messages/:id`                           | no-cache            | GET writes `is_read = 1`; must invalidate inbox + unread (§6) |
| `GET /api/v1/post-comments`                          | no-cache            | low traffic; future cache uses `post-comments:list:gen:<postId>`, **not** `post:list:gen` |
| `GET /api/v1/posting-permission`                     | no-cache            | per-user, real-time |
| `GET /api/v1/checkin/status`                         | no-cache            | per-user, daily |
| `GET /api/v1/post-images/*`                          | edge cache          | already `Cache-Control: public, max-age=31536000, immutable` |
| `GET /api/admin/*`                                   | no-cache            | admins always see fresh data |
| `GET /api/v1/moderation/users/:id/status\|ip-records` | no-cache           | mod live data |

---

## 6. Write path → invalidation matrix

| Write path                                              | Bump gen                                                                                          | Delete keys |
|---------------------------------------------------------|---------------------------------------------------------------------------------------------------|-------------|
| `POST /api/v1/threads`                                  | `forum:summary:gen`, `thread:list:gen:<forumId>`                                                  | — |
| `POST /api/v1/posts`                                    | `forum:summary:gen`, `thread:list:gen:<forumId>`, `thread:meta:gen:<threadId>`, `post:list:gen:<threadId>` | — |
| `PATCH /api/v1/me/posts/:id`                            | `post:list:gen:<threadId>`, `thread:meta:gen:<threadId>`                                          | — |
| `DELETE /api/v1/me/posts/:id`                           | `post:list:gen:<threadId>`, `thread:meta:gen:<threadId>`, `thread:list:gen:<forumId>`, `forum:summary:gen` | — |
| `DELETE /api/v1/me/threads/:id`                         | `forum:summary:gen`, `thread:list:gen:<forumId>`                                                  | — |
| moderation thread sticky / digest / close / highlight   | `thread:list:gen:<forumId>`, `thread:meta:gen:<threadId>` (+ `digest:gen` when digest changes)    | — |
| moderation thread move (forum X → Y)                    | `thread:list:gen:<X>`, `thread:list:gen:<Y>`, `forum:summary:gen`, `thread:meta:gen:<threadId>`   | — |
| moderation thread delete                                | `forum:summary:gen`, `thread:list:gen:<forumId>` (+ `digest:gen` if digestLevel > 0)              | — |
| moderation post edit                                    | `post:list:gen:<threadId>`, `thread:meta:gen:<threadId>`                                          | — |
| moderation post delete                                  | `post:list:gen:<threadId>`, `thread:meta:gen:<threadId>`, `thread:list:gen:<forumId>`, `forum:summary:gen` | — |
| `POST /api/v1/post-comments`                            | —                                                                                                 | — |
| `POST /api/v1/checkin`                                  | —                                                                                                 | — |
| `PATCH /api/v1/users/me` (avatar)                       | —                                                                                                 | `user:mini:v2:<userId>`, `deleteUserPublicVariants(env, userId)` |
| `POST /api/v1/users/me/email/verify`                    | —                                                                                                 | `deleteUserPublicVariants(env, userId)` |
| `POST /api/v1/users/me/password`                        | —                                                                                                 | — |
| admin forum CRUD / merge                                | `forum:tree:gen`, `forum:summary:gen`, `digest:gen` (create / delete / merge always touch digest filters) | — |
| admin forum reorder                                     | `forum:tree:gen`, `forum:summary:gen` (NOT `digest:gen` — display order is not a digest filter) | — |
| admin forum update                                      | `forum:tree:gen`, `forum:summary:gen`; `digest:gen` only when one of `name / status / visibility / parent_id / type` is in the patch (`afterUpdate` reads DB-column-keyed `data`, so the field-presence check uses snake_case `parent_id`) | — |
| admin thread CRUD / batch                               | `thread:list:gen:<forumId>`, `forum:summary:gen`, `thread:meta:gen:<threadId>`                    | — |
| admin post edit                                         | `post:list:gen:<threadId>`, `thread:meta:gen:<threadId>`                                          | — |
| admin post delete / batch-delete                        | `post:list:gen:<threadId>`, `thread:meta:gen:<threadId>`, `thread:list:gen:<forumId>`, `forum:summary:gen` | — |
| admin user CRUD / nuke / purge / ban                    | —                                                                                                 | `user:mini:v2:<id>`, `deleteUserPublicVariants(env, id)` |
| admin user batch-status / batch-role / batch-recalc-counters | —                                                                                            | per-id `user:mini:v2:<id>` + `deleteUserPublicVariants(env, id)` |
| admin statistics recalc-forums                          | `forum:summary:gen`                                                                               | — |
| admin statistics recalc-threads                         | scoped (`{forumId: N}`) → `forum:summary:gen` + `thread:list:gen:<N>`; unscoped → `forum:summary:gen` + `thread:list:gen:all` (see §3.3.1) | — |
| admin statistics recalc-users                           | —                                                                                                 | per-id `user:mini:v2:<id>` + `deleteUserPublicVariants(env, id)` |
| admin settings PUT                                      | —                                                                                                 | `settings:all:v2` |
| admin announcement / report / censor / ipBan / adminLog | —                                                                                                 | — |
| `POST /api/v1/messages` (`messages.create`)             | —                                                                                                 | `pm:unread:v2:<receiverId>`, `pm:inbox:v2:<receiverId>:inbox:p1` |
| `POST /api/v1/messages/mark-all-read`                   | —                                                                                                 | `pm:unread:v2:<userId>`, `pm:inbox:v2:<userId>:inbox:p1`, `pm:inbox:v2:<userId>:sent:p1` |
| `DELETE /api/v1/messages/:id`                           | —                                                                                                 | `pm:inbox:v2:<userId>:<box>:p1` |
| `GET /api/v1/messages/:id` (writes `is_read = 1`)       | —                                                                                                 | `pm:unread:v2:<userId>`, `pm:inbox:v2:<userId>:inbox:p1` |

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

1. Update §2 / §3 / §4 / §5 / §6 in the same commit as the helper or
   handler change that motivates the change.
2. Adding a new cache key requires a row in §4 + invalidator row in §6 +
   bucket declaration. Entries without a declared invalidator are not
   accepted.
3. Adding a new generation key requires a row in §3.3 with the explicit
   bump trigger list.
4. Schema-breaking changes bump the key suffix from `v2` to `v3` (and so
   on). Old `v2` payloads then expire by TTL; no migration runtime needed.
