# 20 — Worker KV Reference

> **Authoritative reference** for every Cloudflare KV key the Worker reads or
> writes. Use this file when you need to know *what's in KV right now*: key
> pattern, payload shape, TTL, generation key, read path, write/CRUD path,
> and invalidation/expiry trigger.
>
> Companion: `docs/19-worker-kv-cache-architecture.md` carries the design
> rationale (gen scheme, bucket model, phase plan, risk register). Schema /
> payload / CRUD facts live here. **If they ever disagree, this file wins.**
>
> When you change a KV key (shape, TTL, gen, or invalidation trigger), update
> this file in the same commit as the code change.

---

## 0. How to read this doc

Each entry below has the same fields:

- **Key pattern** — literal string template; placeholders in `<>`. The schema
  version segment (`v2`) appears in business cache keys; ad-hoc rate-limit /
  lock / token keys do not carry a schema version.
- **Builder** — TypeScript helper that produces the key (when one exists).
- **Payload** — JSON shape persisted in KV.
- **TTL** — `expirationTtl` passed to `KV.put`. `none` means the key persists
  until deleted or overwritten. `n/a` means the key only stores a tiny token
  whose lifetime is governed by overwrites, not expiration.
- **Gen key / Invalidation** — how stale entries get evicted (gen bump,
  explicit `KV.delete`, or TTL expiry).
- **Read path** — handler / module that reads the key.
- **Write/CRUD path** — handler / module that writes (or deletes) the key.
- **Status** — `shipped` (live in production), `planned` (key builder exists
  but no read/write path uses it yet), or `historical` (legacy schema; no
  reader resolves it; expires by TTL).

Code anchors are paths under `apps/worker/src/`.

---

## 1. Domain index

| Domain    | Keys                                                                                       |
|-----------|--------------------------------------------------------------------------------------------|
| Forum     | `forum:tree:v2`, `forum:summary:v2`, `forum:meta:v2`                                       |
| Thread    | `thread:list:v2` *(shipped)*; `thread:meta:v2` *(planned, Phase 4)*                        |
| Post      | `post:list:v2` *(planned, Phase 4)*                                                        |
| Digest    | `digest:list:v2`, `digest:stats:v2`, `digest:filters:v2` *(planned, Phase 5)*              |
| User      | `user:mini:` *(shipped, v1 schema)*; `user:public:v2` *(planned, Phase 6)*                 |
| PM        | `pm:inbox:v2`, `pm:unread:v2` *(planned, Phase 6)*                                         |
| Settings  | `settings:all` *(shipped, v1 schema)*                                                      |
| Stats     | `public-stats` *(shipped, v1 schema)*; `stats:online_count`, `stats:online_peak`           |
| Online    | `online:<userId>`                                                                          |
| Auth      | `refresh:<token>`, `login-ip:<ip>`, `login-lockout-ip:<ip>`, `reg-ip:<ip>`, `chk-usr-ip:<ip>` |
| Email     | `email_verify:<userId>`, `email_verify_lock:<userId>`                                      |
| Activity  | `activity_throttle:<userId>`                                                               |
| Generation| `forum:tree:gen`, `forum:summary:gen`, `thread:list:gen:<forumId>`, `thread:list:gen:all`, `thread:meta:gen:<threadId>`, `post:list:gen:<threadId>`, `digest:gen` |

---

## 2. Forum domain

### 2.1 `forum:tree:v2:<bucket>:g<gen>` — shipped

- **Builder:** `lib/cache/keys.ts → forumTreeKey(bucket, gen)`
- **Payload (`ForumTreeNodeV2[]` in `lib/cache/forum.ts`):** structural
  forum nodes per visibility bucket — `id`, `parentId`, `name`,
  `description`, `icon`, `displayOrder`, `type`, `status`, `visibility`,
  `moderators` (comma-separated usernames), `moderatorIds` (comma-
  separated user IDs, used by `GET /api/v1/forums/:id/ancestors`), and
  `moderatorList: ModeratorInfo[]`. No volatile aggregates.
- **TTL:** 86 400 s (24 h) — `FORUM_TREE_TTL` in `lib/cache/forum-read.ts`.
- **Bucket:** `anon | member | staff | admin` — see docs/19 §2.2.
- **Gen key:** `forum:tree:gen`.
- **Read:** `lib/cache/forum-read.ts → getForumTreeV2`. Used by
  `GET /api/v1/forums` and `GET /api/v1/forums/:id/ancestors`.
- **Write:** read-through via `cacheGetOrSet`.
- **Invalidation:** `bumpForumTreeGen` from `lib/cache/invalidate.ts`,
  triggered by:
  - admin forum create / delete / merge → `invalidateForumStructureV2`
  - admin forum update → `invalidateForumUpdateV2`
  - admin forum reorder → `invalidateForumReorderV2`

### 2.2 `forum:summary:v2:<bucket>:g<gen>` — shipped

- **Builder:** `lib/cache/keys.ts → forumSummaryKey(bucket, gen)`
- **Payload:** per-forum aggregate row used by the forum-list view —
  `threads`, `posts`, `today_threads`, `last_thread_*`, `last_poster*`,
  including the visible-last-poster avatar / avatar_path. Must reflect the
  latest **visible** thread (see docs/19 §4.1).
- **TTL:** 600 s (10 min) — `FORUM_SUMMARY_TTL`.
- **Bucket:** `anon | member | staff | admin`.
- **Gen key:** `forum:summary:gen`.
- **Read:** `lib/cache/forum-read.ts → getForumSummaryV2`.
- **Write:** read-through via `cacheGetOrSet`.
- **Invalidation:** `bumpForumSummaryGen`. Bumped on:
  - admin forum create / update / delete / merge / reorder
  - admin statistics `recalc-forums`
  - admin statistics `recalc-threads` (scoped + unscoped)
  - admin thread CRUD (delete / batch-delete via
    `invalidateForumVolatileV2`; **subject-only update** also bumps
    summary because `lastThreadSubject` is part of the payload —
    sticky / closed / digest / highlight do NOT bump summary)
  - admin thread move / batch-move
  - admin post delete / batch-delete (`invalidateForumVolatileV2`)
  - admin user `ban(deleteContent=true)` / `nuke` / `purge`
    (each runs `deleteUserContent` then bumps summary)
  - moderation `nukeUser` (`deleteUserContent` then summary)
  - moderation thread move / delete / post delete
    (`invalidateForumVolatileV2`)
  - thread create (`POST /api/v1/threads`) — via `invalidateForumVolatileV2`
  - post create (`POST /api/v1/posts`) — via `invalidateForumVolatileV2`
  - `DELETE /api/v1/me/threads/:id`, `DELETE /api/v1/me/posts/:id`

### 2.3 `forum:meta:v2:<forumId>:<bucket>:g<gen>` — shipped

- **Builder:** `lib/cache/keys.ts → forumMetaKey(forumId, bucket, gen)`
- **Payload:** single-forum meta returned by
  `GET /api/v1/forums/:id` — full forum row plus visible-last-poster
  avatar / avatar_path. Same visibility-aware semantics as `forum:summary:v2`.
- **TTL:** 600 s (10 min) — `FORUM_META_TTL`.
- **Bucket:** `anon | member | staff | admin`.
- **Gen key:** `forum:summary:gen` (intentionally shared — Phase 7 may split
  into per-forum `forum:meta:gen:<forumId>`).
- **Read:** `lib/cache/forum-read.ts → getForumMetaV2`. Also used as the
  visibility gate before `thread:list:v2` lookup in
  `handlers/thread.ts:list`.
- **Write:** read-through via `cacheGetOrSet`.
- **Invalidation:** any bump of `forum:summary:gen` invalidates this key.

---

## 3. Thread domain

### 3.1 `thread:list:v2:<forumId>:default:<limitBucket>:p1:gf<forumGen>:ga<allGen>` — shipped (Phase 3)

- **Builder:** `lib/cache/keys.ts → threadListKey(forumId, limitBucket, forumGen, allGen)`
- **Payload (`ThreadListPayloadV2` in `lib/cache/thread-list-read.ts`):**
  ```ts
  { items: Thread[]; total: number; nextCursor: string | null; limit: number }
  ```
  Bucket-independent — no viewer-conditional fields. `total` and
  `nextCursor` are BOTH always populated (single shared loader for keyset
  page1 and offset page1).
- **TTL:** 60 s — `THREAD_LIST_TTL`.
- **Limit buckets:** `20 | 50 | 100` (`THREAD_LIST_LIMIT_BUCKETS`). Other
  values fall through to D1.
- **Sort segment:** literal `default` — placeholder for a future sort
  dimension. Today only one sort exists (sticky desc, last_post_at desc).
- **Page bucket:** literal `p1` — only page=1 is cacheable (keyset with no
  cursor, OR offset with `page=1`). Deeper pagination falls through to D1.
- **Gen keys (two-gen scheme):**
  - `thread:list:gen:<forumId>` — per-forum
  - `thread:list:gen:all` — global, bumped only by unscoped recalc-threads
- **Visibility gate:** the route MUST resolve `forum:meta:v2` first to
  apply forum visibility per bucket; the cached payload itself is bucket-
  independent on purpose. If a future thread payload introduces any
  per-viewer field, this key MUST add a viewer dimension.
- **Read:** `lib/cache/thread-list-read.ts → getThreadListPageOneV2`,
  invoked from `handlers/thread.ts:list`. Validator
  `isThreadListPayload` rejects pre-`9d39588` rows whose `total` was
  `null`.
- **Write:** read-through via `cacheGetOrSet`; deep pagination never
  writes here.
- **Invalidation matrix (per docs/19 §6):**

| Trigger | Gen bumped |
|---|---|
| `POST /api/v1/threads` | per-forum |
| `POST /api/v1/posts` | per-forum (via `invalidateForumVolatileV2`) |
| `DELETE /api/v1/me/posts/:id` | per-forum |
| `DELETE /api/v1/me/threads/:id` | per-forum |
| Moderation sticky / digest / close / highlight | per-forum |
| Moderation thread move (X → Y) | both per-forum gens (X and Y) |
| Moderation thread delete | per-forum |
| Moderation post delete | per-forum |
| Admin thread CRUD / batch | per-forum (subject change also bumps `forum:summary:gen`) |
| Admin post delete / batch-delete | per-forum |
| Admin batch move (multi-forum) | `invalidateThreadListForForums(uniqueForumIds)` |
| Admin user `ban(deleteContent=true)` / `nuke` / `purge` | per-forum for affected forums (via `invalidateThreadListForForums`); +`bumpDigestGen` if any deleted thread had `digest > 0` |
| Moderation `nukeUser` | per-forum for affected forums; +`bumpDigestGen` conditionally |
| `admin/statistics/recalc-threads` scoped (`{forumId: N}`) | per-forum N |
| `admin/statistics/recalc-threads` unscoped | `thread:list:gen:all` only |

### 3.2 `thread:meta:v2:<threadId>:<bucket>:g<gen>` — planned (Phase 4)

- **Builder:** `lib/cache/keys.ts → threadMetaKey(threadId, bucket, gen)` — exists.
- **Status:** key builder defined, but no read or write path uses it. Phase 4.
- **Planned TTL:** ~120 s (per docs/19 §4).
- **Planned gen key:** `thread:meta:gen:<threadId>` (already defined as
  `threadMetaGenKey`).
- **Planned invalidation:** thread row writes / posts count change /
  moderation single-thread mutations / admin thread CRUD.

---

## 4. Post domain — planned (Phase 4)

### 4.1 `post:list:v2:<threadId>:<limitBucket>:<bucket>:p1:g<gen>` — planned

- **Builder:** `lib/cache/keys.ts → postListKey(threadId, limitBucket, bucket, gen)` — exists.
- **Status:** key builder defined; no read/write path uses it. Phase 4.
- **Planned TTL:** ~120 s.
- **Planned gen key:** `post:list:gen:<threadId>` (`postListGenKey`).
- **Planned invalidation:** reply create / `editMyPost` / mod editPost /
  mod delPost / admin post.* / admin batch.

---

## 5. Digest domain — planned (Phase 5)

All three keys' builders are defined in `lib/cache/keys.ts` but nothing
reads or writes them yet.

### 5.1 `digest:list:v2:<bucket>:<forumId|all>:<level|all>:<year|all>:p1:g<gen>` — planned

- **Builder:** `digestListKey(bucket, forumId, level, year, gen)`
- **Planned TTL:** 30 min.
- **Planned gen key:** `digest:gen`.

### 5.2 `digest:stats:v2:<bucket>:g<gen>` — planned

- **Builder:** `digestStatsKey(bucket, gen)`
- **Planned TTL:** 1 h.
- **Planned gen key:** `digest:gen`.

### 5.3 `digest:filters:v2:<bucket>:g<gen>` — planned

- **Builder:** `digestFiltersKey(bucket, gen)`
- **Planned TTL:** 24 h.
- **Planned gen key:** `digest:gen`.

### 5.4 `digest:gen` — shipped (already bumped today)

- **Builder:** `digestGenKey()`
- **Bumped by:**
  - moderation `setDigest` (mod thread digest set/unset)
  - admin thread `update` when `digest` field changes
  - admin thread delete when `digestLevel > 0`
  - admin forum CRUD / merge (digest filters depend on visible forums)
  - admin forum `update` only for `name | status | visibility | parent_id | type`
    fields (`affectsForumDigest` in `lib/cache/invalidate.ts`)
- The bumps already exist so that when Phase 5 ships the digest caches,
  the invalidation matrix is already correct.

---

## 6. User domain

### 6.1 `user:mini:<id>` — shipped (v1 schema, live)

- **Builder:** literal prefix `user:mini:` in `lib/user-cache.ts`
  (`USER_CACHE_PREFIX`). The v2 builder
  `lib/cache/keys.ts → userMiniKey(id)` produces `user:mini:v2:<id>` —
  this v2 key is reserved for the Phase 6 schema migration; today the
  read path still uses the v1 prefix.
- **Payload (`UserMiniProfile`):**
  ```ts
  { id, username, avatar, avatarPath, role, groupTitle, groupColor, groupStars }
  ```
- **TTL:** 86 400 s (24 h) — `USER_CACHE_TTL`.
- **Bucket:** none (no viewer-conditional fields).
- **Gen key:** none — invalidation by explicit `KV.delete`.
- **Feature flag:** opt-in via `env.USE_KV_USER_CACHE === "true"`
  (see `lib/env.ts:isUserKvCacheEnabled`). Off by default.
- **Read:** `lib/user-cache.ts → getUserProfiles`, called from:
  - `handlers/thread.ts:list` (and the deep-keyset enrichment branch)
  - `handlers/search.ts:searchThreads`
  Forum v2 `getForumSummaryV2` does NOT use `getUserProfiles`; its
  visible-last-poster avatars are resolved by a single batched
  D1 query inside `fetchVisibleLastThreadsForSnapshot` so the
  summary cache stays self-contained.
- **Write:** read-through inside `getUserProfiles`.
- **Invalidation:**
  - `lib/user-cache.ts → invalidateUserCache(env, id)` deletes the
    live v1 key `user:mini:<id>`.
  - `lib/cache/invalidate.ts → invalidateUserCaches(env, id)` deletes
    the planned v2 key `user:mini:v2:<id>` AND both
    `user:public:v2:<id>:{public,staff}` variants.
  - **Live v1 (`user:mini:<id>`) triggers** — the only key actually
    populated today:
    - `handlers/me.ts:updateProfile` when `fields.avatar !== undefined`
      (line 218) calls `invalidateUserCache(env, user.userId)`.
    - All admin write paths below also call `invalidateUserCache` as
      part of the double-delete pattern.
  - **Planned v2 / public variants triggers** — currently pre-deleted
    even though no reader populates them, via the double-delete
    pattern in `handlers/admin/user.ts:invalidateUserCachesForIds`
    which calls BOTH `invalidateUserCache` + `invalidateUserCaches`:
    - admin user update / nuke / purge / ban
    - admin user batch-status / batch-role / batch-recalc-counters
    - single `recalcCounters`
    - admin statistics `recalc-users`
    `me.updateProfile(avatar)` is NOT yet wired to `invalidateUserCaches`
    because the v2 reader is gated off (`USE_KV_USER_CACHE !== "true"`),
    so v2 has no live populator to invalidate from that path.
  - Email verify (`handlers/email.ts:verifyCode`) does NOT invalidate
    user-cache today — the only user-visible field it changes is
    `email`, which is not part of `UserMiniProfile`.

### 6.2 `user:public:v2:<id>:<viewerBucket>` — planned (Phase 6)

- **Builder:** `userPublicKey(id, viewerBucket)` where
  `viewerBucket ∈ {public, staff}`.
- **Status:** key builder + `deleteUserPublicVariants` helper exist.
  No read path caches the public-user response yet.
- **Planned TTL:** 1 h.
- **Planned invalidation:** delete BOTH viewer variants every time the
  underlying user changes (same triggers as `user:mini`). Wired today
  through `invalidateUserCaches` so that when Phase 6 ships, the
  invalidation matrix is already correct.

---

## 7. PM domain — planned (Phase 6)

### 7.1 `pm:inbox:v2:<userId>:<box>:p1` — planned

- **Builder:** `pmInboxKey(userId, box)` where `box ∈ {inbox, sent}`.
- **Status:** key builder defined; no read/write path uses it.
- **Planned TTL:** 30 s.
- **Planned invalidation (delete):**
  - `messages.create` → receiver inbox
  - `messages.markAsRead` (incl. via `GET /messages/:id`) → user's inbox
  - `messages.markAllRead` → user's inbox + sent
  - `messages.remove` → affected box

### 7.2 `pm:unread:v2:<userId>` — planned

- **Builder:** `pmUnreadKey(userId)`
- **Status:** key builder defined; no read/write path uses it.
- **Planned TTL:** 30 s.
- **Planned invalidation (delete):** same triggers as `pm:inbox`.

---

## 8. Settings & Stats

### 8.1 `settings:all` — shipped (v1 schema)

- **Source:** `lib/settings.ts` (literal `KV_KEY = "settings:all"`).
  `settingsAllKey()` in `lib/cache/keys.ts` produces `settings:all:v2`
  but the live read/write path still uses the v1 key.
- **Payload:** `Record<string, string>` of the entire `settings` table
  (key → value).
- **TTL:** 86 400 s (24 h).
- **Read:** `lib/settings.ts → getAllSettings` / `getSetting`.
- **Write:** read-through.
- **Invalidation:** `KV.delete("settings:all")` after admin settings PUT
  (`lib/settings.ts:137`).

### 8.2 `public-stats` — shipped (v1 schema)

- **Source:** `handlers/stats.ts` (literal `CACHE_KEY = "public-stats"`).
  `statsPublicKey()` produces `stats:public:v2` and is reserved for the
  schema migration.
- **Payload (`PublicStats`):** today/yesterday post counts, total threads /
  posts / members, newest member, current online, peak online, peak date.
- **TTL:** 60 s — `CACHE_TTL_SECONDS`.
- **Read & write:** `handlers/stats.ts → stats`.
- **Invalidation:** TTL only. Public stats are non-critical and slowly
  moving; explicit invalidation would add wiring in many admin paths for
  marginal value.

### 8.3 `stats:online_count` — shipped

- **Source:** `lib/online-stats.ts`.
- **Payload:** stringified integer (current logged-in online users in last
  15 min).
- **TTL:** 300 s (5 min).
- **Read:** `handlers/stats.ts` (composes into `public-stats`).
- **Write:** scheduled cron aggregation in `lib/online-stats.ts` (lists
  the `online:` prefix to count active users).

### 8.4 `stats:online_peak` — shipped

- **Source:** `lib/online-stats.ts`.
- **Payload:** `{ count: number; date: string }` — historical peak.
- **TTL:** none (persists indefinitely).
- **Read:** `handlers/stats.ts`.
- **Write:** cron aggregation when current count exceeds the stored peak.

### 8.5 `online:<userId>` — shipped

- **Source:** `middleware/online.ts`.
- **Payload:** small JSON describing the user's last activity (used by
  the cron to count online users and to power moderator live views).
- **TTL:** 900 s (15 min) — `ONLINE_TTL`.
- **Read:** `lib/online-stats.ts` lists the `online:` prefix.
- **Write:** request middleware on every authenticated request
  (`ctx.waitUntil`).
- **Invalidation:** TTL only.

---

## 9. Auth tokens & rate-limit keys

These keys are not "business cache" — they are auth state and abuse-control
counters. They have no gen scheme; correctness is from explicit delete or
TTL expiry.

| Key                                          | TTL                  | Source                              | Purpose |
|----------------------------------------------|----------------------|-------------------------------------|---------|
| `refresh:<refreshToken>`                     | refresh-token TTL    | `handlers/auth.ts`                  | Maps an opaque refresh token to a userId. Deleted on logout, rotated on refresh. |
| `login-ip:<ip>`                              | 3 600 s              | `handlers/auth.ts`                  | Counter for failed login attempts per IP. Deleted on successful login. |
| `login-lockout-ip:<ip>`                      | 86 400 s             | `handlers/auth.ts`                  | Marker key — when present, login from this IP is locked out for 24 h. |
| `reg-ip:<ip>`                                | as set by handler    | `handlers/auth.ts`                  | Counter for registration attempts per IP. |
| `chk-usr-ip:<ip>`                            | 60 s                 | `handlers/auth.ts`                  | Counter for `check-username` calls per IP. |
| `activity_throttle:<userId>`                 | 120 s                | `middleware/activity.ts`            | Throttle marker for the per-user activity update (last-seen + post-count). |

---

## 10. Email verification

Defined in `lib/email-verify.ts`; written from `handlers/email.ts`.

### 10.1 `email_verify:<userId>` — shipped

- **Builder:** `codeKvKey(userId)`.
- **Payload (`CodeRecord`):** `codeHmac`, `pendingEmail`,
  `pendingEmailNormalized`, `expiresAt`, `attempts`, `lastSentAt`. Plain
  codes never persist — only the HMAC fingerprint.
- **TTL:** 900 s (15 min) — `CODE_TTL_SECONDS`.
- **Write:** `request-code` writes a fresh record; `verify-code`
  decrements / deletes on success / on max-attempts. `attempts` is
  updated by writing the record back with the remaining TTL.
- **Invalidation:** explicit delete on verify success, max-attempts, or
  cancel; otherwise TTL.

### 10.2 `email_verify_lock:<userId>` — shipped

- **Builder:** `sendLockKvKey(userId)`.
- **Payload:** literal `"1"`.
- **TTL:** 60 s — `SEND_LOCK_TTL_SECONDS` (Cloudflare KV minimum).
- **Purpose:** in-flight send-lock held while we await Dove. Closes the
  window between throttle check and `lastSentAt` write.
- **Invalidation:** explicit delete on send completion or failure;
  otherwise TTL.

---

## 11. Generation key inventory

Generation keys live in their own short namespace. Each stores an opaque
token string `${Date.now()}-${crypto.randomUUID()}` produced by
`lib/cache/epoch.ts:bumpGen`. They have **no `expirationTtl`** — gen tokens
are tiny and persist; old gens become unreachable as soon as a bump
overwrites the token, and any cache rows stamped with the old gen expire by
their own TTL.

| Gen key                         | Builder                          | Bump helper             | Cache keys it controls |
|---------------------------------|----------------------------------|-------------------------|------------------------|
| `forum:tree:gen`                | `forumTreeGenKey()`              | `bumpForumTreeGen`      | `forum:tree:v2:*`      |
| `forum:summary:gen`             | `forumSummaryGenKey()`           | `bumpForumSummaryGen`   | `forum:summary:v2:*`, `forum:meta:v2:*` |
| `thread:list:gen:<forumId>`     | `threadListGenKey(forumId)`      | `bumpThreadListGen`     | `thread:list:v2:<forumId>:*` (one of two embedded gens) |
| `thread:list:gen:all`           | `threadListGenAllKey()`          | `bumpThreadListGenAll`  | EVERY `thread:list:v2:*` (other embedded gen) |
| `thread:meta:gen:<threadId>`    | `threadMetaGenKey(threadId)`     | `bumpThreadMetaGen`     | `thread:meta:v2:<threadId>:*` (planned) |
| `post:list:gen:<threadId>`      | `postListGenKey(threadId)`       | `bumpPostListGen`       | `post:list:v2:<threadId>:*` (planned) |
| `digest:gen`                    | `digestGenKey()`                 | `bumpDigestGen`         | `digest:list:v2:*`, `digest:stats:v2:*`, `digest:filters:v2:*` (planned) |

Composite helpers in `lib/cache/invalidate.ts` bundle the above bumps so
handlers stay single-call:

| Helper                                        | Bumps                                                                                                  |
|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|
| `invalidateForumStructureV2`                  | `forum:tree:gen` + `forum:summary:gen` + `digest:gen`                                                  |
| `invalidateForumReorderV2`                    | `forum:tree:gen` + `forum:summary:gen` (NOT `digest:gen`)                                              |
| `invalidateForumUpdateV2({affectsDigest})`    | `forum:tree:gen` + `forum:summary:gen`; `digest:gen` only when `affectsForumDigest(data)` returns true |
| `invalidateForumSummaryV2`                    | `forum:summary:gen`                                                                                    |
| `invalidateForumVolatileV2(env, forumId)`     | `forum:summary:gen` + `thread:list:gen:<forumId>`                                                      |
| `invalidateThreadListForForums(env, fids)`    | `thread:list:gen:<each unique fid>`                                                                    |
| `invalidateUserCache(env, userId)`            | `KV.delete user:mini:<id>` (live v1)                                                                   |
| `invalidateUserCaches(env, userId)`           | `KV.delete user:mini:v2:<id>` + `deleteUserPublicVariants(env, id)` (planned v2 + public variants)     |

---

## 12. Cleanup of historical / removed keys

These keys are **no longer written** anywhere. They are listed here only
so you can recognize them in old KV dumps. None of them have a live reader.

| Key                                | Status      | Notes |
|------------------------------------|-------------|-------|
| `forums:tree:v1`                   | historical  | v1 forum cache; module `apps/worker/src/lib/forum-cache.ts` removed; expires by 10 min TTL. |
| `forums:volatile:v1`               | historical  | v1 forum volatile cache; removed; expires by 60 s TTL. |
| `USE_KV_FORUM_CACHE_V2` flag       | removed     | flag gone — v2 forum cache is unconditional. |

---

## 13. Cross-references

- **Architecture rationale:** docs/19-worker-kv-cache-architecture.md
  (gen scheme, bucket model, phase plan, risk register, route → cache
  layering table).
- **User-cache history:** docs/09-user-cache-refactor.md (kept for the
  v1 → v2 user cache rationale; the live key today is still v1, see §6.1
  above).
- **Email verification protocol:** docs/17-email-verification.md
  (referenced by §10).

---

## 14. Updating this doc

1. Any change to a KV key's pattern, payload shape, TTL, gen wiring, or
   invalidation trigger MUST land in this file in the same commit as the
   code change.
2. Adding a new KV key requires a new section here AND, if it is a gen-
   keyed business cache, an entry in §11.
3. Promoting a `planned` key to `shipped`: flip the status, fill in the
   live read/write paths, and remove the "planned" hedge from §1.
4. Removing a key: move its row to §12 with a one-line note about the
   replacement and the natural-expiry path. Do NOT delete the row outright
   — it helps operators recognize stale KV entries during cleanup.
