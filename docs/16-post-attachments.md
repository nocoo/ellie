# 16. Post Attachments

## Overview

Allow users to upload images while composing threads and replies via drag-and-drop. Attachments are stored in Cloudflare R2 and linked to posts via the `attachments` table.

## Constraints

| Constraint | Value |
|------------|-------|
| Max single file size | 1 MB |
| Max total per post | 5 MB |
| Max files per post | 9 |
| Max active drafts per user | 20 |
| Max draft storage per user | 20 MB |
| Draft TTL | 6 hours |
| Allowed formats | JPG, PNG, GIF, WebP |
| Storage | R2 bucket `tongjinet` |
| Folder | `attachments/` |

## Database Schema

### Problem: FK Constraints

Existing `attachments` table has NOT NULL FK constraints:

```sql
-- Current schema (0000_init_schema.sql)
thread_id   INTEGER NOT NULL REFERENCES threads(id),
post_id     INTEGER NOT NULL REFERENCES posts(id),
```

This blocks two-phase upload (upload before post exists).

### Solution: Separate Draft Table with Status

New `draft_attachments` table with status tracking for safe promotion:

```sql
-- Migration: 0028_create_draft_attachments.sql
CREATE TABLE IF NOT EXISTS draft_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  filename    TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,     -- R2 path: attachments/{uuid}.{ext}
  file_size   INTEGER NOT NULL DEFAULT 0,
  is_image    INTEGER NOT NULL DEFAULT 1,
  status      INTEGER NOT NULL DEFAULT 0,  -- 0=pending, 1=claimed, 2=promoted
  claimed_at  INTEGER,                      -- When claimed for promotion
  created_at  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_draft_attachments_author ON draft_attachments(author_id);
CREATE INDEX IF NOT EXISTS idx_draft_attachments_created ON draft_attachments(created_at);
CREATE INDEX IF NOT EXISTS idx_draft_attachments_status ON draft_attachments(status, created_at);
```

**Status values:**
- `0` = pending (available for use)
- `1` = claimed (locked for promotion, has `claimed_at` timestamp)
- `2` = promoted (successfully moved to attachments, pending cleanup)

**Note**: `width` is NOT extracted at upload time — the Worker only validates MIME/size. If needed later, image metadata extraction can be added as a future enhancement.

**Lifecycle:**
1. Upload → INSERT with `status=0`
2. Submit post → Claim drafts (`status=1`), create post, promote to attachments (`status=2`)
3. Cleanup → DELETE where `status=2` OR (`status IN (0,1)` AND too old)

### Existing `attachments` Table

No changes needed. Used for finalized post attachments:

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES threads(id),
  post_id     INTEGER NOT NULL REFERENCES posts(id),
  author_id   INTEGER NOT NULL REFERENCES users(id),
  filename    TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,
  file_size   INTEGER NOT NULL DEFAULT 0,
  is_image    INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,   -- Always 0 for now
  has_thumb   INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0
);
```

## Architecture

### Upload Flow (Two-Phase)

Phase 1: Immediate upload while composing

```
User drags image → POST /api/v1/upload (purpose=attachment)
                    │
                    ▼
               Next.js proxy (JWT + API key)
                    │
                    ▼
               Worker handleUpload()
                    │
                    ├── Check draft quota (count ≤ 20, total ≤ 20MB)
                    ├── Validate: size ≤ 1MB, type allowed
                    ├── Generate path: attachments/{uuid}.{ext}
                    ├── PUT to R2
                    └── INSERT INTO draft_attachments (status=0)
                    │
                    ▼
               Response: { id, filePath, filename, fileSize }
```

**Draft quota check (prevents abuse):**
```typescript
const quota = await env.DB.prepare(
  "SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total FROM draft_attachments WHERE author_id = ? AND status = 0"
).bind(user.userId).first<{ count: number; total: number }>();

if (quota.count >= 20) {
  return errorResponse("DRAFT_QUOTA_EXCEEDED", 429, { message: "Too many pending uploads" });
}
if (quota.total + file.size > 20 * 1024 * 1024) {
  return errorResponse("DRAFT_QUOTA_EXCEEDED", 429, { message: "Draft storage limit exceeded" });
}
```

Phase 2: Safe draft promotion on submit

The key insight: D1 `batch()` is transactional — if any statement fails, the entire batch rolls back. We use this to ensure atomicity.

**For replies** (`POST /api/v1/posts`):

```typescript
// 1. Validate and CLAIM drafts atomically
const claimResult = await env.DB.prepare(
  `UPDATE draft_attachments 
   SET status = 1, claimed_at = ? 
   WHERE id IN (SELECT value FROM json_each(?)) 
     AND author_id = ? 
     AND status = 0
   RETURNING *`
).bind(now, JSON.stringify(attachmentIds), user.userId).all();

if (claimResult.results.length !== attachmentIds.length) {
  // Some IDs invalid, already claimed, or not owned by user
  // Rollback any partial claims
  await env.DB.prepare(
    "UPDATE draft_attachments SET status = 0, claimed_at = NULL WHERE author_id = ? AND status = 1 AND claimed_at = ?"
  ).bind(user.userId, now).run();
  return errorResponse("INVALID_ATTACHMENTS", 400);
}

// Check total size
const totalSize = claimResult.results.reduce((sum, d) => sum + d.file_size, 0);
if (totalSize > 5 * 1024 * 1024) {
  // Rollback claims
  await env.DB.prepare(
    "UPDATE draft_attachments SET status = 0, claimed_at = NULL WHERE id IN (SELECT value FROM json_each(?))"
  ).bind(JSON.stringify(attachmentIds)).run();
  return errorResponse("ATTACHMENTS_TOO_LARGE", 413);
}

// 2. Create post + promote attachments in single transaction
const postResult = await env.DB.prepare(
  "INSERT INTO posts (...) VALUES (...)"
).bind(...).run();
const postId = postResult.meta.last_row_id;

// 3. Transactional batch: insert attachments + mark drafts as promoted + update counts
await env.DB.batch([
  // Insert into attachments
  ...claimResult.results.map(d =>
    env.DB.prepare(
      "INSERT INTO attachments (thread_id, post_id, author_id, filename, file_path, file_size, is_image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(threadId, postId, user.userId, d.filename, d.file_path, d.file_size, d.is_image, now)
  ),
  // Mark drafts as promoted (not deleted yet — cleanup job handles it)
  env.DB.prepare(
    "UPDATE draft_attachments SET status = 2 WHERE id IN (SELECT value FROM json_each(?))"
  ).bind(JSON.stringify(attachmentIds)),
  // Update thread/forum counts...
]);
```

**For thread creation** (`POST /api/v1/threads`):

```typescript
// 1. Claim and validate drafts (same as above)

// 2. Insert thread FIRST (get thread_id)
const threadResult = await env.DB.prepare(
  "INSERT INTO threads (...) VALUES (...)"
).bind(...).run();
const threadId = threadResult.meta.last_row_id;

// 3. Insert first post SEPARATELY (get post_id)
const postResult = await env.DB.prepare(
  "INSERT INTO posts (thread_id, ...) VALUES (?, ...)"
).bind(threadId, ...).run();
const postId = postResult.meta.last_row_id;

// 4. Transactional batch: insert attachments + mark promoted + update counts
await env.DB.batch([
  ...claimResult.results.map(d =>
    env.DB.prepare("INSERT INTO attachments (...) VALUES (...)").bind(threadId, postId, ...)
  ),
  env.DB.prepare("UPDATE draft_attachments SET status = 2 WHERE id IN (SELECT value FROM json_each(?))").bind(...),
  env.DB.prepare("UPDATE forums SET threads = threads + 1, ...").bind(...),
  env.DB.prepare("UPDATE users SET threads = threads + 1, ...").bind(...),
]);
```

**Key invariants:**
- `status=1` (claimed) prevents double-use: only one request can claim pending drafts
- `status=2` (promoted) marks successful promotion; R2 blobs are NOT orphans
- If batch fails after claim, cleanup recovers: stale claims (status=1 with old claimed_at) get reset
- D1 batch is transactional: partial insert failures roll back

### Why Two-Phase?

1. **Better UX**: Upload happens immediately, no waiting on submit
2. **Progress feedback**: Show upload progress per file
3. **Resumable**: User can continue typing while images upload
4. **Validation**: Size/format errors shown immediately
5. **Preview**: Show thumbnails before submit

### Cleanup (Scheduled Handler)

Add to existing scheduled handler in `apps/worker/src/index.ts:541`:

```typescript
async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(aggregateOnlineStats(env));
  ctx.waitUntil(cleanupDraftAttachments(env));  // NEW
}
```

**Cleanup logic:**

```typescript
// apps/worker/src/lib/draft-cleanup.ts
export async function cleanupDraftAttachments(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const draftTTL = 6 * 60 * 60;  // 6 hours
  const claimTimeout = 5 * 60;    // 5 minutes — stale claims

  // 1. Delete promoted drafts (status=2) — R2 blobs already in attachments
  await env.DB.prepare("DELETE FROM draft_attachments WHERE status = 2").run();

  // 2. Reset stale claims (status=1, claimed_at older than 5 minutes)
  await env.DB.prepare(
    "UPDATE draft_attachments SET status = 0, claimed_at = NULL WHERE status = 1 AND claimed_at < ?"
  ).bind(now - claimTimeout).run();

  // 3. Find and delete expired pending/reset drafts — also delete R2 blobs
  const expired = await env.DB.prepare(
    "SELECT id, file_path FROM draft_attachments WHERE status IN (0, 1) AND created_at < ?"
  ).bind(now - draftTTL).all<{ id: number; file_path: string }>();

  if (expired.results.length > 0) {
    // Delete R2 blobs
    await deleteAttachmentBlobs(env, expired.results.map(e => e.file_path));
    // Delete DB rows
    await env.DB.prepare(
      "DELETE FROM draft_attachments WHERE status IN (0, 1) AND created_at < ?"
    ).bind(now - draftTTL).run();
  }
}
```

### R2 Deletion Helper

Create shared helper for R2 blob cleanup:

```typescript
// apps/worker/src/lib/r2-cleanup.ts
export async function deleteAttachmentBlobs(
  env: Env,
  filePaths: string[]
): Promise<void> {
  // R2.delete() is idempotent, safe to call on non-existent keys
  await Promise.all(filePaths.map(path => env.R2.delete(path)));
}

/**
 * Delete attachments by post ID — used by all post deletion paths.
 * Deletes both DB rows and R2 blobs.
 */
export async function deleteAttachmentsByPostId(
  env: Env,
  postId: number
): Promise<void> {
  const attachments = await env.DB.prepare(
    "SELECT file_path FROM attachments WHERE post_id = ?"
  ).bind(postId).all<{ file_path: string }>();

  if (attachments.results.length > 0) {
    await deleteAttachmentBlobs(env, attachments.results.map(a => a.file_path));
    await env.DB.prepare("DELETE FROM attachments WHERE post_id = ?").bind(postId).run();
  }
}

/**
 * Delete attachments by thread ID — used by thread deletion paths.
 * Deletes both DB rows and R2 blobs.
 */
export async function deleteAttachmentsByThreadId(
  env: Env,
  threadId: number
): Promise<void> {
  const attachments = await env.DB.prepare(
    "SELECT file_path FROM attachments WHERE thread_id = ?"
  ).bind(threadId).all<{ file_path: string }>();

  if (attachments.results.length > 0) {
    await deleteAttachmentBlobs(env, attachments.results.map(a => a.file_path));
    await env.DB.prepare("DELETE FROM attachments WHERE thread_id = ?").bind(threadId).run();
  }
}
```

### Deletion Paths — Complete Coverage

**CRITICAL**: All post/thread deletion paths must clean up R2 blobs. Current code only deletes DB rows.

| Path | File | Current Issue | Fix |
|------|------|---------------|-----|
| User deletes own post | `user-content.ts:67` | No attachment cleanup | Add `deleteAttachmentsByPostId()` |
| User deletes own thread | `user-content.ts:129` | Deletes attachment rows, not R2 | Use `deleteAttachmentsByThreadId()` |
| Mod deletes post | `moderation.ts:395` | No attachment cleanup | Add `deleteAttachmentsByPostId()` |
| Mod deletes thread | `moderation.ts` | Deletes attachment rows, not R2 | Use `deleteAttachmentsByThreadId()` |
| Admin deletes post | `admin/post.ts:166` | No attachment cleanup | Add `deleteAttachmentsByPostId()` |
| Admin nuke user | `moderation.ts` | Deletes attachment rows, not R2 | Use helper |
| Admin delete attachment | `admin/attachment.ts` | Missing R2 delete | Add R2 delete |

**Example fix for user-content.ts:67:**

```typescript
// Before: only deletes posts
await env.DB.batch([
  env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
  ...
]);

// After: also deletes attachments and R2 blobs
await deleteAttachmentsByPostId(env, id);  // NEW — deletes R2 + DB
await env.DB.batch([
  env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
  ...
]);
```

## API Design

### POST /api/v1/upload (existing, add purpose=attachment)

Reuse existing upload infrastructure. Add `attachment` to `UPLOAD_CONFIGS`:

```typescript
// upload-config.ts
export const UPLOAD_CONFIGS: Record<string, UploadConfig> = {
  avatar: { maxSize: 200 * 1024, allowedMimeTypes: ["image/jpeg", "image/png"] },
  attachment: {
    maxSize: 1 * 1024 * 1024,  // 1 MB
    allowedMimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  },
};
```

**Request**: `multipart/form-data`
- `file`: The image file
- `purpose`: `"attachment"`
- Headers: `Authorization: Bearer {jwt}`

**Response** (200):
```json
{
  "data": {
    "id": 12345,
    "filePath": "attachments/abc123.jpg",
    "filename": "screenshot.png",
    "fileSize": 524288
  }
}
```

**Note**: No `width` in response — image metadata extraction is out of scope for initial implementation.

Frontend derives URL: `https://t.no.mt/${filePath}`

**Errors**:
| Code | Status | Description |
|------|--------|-------------|
| `NO_FILE` | 400 | No file in request |
| `FILE_TOO_LARGE` | 413 | Single file > 1 MB |
| `INVALID_FORMAT` | 415 | Not JPG/PNG/GIF/WebP |
| `DRAFT_QUOTA_EXCEEDED` | 429 | Too many drafts or storage limit |
| `UPLOAD_FAILED` | 500 | R2 write failed |

### DELETE /api/v1/upload/draft/:id (new)

Delete draft attachment during compose (before submit).

**Next.js proxy required**: Create `apps/web/src/app/api/v1/upload/draft/[id]/route.ts`:

```typescript
// Proxy DELETE to Worker with JWT + API key
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const jwt = await getWorkerJwt();
  if (!jwt) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return forumApi.deleteAuth(`/api/v1/upload/draft/${id}`, jwt);
}
```

**Worker handler validation**:
- Must exist in `draft_attachments`
- Must be author (`author_id = user.userId`)
- Must be `status = 0` (not claimed or promoted)

**Behavior**:
- Delete from R2
- Delete from `draft_attachments`

### POST /api/v1/threads (existing, enhanced)

Create new thread with attachments.

**Request body additions**:
```json
{
  "subject": "...",
  "content": "...",
  "forumId": 1,
  "attachmentIds": [12345, 12346]
}
```

**Validation**:
- All IDs must exist in `draft_attachments` with `status = 0`
- All must have `author_id = current_user.id`
- Total size of all attachments ≤ 5 MB
- Count ≤ 9

**Implementation change**: Restructure `thread.create()` to insert thread and first post separately (not in batch) to capture `post_id`.

### POST /api/v1/posts (existing, enhanced)

Create reply with attachments. Route is `POST /api/v1/posts` with `threadId` in body (not nested route).

**Request body additions**:
```json
{
  "threadId": 123,
  "content": "...",
  "attachmentIds": [12347]
}
```

Same validation as thread creation.

### GET /api/v1/posts/:id/attachments (existing)

Already implemented. Returns `Attachment[]` with `filePath`, `hasThumb`, `downloads`, etc.

**Current response shape** (keep as-is):
```json
{
  "data": [
    {
      "id": 12345,
      "threadId": 100,
      "postId": 200,
      "authorId": 1,
      "filename": "screenshot.png",
      "filePath": "attachments/abc123.jpg",
      "fileSize": 524288,
      "isImage": true,
      "width": 0,
      "hasThumb": false,
      "downloads": 0,
      "createdAt": 1712345678
    }
  ]
}
```

Frontend already derives URL from `filePath` in `post-content.tsx`.

## Frontend Design

### Attachment Zone Component

New component `<AttachmentZone>` for use in post editor:

```tsx
interface AttachmentZoneProps {
  attachments: UploadedAttachment[];
  onAttachmentsChange: (attachments: UploadedAttachment[]) => void;
  maxFiles?: number;        // default: 9
  maxFileSize?: number;     // default: 1MB
  maxTotalSize?: number;    // default: 5MB
}

interface UploadedAttachment {
  id: number;               // draft_attachments.id
  filePath: string;         // R2 path
  filename: string;
  fileSize: number;
  uploading?: boolean;
  progress?: number;
  error?: string;
}
```

**Features**:
- Drag-and-drop zone (or click to select)
- Multiple file selection
- Progress bar per file
- Preview thumbnails (derive URL: `https://t.no.mt/${filePath}`)
- Remove button per attachment (calls `DELETE /api/v1/upload/draft/:id`)
- Total size indicator
- Error messages inline

### Post Editor Integration

```tsx
// In thread-composer.tsx and reply-composer.tsx
const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);

// On submit, pass attachment IDs to API
const attachmentIds = attachments
  .filter(a => !a.uploading && !a.error)
  .map(a => a.id);

await createThread({ subject, content, forumId, attachmentIds });
// or
await createPost({ threadId, content, attachmentIds });
```

### Post Display (existing)

Attachments already fetched in `thread-detail.server.ts` via:
```typescript
const attachmentResults = await Promise.all(
  postsRes.data.map((post) =>
    forumApi.getAll<Attachment>(`/api/v1/posts/${post.id}/attachments`)
  ),
);
```

And grouped into `post.attachments` before render. Keep this pattern — no changes needed.

The existing `<PostContent>` or attachment display component derives URLs from `filePath`.

## Content Rendering

### Image Display

Images shown in attachment gallery below post content:
- Grid layout for multiple images
- Click to expand/lightbox
- Shows filename on hover

Keep display logic in existing components, just ensure they handle the new attachments.

## File Locations

| Component | Path |
|-----------|------|
| Migration | `apps/worker/migrations/0028_create_draft_attachments.sql` |
| Upload config | `apps/worker/src/lib/upload-config.ts` (add `attachment`) |
| Upload handler | `apps/worker/src/lib/upload.ts` (add attachment case + quota check) |
| R2 cleanup helper | `apps/worker/src/lib/r2-cleanup.ts` (new) |
| Draft cleanup | `apps/worker/src/lib/draft-cleanup.ts` (new) |
| Draft delete handler | `apps/worker/src/handlers/upload.ts` (new) |
| Draft delete proxy | `apps/web/src/app/api/v1/upload/draft/[id]/route.ts` (new) |
| Scheduled handler | `apps/worker/src/index.ts:541` (add draft cleanup call) |
| AttachmentZone | `apps/web/src/components/forum/attachment-zone.tsx` |
| Post API changes | `apps/worker/src/handlers/post.ts` |
| Thread API changes | `apps/worker/src/handlers/thread.ts` (restructure for post_id) |
| User content fixes | `apps/worker/src/handlers/user-content.ts` (add R2 cleanup) |
| Moderation fixes | `apps/worker/src/handlers/moderation.ts` (add R2 cleanup) |
| Admin post fixes | `apps/worker/src/handlers/admin/post.ts` (add R2 cleanup) |

## Security Considerations

1. **Auth required**: All upload/delete operations require valid JWT
2. **Ownership check**: Only author can delete their draft attachments
3. **Draft quota**: Prevents abuse via unlimited uploads (20 files, 20MB per user)
4. **Claim-based promotion**: `status` field prevents race conditions
5. **Size limits enforced server-side**: Client limits can be bypassed
6. **MIME type validation**: Check actual file content, not just extension
7. **Filename sanitization**: Store original name but use GUID for path
8. **Complete deletion**: All post/thread delete paths clean up R2 blobs

## Migration Checklist

1. [ ] Create migration `0028_create_draft_attachments.sql`
2. [ ] Add `attachment` config to `upload-config.ts`
3. [ ] Add attachment upload case to `upload.ts` with quota check
4. [ ] Create `r2-cleanup.ts` helper with `deleteAttachmentsByPostId/ThreadId`
5. [ ] Create `draft-cleanup.ts` for scheduled cleanup
6. [ ] Create `upload.ts` handler with draft delete
7. [ ] Create Next.js proxy `apps/web/src/app/api/v1/upload/draft/[id]/route.ts`
8. [ ] Restructure `thread.create()` to get `post_id` separately
9. [ ] Modify `post.create()` to accept `attachmentIds` with claim-based promotion
10. [ ] Modify `thread.create()` to accept `attachmentIds`
11. [ ] Add draft cleanup call to scheduled handler in `index.ts:541`
12. [ ] Fix `user-content.ts` post/thread deletion to use R2 helpers
13. [ ] Fix `moderation.ts` post/thread deletion to use R2 helpers
14. [ ] Fix `admin/post.ts` deletion to use R2 helpers
15. [ ] Fix `admin/attachment.ts` to delete R2 blobs
16. [ ] Create `AttachmentZone` component
17. [ ] Integrate into post editor
18. [ ] Run migration
19. [ ] Deploy Worker
20. [ ] Test e2e

## Future Enhancements

- Image metadata extraction (width/height) at upload time
- Thumbnail generation (resize large images)
- Image compression before upload
- Paste from clipboard
- Non-image attachments (PDF, ZIP) with download UI
- Drag to reorder attachments
- Edit alt text for accessibility
- Published attachment quota per user (with admin dashboard)
