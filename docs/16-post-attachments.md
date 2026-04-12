# 16. Post Attachments

## Overview

Allow users to upload images while composing threads and replies via drag-and-drop. Attachments are stored in Cloudflare R2 and linked to posts via the `attachments` table.

## Constraints

| Constraint | Value |
|------------|-------|
| Max single file size | 1 MB |
| Max total per post | 5 MB |
| Max files per post | 9 |
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

### Solution: Separate Draft Table

New `draft_attachments` table for uploads during compose:

```sql
-- Migration: 0028_create_draft_attachments.sql
CREATE TABLE IF NOT EXISTS draft_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id   INTEGER NOT NULL REFERENCES users(id),
  filename    TEXT    NOT NULL,
  file_path   TEXT    NOT NULL,     -- R2 path: attachments/{uuid}.{ext}
  file_size   INTEGER NOT NULL DEFAULT 0,
  is_image    INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_draft_attachments_author ON draft_attachments(author_id);
CREATE INDEX IF NOT EXISTS idx_draft_attachments_created ON draft_attachments(created_at);
```

**Note**: `width` is NOT extracted at upload time — the Worker only validates MIME/size. If needed later, image metadata extraction can be added as a future enhancement.

**Lifecycle:**
1. Upload → INSERT into `draft_attachments`
2. Submit post → Atomic transaction (see below)
3. Orphan cleanup → DELETE from `draft_attachments` WHERE `created_at < now - 24h`, also delete R2 files

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
                    ├── Validate: size ≤ 1MB, type allowed
                    ├── Generate path: attachments/{uuid}.{ext}
                    ├── PUT to R2
                    └── INSERT INTO draft_attachments
                    │
                    ▼
               Response: { id, filePath, filename, fileSize }
```

Phase 2: Atomic draft promotion on submit

The critical change: draft promotion must be **atomic** and **single-use** to prevent race conditions and partial failures.

**For replies** (`POST /api/v1/posts`):

```typescript
// 1. Validate drafts BEFORE creating post
const drafts = await env.DB.prepare(
  "SELECT * FROM draft_attachments WHERE id IN (?) AND author_id = ?"
).bind(attachmentIds, user.userId).all();

if (drafts.results.length !== attachmentIds.length) {
  return errorResponse("INVALID_ATTACHMENTS", 400); // Some IDs invalid/already used
}

// Check total size
const totalSize = drafts.results.reduce((sum, d) => sum + d.file_size, 0);
if (totalSize > 5 * 1024 * 1024) {
  return errorResponse("ATTACHMENTS_TOO_LARGE", 413);
}

// 2. Delete drafts FIRST (single-use guarantee via DELETE ... RETURNING)
const deleted = await env.DB.prepare(
  "DELETE FROM draft_attachments WHERE id IN (?) AND author_id = ? RETURNING *"
).bind(attachmentIds, user.userId).all();

if (deleted.results.length !== attachmentIds.length) {
  // Race condition: another request already consumed some drafts
  return errorResponse("INVALID_ATTACHMENTS", 400);
}

// 3. Create post
const postResult = await env.DB.prepare(
  "INSERT INTO posts (...) VALUES (...)"
).bind(...).run();
const postId = postResult.meta.last_row_id;

// 4. Insert finalized attachments (from deleted draft data)
const attachmentInserts = deleted.results.map(d =>
  env.DB.prepare(
    "INSERT INTO attachments (thread_id, post_id, author_id, filename, file_path, file_size, is_image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(threadId, postId, user.userId, d.filename, d.file_path, d.file_size, d.is_image, now)
);
await env.DB.batch(attachmentInserts);
```

**For thread creation** (`POST /api/v1/threads`):

Current `thread.create()` uses `batch()` to insert thread + first post, but doesn't capture the post ID. Must restructure:

```typescript
// 1. Validate drafts (same as above)
// 2. Delete drafts with RETURNING (same as above)

// 3. Insert thread FIRST (get thread_id)
const threadResult = await env.DB.prepare(
  "INSERT INTO threads (...) VALUES (...)"
).bind(...).run();
const threadId = threadResult.meta.last_row_id;

// 4. Insert first post SEPARATELY (get post_id)
const postResult = await env.DB.prepare(
  "INSERT INTO posts (thread_id, ...) VALUES (?, ...)"
).bind(threadId, ...).run();
const postId = postResult.meta.last_row_id;

// 5. Batch: update forum/user counts + insert attachments
await env.DB.batch([
  env.DB.prepare("UPDATE forums SET threads = threads + 1, ...").bind(...),
  env.DB.prepare("UPDATE users SET threads = threads + 1, ...").bind(...),
  ...deleted.results.map(d =>
    env.DB.prepare("INSERT INTO attachments (...) VALUES (...)").bind(threadId, postId, ...)
  ),
]);
```

**Key invariants:**
- `DELETE ... RETURNING` ensures single-use: if two requests race, only one gets the drafts
- Drafts are deleted BEFORE post creation: if post insert fails, drafts are gone but R2 blobs remain (orphan cleanup handles this)
- No transaction needed: D1 doesn't support multi-statement transactions, but the delete-first pattern prevents duplicate attachment linking

### Why Two-Phase?

1. **Better UX**: Upload happens immediately, no waiting on submit
2. **Progress feedback**: Show upload progress per file
3. **Resumable**: User can continue typing while images upload
4. **Validation**: Size/format errors shown immediately
5. **Preview**: Show thumbnails before submit

### Orphan Cleanup

Draft attachments older than 24 hours are orphans. Also catches R2 blobs from failed post creations. Cleanup via scheduled Worker:

```typescript
// In scheduled handler (already exists for session cleanup)
const orphans = await env.DB.prepare(
  "SELECT id, file_path FROM draft_attachments WHERE created_at < ?"
).bind(Date.now() / 1000 - 86400).all();

// Delete R2 blobs
await deleteAttachmentBlobs(env, orphans.results.map(o => o.file_path));

// Delete DB rows
await env.DB.prepare(
  "DELETE FROM draft_attachments WHERE created_at < ?"
).bind(Date.now() / 1000 - 86400).run();
```

### R2 Deletion Helper

Create shared helper for R2 blob cleanup, used by:
- Draft orphan cleanup
- User content deletion (`user-content.ts`)
- Moderation nuke (`moderation.ts`)
- Admin attachment delete (`admin/attachment.ts`)

```typescript
// apps/worker/src/lib/r2-cleanup.ts
export async function deleteAttachmentBlobs(
  env: Env,
  filePaths: string[]
): Promise<void> {
  // R2.delete() is idempotent, safe to call on non-existent keys
  await Promise.all(filePaths.map(path => env.R2.delete(path)));
}
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

**Errors**: Same as avatar upload (`NO_FILE`, `FILE_TOO_LARGE`, `INVALID_FORMAT`, `UPLOAD_FAILED`)

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
- All IDs must exist in `draft_attachments`
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
| Upload handler | `apps/worker/src/lib/upload.ts` (add attachment case) |
| R2 cleanup helper | `apps/worker/src/lib/r2-cleanup.ts` (new) |
| Draft delete handler | `apps/worker/src/handlers/upload.ts` (new) |
| Draft delete proxy | `apps/web/src/app/api/v1/upload/draft/[id]/route.ts` (new) |
| Scheduled cleanup | `apps/worker/src/scheduled.ts` (add orphan cleanup) |
| AttachmentZone | `apps/web/src/components/forum/attachment-zone.tsx` |
| Post API changes | `apps/worker/src/handlers/post.ts` |
| Thread API changes | `apps/worker/src/handlers/thread.ts` (restructure for post_id) |

## Security Considerations

1. **Auth required**: All upload/delete operations require valid JWT
2. **Ownership check**: Only author can delete their draft attachments
3. **Single-use drafts**: `DELETE ... RETURNING` prevents race conditions
4. **Size limits enforced server-side**: Client limits can be bypassed
5. **MIME type validation**: Check actual file content, not just extension
6. **Filename sanitization**: Store original name but use GUID for path
7. **Orphan cleanup**: Prevent storage abuse from abandoned uploads
8. **R2 cleanup on delete**: All deletion paths must also delete R2 blobs

## Migration Checklist

1. [ ] Create migration `0028_create_draft_attachments.sql`
2. [ ] Add `attachment` config to `upload-config.ts`
3. [ ] Add attachment upload case to `upload.ts`
4. [ ] Create `r2-cleanup.ts` helper
5. [ ] Create `upload.ts` handler with draft delete
6. [ ] Create Next.js proxy `apps/web/src/app/api/v1/upload/draft/[id]/route.ts`
7. [ ] Restructure `thread.create()` to get `post_id` separately
8. [ ] Modify `post.create()` to accept `attachmentIds` with atomic promotion
9. [ ] Modify `thread.create()` to accept `attachmentIds`
10. [ ] Add orphan cleanup to scheduled Worker
11. [ ] Update user-content/moderation/admin deletion to use R2 cleanup helper
12. [ ] Create `AttachmentZone` component
13. [ ] Integrate into post editor
14. [ ] Run migration
15. [ ] Deploy Worker
16. [ ] Test e2e

## Future Enhancements

- Image metadata extraction (width/height) at upload time
- Thumbnail generation (resize large images)
- Image compression before upload
- Paste from clipboard
- Non-image attachments (PDF, ZIP) with download UI
- Drag to reorder attachments
- Edit alt text for accessibility
