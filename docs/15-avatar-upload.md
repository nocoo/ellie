# 15. Avatar Upload

## Overview

Allow users to upload custom avatars via drag-and-drop. Avatars are stored in Cloudflare R2 (same bucket as existing CDN at `t.no.mt/avatar`) and served directly.

## Current State

| Component | Status |
|-----------|--------|
| Avatar DB field | `users.avatar TEXT DEFAULT ''` — legacy field, stores empty string |
| Avatar flag | Does not exist — will add `users.has_avatar INTEGER DEFAULT 0` |
| Avatar display | Proxy `/api/avatar/:uid?size=big\|middle\|small` → CDN path derived from UID |
| R2/CDN | Already exists at `t.no.mt`, public access |
| Upload endpoint | Does not exist |
| Upload UI | Does not exist |
| Posting restriction | ✅ `features.posting.require_avatar` blocks posting if `!userRow.avatar` (will change to `!userRow.has_avatar`) |

### Posting Permission Check

The backend enforces avatar requirement (`apps/worker/src/lib/postingPermission.ts:142-156`):

```typescript
if (settings.requireAvatar && !userRow.avatar) {
  return {
    allowed: false,
    error: errorResponse('POSTING_RESTRICTION', 403, {
      message: '您需要设置头像后才能发送内容',
      code: 'REQUIRE_AVATAR',
    }, origin),
  };
}
```

**This feature solves the problem**: upload sets `users.has_avatar = 1`, unlocking posting.

## Requirements

### Constraints

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Allowed formats | JPG, PNG | Standard web formats |
| Max file size | 200 KB | Lightweight for fast loading |
| Storage | Cloudflare R2 | Same as existing CDN (`t.no.mt`) |
| Image processing | Resize & compress server-side | Consistent quality |
| Size variants | Single size only | Modern networks are fast enough |

### Extensibility

Upload system designed for reuse:

| Use Case | Max Size | Formats | Notes |
|----------|----------|---------|-------|
| Avatar | 200 KB | JPG, PNG | This feature |
| Post attachments | TBD | TBD | Future |

## Architecture

### Schema Change

Add `has_avatar` column alongside existing `avatar` field:

```sql
-- Migration: 0023_avatar_has_flag.sql
ALTER TABLE users ADD COLUMN has_avatar INTEGER NOT NULL DEFAULT 0;
```

**Field responsibilities:**

| Field | Type | Purpose |
|-------|------|---------|
| `avatar` | TEXT | Legacy field, kept for API compatibility. Always empty string in DB — actual avatar URL is derived from UID via `/api/avatar/:uid`. |
| `has_avatar` | INTEGER | Source of truth for posting permission check: `1` = user has uploaded avatar, `0` = no avatar |

**Why keep both?**

The `avatar` field exists in the DB schema and is included in API responses (see `07-api-reference.md`). Removing it would be a breaking change. Instead:

1. `has_avatar` is the source of truth for posting permission
2. `avatar` field in DB and API remains empty string (legacy, unused)
3. Frontend uses `getAvatarUrl(uid, size)` helper to construct proxy URL `/api/avatar/{uid}`
4. Future: could repurpose DB `avatar` column for external avatar URL override

**Current avatar field behavior in code:**

| Location | Current Behavior | Notes |
|----------|------------------|-------|
| `users.avatar` (DB column) | Empty string `''` | Legacy, not used for display |
| `UserMiniProfile.avatar` (KV cache) | Empty string from DB | Cache mirrors DB value |
| `PublicUser.avatar` (API response) | Empty string from DB | Frontend ignores this field |
| `authorAvatar`, `lastPosterAvatar` | Empty string from cache | Frontend ignores these fields |
| **Frontend display** | `getAvatarUrl(uid, size)` → `/api/avatar/{uid}` | Derives URL from UID, not from API response |

**Key insight:** The frontend **never uses** the `avatar` field from API responses. It always constructs the avatar URL from the user ID via `getAvatarUrl(uid, size)`. This means:

- No Worker code changes needed for avatar display
- The `avatar` field in API responses is vestigial
- Upload only needs to write to R2 and set `has_avatar = 1`

**Posting permission change:**

```typescript
// apps/worker/src/lib/postingPermission.ts
// Line 76 — add has_avatar to SELECT:
const userRow = await env.DB.prepare(
  "SELECT status, has_avatar, reg_date, role FROM users WHERE id = ?"
)

// Line 143 — check has_avatar instead of avatar:
if (settings.requireAvatar && !userRow.has_avatar) {
```

**UserMiniProfile cache:**

The cache stores `avatar: string` (currently empty string from DB). Since frontend derives avatar URLs from UID via `getAvatarUrl()`, the cache value is unused for display. Upload handler:
1. Writes file to R2 at computed path
2. Sets `has_avatar = 1` in DB
3. Calls `invalidateUserCache(env, userId)` to clear stale cache (for username/role changes)
4. Returns URL with `?v={timestamp}` for immediate client refresh

### Storage Structure

R2 bucket at `t.no.mt`. Single avatar per user, no size variants:

```
R2 Bucket (t.no.mt)
└── avatar/
    └── {dir1}/{dir2}/{dir3}/{file}_avatar_big.jpg

Example for UID 12345:
└── avatar/000/01/23/45_avatar_big.jpg
```

Path computation (shared between upload handler and avatar proxy):
```typescript
// apps/worker/src/lib/avatar-path.ts
export function computeAvatarPath(uid: number): string {
  const padded = uid.toString().padStart(9, '0');
  const dir1 = padded.slice(0, 3);
  const dir2 = padded.slice(3, 5);
  const dir3 = padded.slice(5, 7);
  const file = padded.slice(7, 9);
  return `avatar/${dir1}/${dir2}/${dir3}/${file}_avatar_big.jpg`;
}
```

**Upload overwrites existing file** — no cleanup needed.

### API Design

#### Upload Endpoint

```
POST /api/v1/upload
Content-Type: multipart/form-data
Authorization: Bearer <jwt>

Form fields:
- file: File (required)
- purpose: "avatar" (required, extensible for future use cases)
```

#### Response Format

Follows project convention (`{ data, meta }` / `{ error }`):

```typescript
// Success (200)
{
  "data": {
    "url": "/api/avatar/123",
    "size": 45678
  },
  "meta": {
    "timestamp": 1712345678000,
    "requestId": "uuid"
  }
}

// Error (4xx/5xx)
{
  "error": {
    "code": "FILE_TOO_LARGE",
    "message": "File size exceeds 200 KB limit"
  }
}
```

#### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NO_FILE` | 400 | No file in request |
| `INVALID_PURPOSE` | 400 | Unknown purpose value |
| `FILE_TOO_LARGE` | 413 | Exceeds 200 KB limit |
| `INVALID_FORMAT` | 415 | Not JPG or PNG |
| `UPLOAD_FAILED` | 500 | R2 write failed |

### Request Flow

```
Browser                Next.js Route              Worker               R2
   │                        │                       │                   │
   │  POST /api/v1/upload   │                       │                   │
   │  (multipart/form-data) │                       │                   │
   ├───────────────────────>│                       │                   │
   │                        │  POST /api/v1/upload  │                   │
   │                        │  (raw body passthrough)                   │
   │                        ├──────────────────────>│                   │
   │                        │                       │ Validate format   │
   │                        │                       │ Validate size     │
   │                        │                       │ Resize & compress │
   │                        │                       │                   │
   │                        │                       │  PUT avatar/...   │
   │                        │                       ├──────────────────>│
   │                        │                       │<──────────────────┤
   │                        │                       │                   │
   │                        │                       │ UPDATE users      │
   │                        │                       │ SET has_avatar=1  │
   │                        │                       │                   │
   │                        │                       │ Invalidate cache  │
   │                        │                       │                   │
   │                        │<──────────────────────┤                   │
   │<───────────────────────┤                       │                   │
   │  { data: { url } }     │                       │                   │
```

### Avatar Serving Changes

Current proxy supports `?size=big|middle|small` but we're simplifying to single size. Changes needed:

1. **Deprecate size parameter** — keep for backward compatibility, but ignore it (always serve big)
2. **Add cache-busting support** — accept `?v=timestamp` for immediate refresh after upload
3. **Simplify CDN path** — always fetch `_avatar_big.jpg`

```typescript
// apps/web/src/lib/avatar.ts (updated)
// Keep size param for backward compatibility with existing 14 call sites
// Size is now ignored — always returns big avatar
export function getAvatarUrl(
  uid: number,
  size: AvatarSize = "big",  // Deprecated: kept for compat, ignored
  cacheBust?: number
): string {
  const params = cacheBust ? `?v=${cacheBust}` : '';
  return `/api/avatar/${uid}${params}`;
}
```

**Existing call sites (no changes needed):**
- `digest-card.tsx` (2 calls)
- `post-comments.tsx`, `messages-page.tsx`, `thread-item.tsx` (2 calls)
- `post-sidebar.tsx`, `profile-hero.tsx`, `forum-header.tsx`
- `user-popover.tsx`, `post-card.tsx`, `forum-card.tsx` (2 calls)
- `message-detail.tsx`

All existing `getAvatarUrl(id, "small"|"middle"|"big")` calls continue to work.

```typescript
// apps/web/src/app/api/avatar/[uid]/route.ts (updated)
// Remove size logic, always fetch _avatar_big.jpg
// Accept but ignore ?size= param for backward compatibility
// Pass through ?v= param for cache headers
```

## Implementation

### Phase 0: Schema Migration

#### 0.1 Create Migration

```sql
-- apps/worker/migrations/0023_avatar_has_flag.sql
ALTER TABLE users ADD COLUMN has_avatar INTEGER NOT NULL DEFAULT 0;
```

#### 0.2 Update Posting Permission Check

```typescript
// apps/worker/src/lib/postingPermission.ts
// Change line 76:
const userRow = await env.DB.prepare(
  "SELECT status, has_avatar, reg_date, role FROM users WHERE id = ?"
)

// Change line 143:
if (settings.requireAvatar && !userRow.has_avatar) {
```

#### 0.3 Backfill Script (Post-Migration)

```typescript
// scripts/backfill-avatar-flag.ts
// Scan R2 for existing avatar files, set has_avatar = 1 for matching UIDs
// Run once after migration and initial data sync
```

### Phase 1: Infrastructure

#### 1.1 Add R2 Binding

```toml
# apps/worker/wrangler.toml
[[r2_buckets]]
binding = "R2"
bucket_name = "tongjinet"
```

#### 1.2 Update Worker Env

```typescript
// apps/worker/src/lib/env.ts
export interface Env {
  // ... existing
  R2: R2Bucket;
}
```

### Phase 2: Worker Upload Handler

#### 2.1 Upload Configuration

```typescript
// apps/worker/src/lib/upload-config.ts
export interface UploadConfig {
  maxSize: number;
  allowedMimeTypes: string[];
}

export const UPLOAD_CONFIGS: Record<string, UploadConfig> = {
  avatar: {
    maxSize: 200 * 1024,  // 200 KB
    allowedMimeTypes: ['image/jpeg', 'image/png'],
  },
  // Future: attachment config with different limits
};
```

#### 2.2 Upload Handler

```typescript
// apps/worker/src/handlers/upload.ts
import { errorResponse } from '../middleware/error';
import { jsonResponse } from '../lib/response';
import { computeAvatarPath } from '../lib/avatar-path';
import { invalidateUserCache } from '../lib/user-cache';
import { UPLOAD_CONFIGS } from '../lib/upload-config';
import type { Env } from '../lib/env';

const AVATAR_SIZE = 200;  // 200x200 px
const AVATAR_QUALITY = 85;

export async function handleUpload(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  userId: number,
  origin?: string
): Promise<Response> {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const purpose = formData.get('purpose') as string;

  // Validate purpose
  const config = UPLOAD_CONFIGS[purpose];
  if (!config) {
    return errorResponse('INVALID_PURPOSE', 400, undefined, origin);
  }

  // Validate file exists
  if (!file) {
    return errorResponse('NO_FILE', 400, undefined, origin);
  }

  // Validate size (before reading full body)
  if (file.size > config.maxSize) {
    return errorResponse('FILE_TOO_LARGE', 413, {
      message: `File size exceeds ${config.maxSize / 1024} KB limit`
    }, origin);
  }

  // Validate MIME type
  if (!config.allowedMimeTypes.includes(file.type)) {
    return errorResponse('INVALID_FORMAT', 415, {
      message: 'Only JPG and PNG formats are allowed'
    }, origin);
  }

  // Process image: resize & compress
  // Option A: Use Cloudflare Image Resizing (if enabled)
  // Option B: Use photon-rs WASM
  const arrayBuffer = await file.arrayBuffer();
  const processed = await resizeAndCompress(arrayBuffer, AVATAR_SIZE, AVATAR_QUALITY);

  // Generate path and upload to R2
  const key = computeAvatarPath(userId);
  await env.R2.put(key, processed, {
    httpMetadata: { contentType: 'image/jpeg' },
  });

  // Update user record
  await env.DB.prepare(
    'UPDATE users SET has_avatar = 1 WHERE id = ?'
  ).bind(userId).run();

  // Invalidate user cache (non-blocking)
  ctx.waitUntil(invalidateUserCache(env, userId));

  return jsonResponse({
    url: `/api/avatar/${userId}`,
    size: processed.byteLength,
  }, origin);
}

// Image processing implementation TBD based on available tools in Workers
async function resizeAndCompress(
  input: ArrayBuffer,
  size: number,
  quality: number
): Promise<ArrayBuffer> {
  // Implementation options:
  // 1. Cloudflare Image Resizing (requires plan feature)
  // 2. photon-rs WASM library
  // 3. Accept pre-resized images, skip server processing
  throw new Error('Not implemented');
}
```

#### 2.3 Add Route

```typescript
// apps/worker/src/index.ts
// Add to router (after auth routes, before moderation routes):

// ── Upload route (authenticated) ─────────────────
if (path === '/api/v1/upload' && request.method === 'POST') {
  // Use withAuthVerified for sensitive operations
  const authResult = await authMiddlewareVerified(request, env);
  if (authResult instanceof Response) return authResult;
  return await (await import('./handlers/upload')).handleUpload(
    request, env, ctx, authResult.user.userId, origin
  );
}
```

**Note:** Use `authMiddlewareVerified` (not `authMiddleware`) to verify user status from database — banned users with valid JWTs cannot upload.

### Phase 3: Next.js Proxy Route

The existing `authFetch` only supports JSON body. Create a new multipart-aware proxy:

```typescript
// apps/web/src/app/api/v1/upload/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getWorkerJwt } from '@/lib/forum-auth';

function getWorkerUrl(): string {
  const url = process.env.WORKER_API_URL;
  if (!url) throw new Error('WORKER_API_URL not set');
  return url.replace(/\/+$/, '');
}

function getApiKey(): string {
  const key = process.env.FORUM_API_KEY;
  if (!key) throw new Error('FORUM_API_KEY not set');
  return key;
}

export async function POST(request: NextRequest) {
  const jwt = await getWorkerJwt();
  if (!jwt) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    );
  }

  // IMPORTANT: Must forward Content-Type header to preserve multipart boundary
  // Worker requires X-API-Key for all /api/v1/* routes (API key gate runs before auth)
  const contentType = request.headers.get('Content-Type');
  if (!contentType) {
    return NextResponse.json(
      { error: { code: 'INVALID_REQUEST', message: 'Content-Type required' } },
      { status: 400 }
    );
  }

  const workerResponse = await fetch(`${getWorkerUrl()}/api/v1/upload`, {
    method: 'POST',
    headers: {
      'X-API-Key': getApiKey(),           // Required: Worker API key gate
      'Authorization': `Bearer ${jwt}`,    // Required: User authentication
      'Content-Type': contentType,         // Required: Contains multipart boundary
    },
    body: request.body,
    // @ts-expect-error duplex is required for streaming body
    duplex: 'half',
  });

  const data = await workerResponse.json();
  return NextResponse.json(data, { status: workerResponse.status });
}
```

### Phase 4: Avatar Proxy Simplification

```typescript
// apps/web/src/lib/avatar.ts
// Keep size param for backward compatibility (see "Avatar Serving Changes" section)
export function getAvatarUrl(
  uid: number,
  size: AvatarSize = "big",  // Deprecated: kept for compat, ignored
  cacheBust?: number
): string {
  const params = cacheBust ? `?v=${cacheBust}` : '';
  return `/api/avatar/${uid}${params}`;
}
```

```typescript
// apps/web/src/app/api/avatar/[uid]/route.ts
// Simplified: ignore size parameter, always serve _avatar_big.jpg
// Add cache-busting: if ?v= present, set shorter cache or no-cache

const CDN_BASE = 'https://t.no.mt/avatar';
const FALLBACK_URL = 'https://t.no.mt/static/image/common/tavatar.gif';

function computeAvatarPath(uid: number): string {
  const padded = uid.toString().padStart(9, '0');
  const dir1 = padded.slice(0, 3);
  const dir2 = padded.slice(3, 5);
  const dir3 = padded.slice(5, 7);
  const file = padded.slice(7, 9);
  return `${CDN_BASE}/${dir1}/${dir2}/${dir3}/${file}_avatar_big.jpg`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ uid: string }> }
): Promise<NextResponse> {
  const { uid: uidParam } = await params;
  const uid = Number.parseInt(uidParam, 10);
  if (Number.isNaN(uid) || uid <= 0) {
    return NextResponse.redirect(FALLBACK_URL);
  }

  const hasCacheBust = request.nextUrl.searchParams.has('v');
  const avatarUrl = computeAvatarPath(uid);

  try {
    const response = await fetch(avatarUrl);
    if (!response.ok) {
      return serveFallback(hasCacheBust);
    }

    const imageData = await response.arrayBuffer();
    return new NextResponse(imageData, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': hasCacheBust
          ? 'no-cache'  // Force revalidation after upload
          : 'public, max-age=604800',  // 7 days normal
      },
    });
  } catch {
    return serveFallback(hasCacheBust);
  }
}

async function serveFallback(hasCacheBust: boolean): Promise<NextResponse> {
  const response = await fetch(FALLBACK_URL);
  const data = await response.arrayBuffer();
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': hasCacheBust ? 'no-cache' : 'public, max-age=86400',
    },
  });
}
```

### Phase 5: Frontend Upload UI

#### 5.1 Avatar Upload Component

```typescript
// apps/web/src/components/forum/avatar-upload.tsx
'use client';

import { useState, type DragEvent } from 'react';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface AvatarUploadProps {
  currentUrl: string;
  onUploadComplete: (newUrl: string) => void;
}

export function AvatarUpload({ currentUrl, onUploadComplete }: AvatarUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState(currentUrl);

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) await uploadFile(file);
  };

  const uploadFile = async (file: File) => {
    // Client-side validation
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError('仅支持 JPG 和 PNG 格式');
      return;
    }
    if (file.size > 200 * 1024) {
      setError('文件大小不能超过 200 KB');
      return;
    }

    setIsUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('purpose', 'avatar');

    try {
      const res = await fetch('/api/v1/upload', {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();

      if (result.data) {
        const newUrl = `${result.data.url}?v=${Date.now()}`;
        setPreviewUrl(newUrl);
        onUploadComplete(newUrl);
      } else {
        setError(result.error?.message || '上传失败');
      }
    } catch {
      setError('上传失败，请重试');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      className={cn(
        'relative rounded-lg border-2 border-dashed p-4 transition-colors',
        isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25',
        isUploading && 'opacity-50 pointer-events-none'
      )}
    >
      <div className="flex flex-col items-center gap-3">
        <img
          src={previewUrl}
          alt="头像预览"
          className="h-20 w-20 rounded-full object-cover"
        />
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            拖拽图片到此处，或点击上传
          </p>
          <p className="text-xs text-muted-foreground">
            JPG / PNG，最大 200 KB
          </p>
        </div>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>

      {isUploading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}

      <input
        type="file"
        accept="image/jpeg,image/png"
        className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => e.target.files?.[0] && uploadFile(e.target.files[0])}
        disabled={isUploading}
      />
    </div>
  );
}
```

#### 5.2 Integrate into Profile Edit

```typescript
// apps/web/src/components/forum/profile-edit-dialog.tsx
// Add AvatarUpload at top of form, pass router.refresh as callback
import { AvatarUpload } from './avatar-upload';
import { getAvatarUrl } from '@/lib/avatar';

// Inside form:
<AvatarUpload
  currentUrl={getAvatarUrl(user.id)}
  onUploadComplete={() => {
    router.refresh();  // Refresh page to update all avatar instances
  }}
/>
```

### Phase 6: Cache Invalidation

After upload, caches to invalidate:

| Cache | Location | Invalidation | Guarantee |
|-------|----------|--------------|-----------|
| User mini profile | KV `user:mini:{id}` | `invalidateUserCache(env, userId)` in handler | ✅ Immediate |
| Browser avatar cache | HTTP cache | `?v=timestamp` in client-side URL | ✅ Immediate |
| React components | AvatarContext | `updateVersion(userId)` propagates to all `TrackedUserAvatar` | ✅ Immediate |
| Next.js proxy response | HTTP `Cache-Control` header | `no-cache` when `?v=` present | ✅ Immediate |
| R2 object | `t.no.mt` bucket | PUT to same key replaces content | ✅ Immediate |
| CDN edge cache | Cloudflare edge (t.no.mt) | **NOT directly invalidated** — see below | ⚠️ Up to 7 days stale |

#### Avatar Context for Client-Side Updates

To ensure all avatar instances update immediately after upload, we use React Context:

```typescript
// contexts/avatar-context.tsx
export function AvatarProvider({ children }: { children: ReactNode }) { ... }
export function useAvatarVersion() { ... }  // Get/update version for a UID
export function useAvatarUrl(uid: number) { ... }  // Returns URL with version if set

// components/forum/user-avatar.tsx
export function UserAvatar({ src, alt, className }: UserAvatarProps) { ... }  // Simple img
export function TrackedUserAvatar({ uid, username, size }: TrackedUserAvatarProps) { ... }  // Uses context
```

**Usage in profile-edit-dialog.tsx:**

```typescript
const { updateVersion } = useAvatarVersion();

const handleAvatarUploadComplete = (newUrl: string) => {
  // Extract version from URL and propagate to all avatar instances
  const match = newUrl.match(/[?&]v=(\d+)/);
  const version = match ? Number.parseInt(match[1], 10) : Date.now();
  updateVersion(user.id, version);
  router.refresh();  // Also refresh server-rendered content
};
```

**Key components:**
- `TrackedUserAvatar` — Use in places where the current user's avatar should update immediately (profile page)
- `UserAvatar` — Use elsewhere (posts, threads) where eventual consistency via server refresh is acceptable

**How the cache layers work:**

```
Browser → /api/avatar/123?v=1712345678
           │
           ▼
        Next.js proxy (reads ?v=, sets Cache-Control: no-cache)
           │
           ▼  (always requests fixed URL)
        fetch("https://t.no.mt/avatar/000/00/01/23_avatar_big.jpg")
           │
           ▼
        CDN edge (may serve cached response)
           │
           ▼
        R2 origin (latest file)
```

**Key insight:** The `?v=` parameter only affects the **browser → Next.js** hop. The Next.js proxy always requests the **same fixed URL** from CDN (`t.no.mt/avatar/...`), so `?v=` does NOT create a different CDN cache key.

**What `?v=` actually does:**

1. **Browser level** — Different URL = different browser cache entry. Browser fetches fresh from Next.js.
2. **Next.js level** — Proxy sees `?v=`, responds with `Cache-Control: no-cache`. Browser won't reuse this response.
3. **CDN level** — Unchanged. CDN may still serve stale content until its cache expires or gets evicted.

**Why this is acceptable:**

- R2 PUT immediately updates the file at origin
- CDN edge caches eventually expire (configured max-age or LRU eviction)
- Most users see updates within minutes (CDN edge refresh), not days
- The uploader sees immediate update via `?v=` + browser cache bypass

**For guaranteed immediate CDN refresh (future enhancement):**

If stricter freshness is needed, options include:
1. Cloudflare Cache API purge via Worker (requires zone ID setup)
2. Use unique path per upload (e.g., `/avatar/{uid}_{timestamp}.jpg`) — breaks caching benefits
3. Accept eventual consistency (current approach)

## File Checklist

### Worker (apps/worker)

| File | Action | Notes |
|------|--------|-------|
| `migrations/0023_avatar_has_flag.sql` | Create | Add `has_avatar` column |
| `src/lib/postingPermission.ts` | Update | Change `!userRow.avatar` to `!userRow.has_avatar` |
| `wrangler.toml` | Update | Add R2 binding |
| `src/lib/env.ts` | Update | Add `R2: R2Bucket` to Env interface |
| `src/lib/avatar-path.ts` | Create | Shared path computation |
| `src/lib/upload-config.ts` | Create | Upload constraints per purpose |
| `src/handlers/upload.ts` | Create | Upload handler |
| `src/index.ts` | Update | Add upload route |
| `src/middleware/error.ts` | Update | Add error codes: `NO_FILE`, `INVALID_PURPOSE`, `FILE_TOO_LARGE`, `INVALID_FORMAT`, `UPLOAD_FAILED` |

### Web (apps/web)

| File | Action | Notes |
|------|--------|-------|
| `src/app/api/v1/upload/route.ts` | Create | Multipart proxy with X-API-Key + Content-Type |
| `src/lib/avatar.ts` | Update | Add cacheBust param; keep size param for compat (deprecated, ignored) |
| `src/app/api/avatar/[uid]/route.ts` | Update | Ignore size param, add cache-bust header handling |
| `src/contexts/avatar-context.tsx` | Create | React Context for avatar version propagation |
| `src/components/forum/avatar-upload.tsx` | Create | Drag-drop upload UI |
| `src/components/forum/user-avatar.tsx` | Update | Add TrackedUserAvatar component using context |
| `src/components/forum/profile-edit-dialog.tsx` | Update | Add AvatarUpload component, use TrackedUserAvatar |
| `src/components/forum/profile-hero.tsx` | Update | Use TrackedUserAvatar for auto-updating avatar |
| `src/components/providers.tsx` | Update | Add AvatarProvider to app providers |

### Packages

| File | Action | Notes |
|------|--------|-------|
| `packages/db/src/schema.ts` | Update | Add `has_avatar INTEGER NOT NULL DEFAULT 0` to users table (for fresh installs) |
| `packages/types/src/types.ts` | Update | Add `hasAvatar?: boolean` to User interface (optional for backward compat) |

### Documentation

| File | Action | Notes |
|------|--------|-------|
| `docs/07-api-reference.md` | Update | Add `POST /api/v1/upload` endpoint; update avatar field description; update `PATCH /users/me` (remove avatar from editable fields) |

### Scripts

| File | Action | Notes |
|------|--------|-------|
| `scripts/backfill-avatar-flag.ts` | Create | One-time migration: scan R2 for existing avatars, set `has_avatar = 1` |

## Testing

### L1 Unit Tests

```typescript
// tests/unit/upload-config.test.ts
describe('Upload Config', () => {
  it('avatar config has 200KB limit', () => {
    expect(UPLOAD_CONFIGS.avatar.maxSize).toBe(200 * 1024);
  });

  it('avatar allows only jpg and png', () => {
    expect(UPLOAD_CONFIGS.avatar.allowedMimeTypes).toEqual([
      'image/jpeg',
      'image/png'
    ]);
  });
});

// tests/unit/avatar-path.test.ts
describe('computeAvatarPath', () => {
  it('generates correct path for UID 12345', () => {
    expect(computeAvatarPath(12345)).toBe('avatar/000/01/23/45_avatar_big.jpg');
  });

  it('generates correct path for UID 1', () => {
    expect(computeAvatarPath(1)).toBe('avatar/000/00/00/01_avatar_big.jpg');
  });
});
```

### L2 Integration Tests

```typescript
// tests/integration/upload.test.ts
describe('POST /api/v1/upload', () => {
  it('rejects files over 200KB', async () => {
    const largeFile = new Blob([new Uint8Array(201 * 1024)], { type: 'image/png' });
    const formData = new FormData();
    formData.append('file', largeFile, 'large.png');
    formData.append('purpose', 'avatar');

    const res = await authenticatedFetch('/api/v1/upload', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(413);
    const data = await res.json();
    expect(data.error.code).toBe('FILE_TOO_LARGE');
  });

  it('rejects non-image files', async () => {
    const textFile = new Blob(['hello'], { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', textFile, 'test.txt');
    formData.append('purpose', 'avatar');

    const res = await authenticatedFetch('/api/v1/upload', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe('INVALID_FORMAT');
  });

  it('uploads valid avatar and sets has_avatar flag', async () => {
    const validImage = createTestJpeg(50 * 1024);
    const formData = new FormData();
    formData.append('file', validImage, 'avatar.jpg');
    formData.append('purpose', 'avatar');

    const res = await authenticatedFetch('/api/v1/upload', {
      method: 'POST',
      body: formData,
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.url).toMatch(/^\/api\/avatar\/\d+$/);

    // Verify DB flag was set
    const user = await getUser(testUserId);
    expect(user.has_avatar).toBe(1);
  });
});
```

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| File type spoofing | Validate MIME type; consider magic bytes check |
| Path traversal | Generate paths server-side via `computeAvatarPath()` |
| DoS via large uploads | Enforce 200 KB limit before processing |
| Unauthorized upload | Require valid JWT via `authMiddlewareVerified()` (verifies user status from DB) |
| Overwrite others' avatar | Path derived from authenticated `userId` only |

## Migration Checklist

1. [ ] Deploy migration `0023_avatar_has_flag.sql`
2. [ ] Deploy updated Worker with upload handler
3. [ ] Deploy Next.js with new proxy route and updated avatar lib
4. [ ] Run `backfill-avatar-flag.ts` to set `has_avatar = 1` for existing avatars
5. [ ] Update `postingPermission.ts` to use `has_avatar`
6. [ ] Verify posting restriction works correctly

---

## Related

- [API Architecture](./api-architecture.md) - Three-layer model
- [07-api-reference.md](./07-api-reference.md) - API documentation
- [04g-user-auth.md](./04g-user-auth.md) - Authentication system
