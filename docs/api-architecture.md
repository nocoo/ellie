# Ellie API Architecture

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

### v1.12.0 访问统计调整

`GET /api/admin/analytics/today/visits` 和 `/list` 保留 PV、页面排行与机器人分类，改为读取当日共享内存；采集约 30 秒合并一次，实例回收、重启或部署后清零，不再写入 D1 或持久化报表快照。已撤下的访问人数相关字段 `activeUsers`、`anonPresent`、`uniqueUsers` 返回 `null`（未采集），不得解释为零人；登录审计的去重人数不受影响。

后台 KV 管理可查看、删除部署前遗留的访问统计缓存，但拒绝重建 visits KPI 和页面排行快照，避免将共享内存统计重新持久化。其他统计的缓存管理不变。
