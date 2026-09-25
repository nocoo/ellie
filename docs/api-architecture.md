# Ellie API Architecture

## Next.js memory statistics (phase 2)

[Design and implementation status](29-nextjs-memory-statistics.md) define this
change. Application display caches and lossy statistical buffers reside in the
Web Next.js process. D1 remains authoritative; Worker content authorization is
not replaced by memory state.

The admin memory-management path is Browser → authenticated Admin BFF
(`/api/admin/memory-cache`) → Web (`/api/internal/memory-cache`) over the configured
internal service origin. It does not traverse Worker or KV. Admin retains session,
whitelist and CSRF checks. Web separately requires `X-Ellie-Memory-Key`, checks
instance identity on mutations and never caches management responses.

Web submits bounded view/activity batches to Worker
`POST /api/internal/statistics/batch`, authenticated by the independent
`X-Ellie-Statistics-Key`. Forum Key A and Admin Key B do not grant this capability.
This endpoint permits statistical increments only, never arbitrary user updates.
Views are additive and best effort; activity timestamps are monotonic and checked
against existing active users. All normal forum business writes retain their
existing authentication and persistence contracts.

Reading endpoints use Key A and optional existing caller authentication:

- `GET /api/v1/threads?forumId&page&limit&includeTotal=false&typeId?` returns
  offset data and `meta.page/limit/hasNext`, without `total/pages`. Empty requested
  pages are preserved. Cursor reads are unchanged; omitted or true includeTotal
  retains the existing exact-total response.
- `GET /api/v1/threads/count?forumId&typeId?` returns `{data:{total}}` using the
  current caller's forum gate and the same eligible topic/announcement composition.
- `GET /api/v1/forums?view=structure` returns caller-visible Forum metadata with
  zeroed summary fields and `meta.bucket`, skipping aggregate/latest-topic reads.
- `GET /api/v1/forums/summaries` returns `ForumSummaryTopic[]` and `meta.bucket`.
  Latest topics are nonanonymous, sticky >= 0, ordered by creation time then ID.
  Default forum-list lastThread/lastPoster fields now use that topic and its author.
- `GET /api/v1/forums/summary-gates?topics=1,2,3` accepts 1..256 unique positive
  IDs and returns current authorization fields only. Hidden and absent topics are
  both omitted. Cached summaries must pass these gates before display.

Count and gate queries reject unknown/repeated parameters and malformed IDs.
Regular Worker envelopes retain generated `meta.timestamp` and `meta.requestId`.
The batch and memory-management envelopes are defined separately in shared types.

See document 29 for removed analytics/presence endpoints, paging semantics,
safe current-content checks and coordinated deployment requirements. The phase 2
management API observes one configured Web instance, not an aggregate of replicas.

## Overview

Ellie uses a **three-layer API architecture**:

```
Browser (Client Components)
    │
    ├── api-client.ts ──────────────────┐
    │   (No API Key, uses proxy)        │
    │                                   │
    └── useFeatureFlags, etc.           │
                                        ▼
                            ┌───────────────────────┐
                            │  Next.js API Routes   │
                            │  /api/* (Proxy Layer) │
                            └───────────────────────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │                               │                               │
        ▼                               ▼                               ▼
┌───────────────┐           ┌───────────────────┐           ┌───────────────┐
│ forum-api.ts  │           │  admin-api.ts     │           │ forum-auth.ts │
│ (Server Only) │           │  (Server Only)    │           │ (Server Only) │
│ Key A         │           │  Key B            │           │ Key A + JWT   │
└───────────────┘           └───────────────────┘           └───────────────┘
        │                               │                               │
        └───────────────────────────────┼───────────────────────────────┘
                                        │
                                        ▼
                            ┌───────────────────────┐
                            │   Cloudflare Worker   │
                            │   /api/v1/* (Key A)   │
                            │   /api/admin/* (Key B)│
                            └───────────────────────┘
                                        │
                                        ▼
                            ┌───────────────────────┐
                            │      D1 + KV          │
                            └───────────────────────┘
```

## API Layers

### Layer 1: Cloudflare Worker (Backend)

The Worker is the **single source of truth** for all data operations.

| Prefix | Key | Auth | Description |
|--------|-----|------|-------------|
| `/api/v1/*` | Key A (`API_KEY`) | Optional JWT | Public forum API |
| `/api/admin/*` | Key B (`ADMIN_API_KEY`) | Admin session enforced by Next.js proxy | Admin-only API |
| `/api/live` | None | None | Health check |

**Key endpoints:**
- `GET /api/v1/forums` - List forums; optional `view=names` returns only visible `{ id, name }` entries without thread summaries
- `GET /api/v1/threads?forumId=X` - List threads
- `GET /api/v1/posts?threadId=X` - List posts
- `POST /api/v1/auth/login` - Login, returns JWT
- `GET /api/v1/settings` - Feature flags
- `PATCH /api/v1/users/me` - Update profile (requires JWT)

### Layer 2: Next.js API Routes (Proxy Layer)

Next.js routes act as **proxies** that:
1. Hide API keys from the browser
2. Handle CSRF protection
3. Inject authentication headers
4. Transform responses if needed

**Critical rule:** Every endpoint that the browser calls MUST have a corresponding Next.js route.

| Browser calls | Next.js route | Proxies to Worker |
|---------------|---------------|-------------------|
| `/api/v1/settings` | `app/api/v1/settings/route.ts` | `/api/v1/settings` |
| `/api/v1/users/me` | `app/api/v1/users/me/route.ts` | `/api/v1/users/me` |
| `/api/v1/upload` | `app/api/v1/upload/route.ts` | `/api/v1/upload` |
| `/api/admin/*` | `app/api/admin/*/route.ts` | `/api/admin/*` |
| `/api/auth/*` | NextAuth handlers | N/A (NextAuth) |

Avatar uploads from the forum accept JPG/PNG originals up to 5 MB. Before forwarding to the Worker, the Next.js upload route decodes the image, applies EXIF orientation, fits it inside 360×360 without upscaling or cropping, flattens transparency onto white, and encodes JPEG at quality 80. The Worker validates the resulting file against its 200 KB limit, stores it in R2 under a unique `.jpg` path with `image/jpeg`, updates `avatar_path` / `has_avatar`, and invalidates the user cache. Post images retain their original bytes; existing stored avatars are unchanged.

An avatar upload saves immediately. The profile dialog sends only fields edited since it opened to `PATCH /api/v1/users/me`; an avatar-only change closes without a profile PATCH. This avoids revalidating unrelated legacy values. When a birthday component changes, all three components are included as required by the Worker.

Successful mutable `/api/avatar/:uid` responses use browser revalidation and `Cloudflare-CDN-Cache-Control: public, max-age=60`. The route-scoped Cloudflare rule respects these headers and retains query strings. Errors and fallback images use `no-store` at both layers. Uploads return the direct GUID CDN URL, which the uploader and shared avatar context display immediately; new R2 avatar objects carry `public, max-age=31536000, immutable`. The shared URL helper retains `?v=current` to avoid historical week-long browser caches. See [edge cache plan](28-edge-cache-optimization.md) for deployment evidence and subsequent proposals.

### Layer 3: Server Components (Direct Worker Access)

Server Components and Server Actions can call the Worker directly using:

| Client | File | Key | Use Case |
|--------|------|-----|----------|
| `forumApi` | `lib/forum-api.ts` | Key A | SSR forum pages |
| `adminApi` | `lib/admin-api.ts` | Key B | Admin console SSR |
| `authFetch` | `lib/forum-auth.ts` | Key A + JWT | Authenticated server actions |

## API Clients

### Browser (Client Components)

```typescript
// lib/api-client.ts - Generic HTTP client, calls Next.js routes
import { apiClient } from "@/lib/api-client";

// These call /api/* routes in Next.js, NOT the Worker directly
await apiClient.get("/api/v1/settings");
await apiClient.patch("/api/v1/users/me", data);
```

### Server (Server Components / Actions)

```typescript
// lib/forum-api.ts - Direct Worker access with Key A
import { forumApi } from "@/lib/forum-api";

// SSR data fetching - called from Server Components
const forums = await forumApi.getAll("/api/v1/forums");
const threads = await forumApi.getPage("/api/v1/threads", { forumId: 1 });

// lib/forum-auth.ts - Authenticated operations
import { authFetch, authPatch } from "@/lib/forum-auth";

// Server Actions with JWT
await authPatch("/api/v1/users/me", data); // Injects JWT from session
```

## Authentication

### Dual Auth System

| Provider | Use Case | Token Storage |
|----------|----------|---------------|
| Google OAuth | Admin Console | NextAuth session (cookie) |
| Credentials | Forum users | NextAuth session + Worker JWT |

### JWT Flow (Forum Users)

```
1. User logs in via /login page
2. Next.js calls Worker POST /api/v1/auth/login
3. Worker returns { token (JWT), refreshToken, user }
4. NextAuth stores JWT in encrypted session cookie
5. Server Actions use authFetch() which extracts JWT from session
6. JWT auto-refreshes via NextAuth jwt callback
```

### API Key Routing

```typescript
// Worker middleware/apiKey.ts
if (path.startsWith("/api/admin/")) {
  // Requires Key B (ADMIN_API_KEY)
} else {
  // Requires Key A (API_KEY)
}
```

## Common Mistakes

### 1. Missing Next.js Proxy Route

**Symptom:** `SyntaxError: Unexpected token '<'` in browser console

**Cause:** Browser calls `/api/v1/something` but no Next.js route exists, returns HTML 404

**Fix:** Create `app/api/v1/something/route.ts` that proxies to Worker

### 2. Using Wrong API Client

**Wrong:**
```typescript
// In Client Component
import { forumApi } from "@/lib/forum-api"; // Server-only!
```

**Right:**
```typescript
// In Client Component
import { apiClient } from "@/lib/api-client"; // Browser-safe
```

### 3. Calling Worker Directly from Browser

**Wrong:**
```typescript
// Browser trying to call Worker
fetch("https://worker.example.com/api/v1/threads", {
  headers: { "X-API-Key": "secret" } // Exposes key!
});
```

**Right:**
```typescript
// Browser calls Next.js proxy
fetch("/api/v1/threads"); // Next.js injects key server-side
```

## Environment Variables

| Variable | Location | Purpose |
|----------|----------|---------|
| `API_KEY` | Worker | Key A - public API auth |
| `ADMIN_API_KEY` | Worker | Key B - admin API auth |
| `JWT_SECRET` | Worker | JWT signing |
| `WORKER_API_URL` | Next.js | Worker base URL |
| `FORUM_API_KEY` | Next.js | Key A for forum-api.ts |
| `ADMIN_API_KEY` | Next.js | Key B for admin-api.ts |
| `ADMIN_EMAILS` | Next.js | Google OAuth admin whitelist |

## Adding New Endpoints

### 1. Add Worker Handler

```typescript
// apps/worker/src/handlers/example.ts
export async function myHandler(request: Request, env: Env) {
  // Implementation
}
```

### 2. Register in Worker Router

```typescript
// apps/worker/src/index.ts
if (path === "/api/v1/example" && request.method === "GET") {
  return await (await import("./handlers/example")).myHandler(request, env);
}
```

### 3. Create Next.js Proxy (if browser needs access)

```typescript
// apps/web/src/app/api/v1/example/route.ts
import { forumApi } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function GET() {
  const result = await forumApi.get("/api/v1/example");
  return NextResponse.json(result.data);
}
```

### 4. Use in Components

```typescript
// Server Component - direct Worker access
const data = await forumApi.get("/api/v1/example");

// Client Component - via proxy
const data = await apiClient.get("/api/v1/example");
```

## Deferred post comments

The thread page requests `GET /api/v1/post-comments?postId=…&limit=all` only after the reader selects **查看点评**. The Next.js proxy forwards the current session and query parameters. `limit=all` returns the complete single-post collection using the existing 30-minute comments cache; omitted limits still default to 50 and numeric limits remain capped at 100. Worker checks current post/thread/forum access before every cached read. **查看全部** therefore includes comments beyond the former 50/100 limits, while successful writes appear immediately on the current page.

## Admin statistics and manual cache snapshots

The v1.11.4 Admin statistics update keeps the Key B gate and the existing Next.js proxy routes. The dashboard requests statistics only after selecting **加载统计** (`/admin?statistics=1`); navigation links do not prefetch these reads.

`GET /api/admin/stats` reads three existing `settings` counters in one indexed query, cached as `admin:analytics` / `MEDIUM` (1800 seconds). Its `data` payload is:

```ts
{
  users: { total: number | null },
  threads: { total: number | null },
  posts: { total: number | null },
  source: "stored-counters",
  observedAt: number // epoch milliseconds when counters were read
}
```

A missing counter is `null`, a stored zero is `0`, and a failed or malformed read is an error. The old today/banned/forum total fields are removed. Standard Admin forum/thread/user reads use maintained counters and latest-content metadata; the user list no longer supplies `messagesCount` or `attachmentsCount`. Explicit calibration and destructive-action checks retain their current queries and authorization. Worker and Admin must be released together for this DTO change.

`GET /api/admin/kv/overview` reads the last administrator-triggered snapshot from `admin:kv:snapshot:v1`. With no saved snapshot it returns `{ families: [], observedAt: null, source: "registry+kv-list-metadata" }`. Opening the page, changing tabs and reading an old snapshot never scan KV or refresh its timestamp.

`POST /api/admin/kv/snapshot` runs the existing bounded KV metadata scan and replaces that single saved JSON value. The Admin proxy enforces its normal session/CSRF rules and forwards Key B. Sensitive names remain masked/hidden, partial counts stay lower bounds, and missing size metadata stays unknown. A failed scan leaves the previous snapshot intact; an unconfirmed KV write is reported as an error. Successful captures return the generated data immediately; later reads from other regions follow KV's eventual consistency. Snapshots have no automatic expiry and do not populate D1 or change business caches.

Continuous cache counters, the D1 observation wrapper, hourly metric writes and metric retention jobs have been removed. Existing business caching, view-count aggregation, authorization and administrator mutation audits remain active. The **历史观测** tab can explicitly read pre-existing `kv_cache_metrics_hour` data through `GET /api/admin/kv/metrics?minutes=1440&family=…`; no new samples or backfilled zeroes are generated. The snapshot itself cannot report historical hit rates, origin-load counts or error trends. Use Cloudflare's native analytics for platform D1 usage. No new schema migration is required.

### Retired application visit analytics

The phase 2 implementation removes `/api/admin/analytics/today/visits`, its list
route, `/api/internal/analytics/ingest`, the TodayVisitsMemory Durable Object,
and `ANALYTICS_INGEST_KEY`. The Admin audit tab and visit cards are removed;
business trends and login audit remain. Legacy visits snapshots have no rebuild
or supported family-management path. Existing keys may expire naturally.

See [Next.js memory statistics](29-nextjs-memory-statistics.md) for the replacement
view/activity semantics and local implementation status. These changes require
coordinated Worker/Web/Admin deployment; local verification is not deployment.

## Forum list context and memory display snapshots

Forum list RSC metadata, layout and page share `POST /api/v1/forums/context`
through the server-only Key A client, with the caller JWT when signed in.
There is no browser-facing proxy for this read. The response uses `no-store`.

The strict JSON request is defined by `packages/types/src/forum-list.ts`:
`{ forumId, page, limit, typeId, cachedBucket, cachedRevision, includeDisplay,
includeStats, includeCount, cachedRead? }`. The optional `cachedRead` is a signed
opaque server-only snapshot, bounded to 192 KiB including JSON escaping. The
request body is bounded to 256 KiB. Existing nullable fields remain explicit.

The response data is `{ bucket, user, revision, page, limit, typeId, hasNext,
announcementCount, display?, stats?, count?, readSnapshot? }`. Worker verifies
current forum ancestry, topic visibility and anonymous identity on every request.
Configuration is retained for 24 hours, recommendation IDs for 30 minutes, and
membership/order for pages 1–3 for 5 minutes. Deep pages read membership directly.
Warm Web requests echo `cachedRead` and set `includeStats:false, includeCount:false`.
The separate bounded `forum-read` memory family outlives the 30-minute display
entry; Web strips the response token before returning any public DTO. Hot list
reads need only current ancestry and topic gates; cold starts restore selections
from KV. Snapshots never authorize a request.

Web derives approximate local/category counts from its daily statistics memory,
then adds only the current authorized announcement contribution. Typed totals
already include matching global topics. `includeCount:true` remains available to
other callers and reads only the daily KV estimate; missing data means zero local
count, never a foreground D1 recount. Statistics can lag until the next daily
rebuild. Permission changes, deletion/hiding/moves and anonymous projection remain
immediate; administrative configuration/recommendation writes invalidate KV and notify Web. Lost notifications may leave display changes delayed until the snapshot expires. List anonymous author and last-poster identities remain
masked for all viewers.

`GET /api/internal/statistics/snapshot` reads the persistent KV base and matching
optimistic overlay. `POST` explicitly rebuilds it from D1. Both require the existing
server-only `X-Ellie-Statistics-Key`, reject Key A/B credentials, and return
`no-store`. The response is bounded to 2 MiB. Daily cron at 03:00 Asia/Shanghai
refreshes the indexed recent-activity snapshot with one query, then updates the four
small global/forum aggregates. Historical topic/category counts run only for forums
in that activity result or the persistent mutation journal; a missing initial base
requires a one-time full count. Unchanged forum/type totals are retained and daily
counts roll over in Shanghai time. Web hydrates once on startup,
refreshes from KV hourly in the background, and serves warm reads from process
memory; failures retain the last snapshot and retry after five minutes. Successful
writes update local memory and a version-scoped KV overlay. Races may lose small
increments until the daily rebuild. Daily memory is separately bounded to 2 MiB;
read/display families share the existing 8 MiB runtime payload ceiling.

Deploy the migration-first Worker, bootstrap the snapshot using the authenticated
POST, then deploy Web/Admin. Old Web can continue requesting approximate `count`
during this cutover. See [the daily-read design](36-daily-statistics-and-read-snapshots.md).

`POST /api/v1/posts` success also returns `meta.threadSticky`, read from the reply's
thread. The Next proxy uses local values 0/1 to clear the affected forum's list
snapshots; global announcements and unknown scope clear the list family.

The [implementation plan](33-forum-list-memory-read-plan.md) specifies response and
intermediate-read bounds, cache ceilings, TTL, invalidation, and validation scope.

## Thread context and bounded detail snapshots

Thread metadata, layout and page share the server-only Key A
`POST /api/v1/threads/context` read with optional verified JWT. No browser proxy
is needed. The strict request is `{ threadId, limit, cursor, last,
cachedRevision, includeDisplay, includeStats }`; nullable fields are explicit,
limit is 1..100, cursor selects a nonnegative post position, and cursor plus
last is rejected. Unknown fields/query parameters and oversized request bodies
are rejected. Responses are private/no-store with normal request metadata.

Every response returns fresh `{ thread, user, revision, cacheable, nextCursor }`
and optional `display`/`stats`. Authority and current page/privacy/profile-status
gates read D1 directly. A matching eligible revision skips post bodies, ratings,
attachments and public profile expansion. This route does not access KV or
increment views. A successful Web page render retains the existing five-minute
view/activity buffer and optimistic view display; prefetches do not count.

The display contains posts, public author profiles, projected attachments,
nullable forum context and ancestors. Private topics, staff, pending topics and viewers entitled
to reveal anonymous identities receive a complete private display on every read;
Web neither admits it nor substitutes a shared snapshot. Anonymous attachment
owners are masked consistently in this context and existing public endpoints.

Next.js stores one latest selection per `thread:ID`: at most 100 topic entries,
256 KiB each, four MiB for this family within the existing eight-MiB process
payload budget. Oversize responses still render through ordinary `post` transport
with an explicit fifteen-second abort deadline.
The absolute thirty-minute expiry is capped at Shanghai midnight; the existing
minute timer prunes idle entries. Hits do not renew expiry. Restart starts cold
from D1. Successful mutations reuse the existing notification path to invalidate
memory separately from Worker KV, including rating creation/revocation.
The Admin memory panel lists and clears this family through its existing contract.
Home, list and thread loaders recheck retained snapshots after the Worker response;
expiry, clear or an incompatible replacement triggers one full refill. Missing
optional statistics are omitted. A second incomplete refill fails without serving
expired data or recursively retrying.

See [the design and review resolutions](35-thread-memory-and-count-optimization.md).
Rollout is sequential: v1.14.5 installs these readers while retaining Worker
count-on-display behavior; v1.14.6 removes the extra count after the new Web is live.

## Homepage context and memory display snapshots

See [the homepage read plan](31-homepage-memory-read-plan.md). The homepage RSC
and forum layout share a request-scoped loader. Its only server-rendered content request is
`POST /api/v1/home/context` with server-only Key A and optional caller JWT.
This read-only POST has no browser proxy: it is called by the server API client.
The trusted homepage request marker is overwritten by Next.js Proxy. Browser
notification polling, avatars, token refresh and periodic settings reads remain
separate requests.

The request contains `cachedBucket`, `includeDisplay`, `includeStats`,
`summaryTopicIds` and `digestTopicIds`. The bucket is a rebuild hint, never
an authorization claim. Responses contain fresh `bucket`, `user`,
`allowedForumIds`, `summaryGates`, `digestGates` and `recent`, with optional `display`
and `stats`. `recent` contains at most five `{ id, forumId, forumName, subject,
lastPostAt, replies }` rows ordered by last activity, without author identities.
The nightly snapshot includes the last 24 hours and up to 20 historical candidates
so quiet periods can still display five discussions. Historical rows pass the same
current-authority gates and do not trigger daily forum recounts.
It is refreshed on every context request from Worker memory/KV candidates, filtered
against the existing fresh forum and topic gates, and never cached in Web display.
New topics and replies update the bounded KV snapshot optimistically. Normal `meta.timestamp` and `meta.requestId` remain present.
Invalid supplied JWTs fail instead of silently becoming anonymous.
Statistics query errors omit `stats` while preserving verified identity and
display. Web uses its existing display defaults without caching them and retries
statistics on the next context request. Authority failures still fail closed.

Web caches only the coherent `display` projection (forum structure, numeric
summaries/latest nonanonymous topics, and five digest topics). It never caches
context users or authorization gates. `home-display` has four entries at most,
512 KiB per entry, thirty-minute maximum lifetime and Shanghai-midnight expiry;
the existing aggregate eight-MiB payload ceiling remains. Statistics reuse
`site-stats` with a five-minute lifetime. Restart empties memory and rebuilds
from fresh authoritative reads, without promoting old KV content to a new TTL.

Every render filters whole forums against fresh ancestor-aware allowed IDs and
checks cached topic identity, visibility, anonymity and author against current
gates. Failed gates hide candidates and discard that display entry for the next
read. Candidate overflow forces a complete fresh response without admission;
forums are never truncated to fit the cache. Responses over two MiB fail
explicitly. A fifteen-second deadline includes response consumption.
Context loads share the runtime's 64-load process limit, reserve capacity before
cloning or fetching, and release it on success or failure. Private responses are
never shared across requests.

Successful Web business writes reuse `invalidateDisplayAfterWrite` to clear
memory; existing Worker mutation helpers independently invalidate KV. Admin
business writes remain direct and unthrottled. After success, Admin sends a
bounded best-effort notification over the existing memory-management channel:
read the instance ID and clear all display families, without flushing statistical
buffers. An instance conflict gets one retry. Manual KV and memory controls
remain independent. Notification failure converges via TTL; this channel targets
one configured Web instance, not a broadcast to multiple replicas.

## Quiet-forum reads (v1.14.10)

Known avatar paths, including an explicitly empty legacy path, resolve directly to
CDN URLs. Unknown paths retain the authenticated server lookup route; anonymous
identities use the static placeholder. All forum Next.js Links disable speculative
prefetch; normal click navigation is unchanged.

The unread-message badge polls at most hourly and shares a bounded 256-account
Web process cache keyed by the decrypted session identity. A memory hit does not
call Worker or KV. Successful mailbox access and mutations clear the current
account's estimate; sending also clears the recipient's estimate in the same
process. The client refreshes its badge after mailbox activity. Actual mailbox
contents and writes still pass the original Worker authorization checks. Remote
messages and other Web processes may leave an estimate stale for up to an hour.
