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
  width       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_draft_attachments_author ON draft_attachments(author_id);
CREATE INDEX IF NOT EXISTS idx_draft_attachments_created ON draft_attachments(created_at);
```

**Lifecycle:**
1. Upload → INSERT into `draft_attachments`
2. Submit post → SELECT from `draft_attachments`, INSERT into `attachments`, DELETE from `draft_attachments`
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
  width       INTEGER NOT NULL DEFAULT 0,
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

Phase 2: Link attachments to post on submit

```
User submits post → POST /api/v1/posts (with attachmentIds)
                    │
                    ▼
               Worker post.create()
                    │
                    ├── Validate draft ownership & limits
                    ├── Create post
                    ├── SELECT * FROM draft_attachments WHERE id IN (?)
                    ├── INSERT INTO attachments (thread_id, post_id, ...)
                    └── DELETE FROM draft_attachments WHERE id IN (?)
```

### Why Two-Phase?

1. **Better UX**: Upload happens immediately, no waiting on submit
2. **Progress feedback**: Show upload progress per file
3. **Resumable**: User can continue typing while images upload
4. **Validation**: Size/format errors shown immediately
5. **Preview**: Show thumbnails before submit

### Orphan Cleanup

Draft attachments older than 24 hours are orphans. Cleanup via scheduled Worker:

```typescript
// In scheduled handler (already exists for session cleanup)
const orphans = await env.DB.prepare(
  "SELECT id, file_path FROM draft_attachments WHERE created_at < ?"
).bind(Date.now() / 1000 - 86400).all();

for (const orphan of orphans.results) {
  await env.R2.delete(orphan.file_path);
}
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
    "fileSize": 524288,
    "width": 1920
  }
}
```

Frontend derives URL: `https://t.no.mt/${filePath}`

**Errors**: Same as avatar upload (`NO_FILE`, `FILE_TOO_LARGE`, `INVALID_FORMAT`, `UPLOAD_FAILED`)

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
      "width": 1920,
      "hasThumb": false,
      "downloads": 0,
      "createdAt": 1712345678
    }
  ]
}
```

Frontend already derives URL from `filePath` in `post-content.tsx`.

### DELETE /api/v1/upload/draft/:id (new)

Delete draft attachment during compose (before submit).

**Validation**:
- Must exist in `draft_attachments`
- Must be author

**Behavior**:
- Delete from R2
- Delete from `draft_attachments`

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
- Preview thumbnails (derive URL from filePath)
- Remove button per attachment (calls DELETE /api/v1/upload/draft/:id)
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
| Draft delete route | `apps/worker/src/index.ts` (add route) |
| Scheduled cleanup | `apps/worker/src/scheduled.ts` (add orphan cleanup) |
| AttachmentZone | `apps/web/src/components/forum/attachment-zone.tsx` |
| Post API changes | `apps/worker/src/handlers/post.ts` |
| Thread API changes | `apps/worker/src/handlers/thread.ts` |

## Security Considerations

1. **Auth required**: All upload/delete operations require valid JWT
2. **Ownership check**: Only author can delete their draft attachments
3. **Size limits enforced server-side**: Client limits can be bypassed
4. **MIME type validation**: Check actual file content, not just extension
5. **Filename sanitization**: Store original name but use GUID for path
6. **Orphan cleanup**: Prevent storage abuse from abandoned uploads
7. **R2 cleanup on delete**: All deletion paths must also delete R2 blobs

## Migration Checklist

1. [ ] Create migration `0028_create_draft_attachments.sql`
2. [ ] Add `attachment` config to `upload-config.ts`
3. [ ] Add attachment upload case to `upload.ts`
4. [ ] Create `r2-cleanup.ts` helper
5. [ ] Add `DELETE /api/v1/upload/draft/:id` route
6. [ ] Modify `post.create()` to accept `attachmentIds`
7. [ ] Modify `thread.create()` to accept `attachmentIds`
8. [ ] Add orphan cleanup to scheduled Worker
9. [ ] Update user-content/moderation/admin deletion to use R2 cleanup helper
10. [ ] Create `AttachmentZone` component
11. [ ] Integrate into post editor
12. [ ] Run migration
13. [ ] Deploy Worker
14. [ ] Test e2e

## Future Enhancements

- Thumbnail generation (resize large images)
- Image compression before upload
- Paste from clipboard
- Non-image attachments (PDF, ZIP) with download UI
- Drag to reorder attachments
- Edit alt text for accessibility
