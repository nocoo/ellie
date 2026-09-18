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

Mutable `/api/avatar/:uid` responses, including fallbacks, use `public, max-age=0, must-revalidate`. The shared URL helper uses `?v=current` outside the immediate upload flow to bypass older week-long browser caches even after the in-memory upload timestamp is lost on reload. Direct GUID image URLs retain their CDN caching.

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

## Admin statistics and hourly cache observations

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

`GET /api/admin/kv/metrics?minutes=1440&family=…` reads persisted observations from `kv_cache_metrics_hour`, with a default 24-hour window and a 60-minute minimum. It returns only completed hours, preserving `series[].tsMinute` as the epoch-minute timestamp of each hour's start, plus `intervalMinutes: 60`, `sampling: "best-effort"`, and `source: "application:kv_cache_metrics_hour"`. The page loads the selected tab on demand and never polls automatically. Business cache TTLs remain 60 / 1800 / 86400 seconds; hourly aggregation is a separate policy. Missing observations stay missing, and `coverage=complete` only means the query was not truncated.

Deploy the new Admin first; its totals cards can also read the old response during rollout. Migration `0052` must precede the Worker update. It creates the hourly store without scanning business tables or importing minute history; old minute rows retain their seven-day cleanup. See [cache architecture and budgets](20-worker-kv-reference.md#106-后台按需统计与小时观测v1114).
