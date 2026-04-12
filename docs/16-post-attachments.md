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

Existing `attachments` table (from migration 0000):

```sql
CREATE TABLE IF NOT EXISTS attachments (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES threads(id),
  post_id     INTEGER NOT NULL REFERENCES posts(id),
  author_id   INTEGER NOT NULL REFERENCES users(id),
  filename    TEXT    NOT NULL,     -- Original filename
  file_path   TEXT    NOT NULL,     -- R2 path: attachments/{uuid}.{ext}
  file_size   INTEGER NOT NULL DEFAULT 0,
  is_image    INTEGER NOT NULL DEFAULT 0,
  width       INTEGER NOT NULL DEFAULT 0,
  has_thumb   INTEGER NOT NULL DEFAULT 0,
  downloads   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments(post_id);
CREATE INDEX IF NOT EXISTS idx_attachments_thread ON attachments(thread_id);
```

**Note**: Schema is ready, no migration needed.

## Architecture

### Upload Flow (Two-Phase)

Phase 1: Immediate upload while composing (creates "orphan" attachment)

```
User drags image → POST /api/v1/attachments/upload
                    │
                    ▼
               Next.js proxy (JWT + API key)
                    │
                    ▼
               Worker handler
                    │
                    ├── Validate: size ≤ 1MB, type allowed
                    ├── Generate path: attachments/{uuid}.{ext}
                    ├── PUT to R2
                    └── INSERT INTO attachments (thread_id=0, post_id=0)
                    │
                    ▼
               Response: { id, url, filename, fileSize }
```

Phase 2: Link attachments to post on submit

```
User submits post → POST /api/v1/posts
                    │
                    ▼
               Worker handler
                    │
                    ├── Create thread/post
                    └── UPDATE attachments SET thread_id=?, post_id=? WHERE id IN (?)
```

### Why Two-Phase?

1. **Better UX**: Upload happens immediately, no waiting on submit
2. **Progress feedback**: Show upload progress per file
3. **Resumable**: User can continue typing while images upload
4. **Validation**: Size/format errors shown immediately
5. **Preview**: Show thumbnails before submit

### Orphan Cleanup

Attachments with `thread_id = 0` after 24 hours are orphans (uploaded but never linked to a post). Cleanup via scheduled Worker:

```sql
DELETE FROM attachments WHERE thread_id = 0 AND created_at < ?
-- Also delete from R2: env.R2.delete(file_path)
```

## API Design

### POST /api/v1/attachments/upload

Upload a single attachment. Called once per file during compose.

**Request**: `multipart/form-data`
- `file`: The image file
- Headers: `Authorization: Bearer {jwt}`

**Response** (200):
```json
{
  "data": {
    "id": 12345,
    "url": "https://t.no.mt/attachments/abc123.jpg",
    "filename": "screenshot.png",
    "fileSize": 524288,
    "width": 1920
  }
}
```

**Errors**:
| Code | Status | Description |
|------|--------|-------------|
| `NO_FILE` | 400 | No file in request |
| `FILE_TOO_LARGE` | 413 | Single file > 1 MB |
| `INVALID_FORMAT` | 415 | Not JPG/PNG/GIF/WebP |
| `UPLOAD_FAILED` | 500 | R2 write failed |

### POST /api/v1/threads (existing, enhanced)

Create new thread with attachments.

**Request body additions**:
```json
{
  "subject": "...",
  "content": "...",
  "forumId": 1,
  "attachmentIds": [12345, 12346]  // NEW: IDs from upload phase
}
```

**Validation**:
- All IDs must exist in attachments table
- All must have `author_id = current_user.id`
- All must have `thread_id = 0` (not already linked)
- Total size of all attachments ≤ 5 MB
- Count ≤ 9

### POST /api/v1/threads/:id/posts (existing, enhanced)

Create reply with attachments.

**Request body additions**:
```json
{
  "content": "...",
  "attachmentIds": [12347]
}
```

Same validation as thread creation.

### GET /api/v1/posts/:id/attachments

List attachments for a post. Used when rendering post content.

**Response**:
```json
{
  "data": [
    {
      "id": 12345,
      "url": "https://t.no.mt/attachments/abc123.jpg",
      "filename": "screenshot.png",
      "fileSize": 524288,
      "isImage": true,
      "width": 1920,
      "createdAt": 1712345678
    }
  ]
}
```

### DELETE /api/v1/attachments/:id

Delete attachment during compose (before submit) or by author later.

**Validation**:
- Must be author of attachment
- For linked attachments: only author can delete

**Behavior**:
- Delete from R2
- Delete from database

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
  id: number;
  url: string;
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
- Preview thumbnails
- Remove button per attachment
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
```

### Post Display

When rendering post content, fetch and display attachments:

```tsx
// In post-card.tsx
const { data: attachments } = useAttachments(postId);

// Render image grid or list
<AttachmentGallery attachments={attachments} />
```

## Content Rendering

### Image Embedding

Two approaches for displaying images in post content:

**Option A: Inline in content (auto-insert)**
- When user uploads, insert markdown: `![filename](url)`
- Images render inline with text
- Simple but less flexible

**Option B: Attachment gallery (separate)**
- Images listed below post content
- Click to expand/lightbox
- Better for multiple images
- Keeps content clean

**Recommendation**: Option B for initial implementation, cleaner UX.

## File Locations

| Component | Path |
|-----------|------|
| Upload config | `apps/worker/src/lib/upload-config.ts` (add `attachment`) |
| Upload handler | `apps/worker/src/handlers/attachment.ts` (new) |
| Worker routes | `apps/worker/src/index.ts` (add routes) |
| Next.js proxy | `apps/web/src/app/api/v1/attachments/upload/route.ts` |
| AttachmentZone | `apps/web/src/components/forum/attachment-zone.tsx` |
| AttachmentGallery | `apps/web/src/components/forum/attachment-gallery.tsx` |
| Post API changes | `apps/worker/src/handlers/post.ts` |
| Thread API changes | `apps/worker/src/handlers/thread.ts` |

## Security Considerations

1. **Auth required**: All upload/delete operations require valid JWT
2. **Ownership check**: Only author can delete their attachments
3. **Size limits enforced server-side**: Client limits can be bypassed
4. **MIME type validation**: Check actual file content, not just extension
5. **Filename sanitization**: Store original name but use GUID for path
6. **Orphan cleanup**: Prevent storage abuse from abandoned uploads

## Migration Checklist

1. [ ] Add `attachment` config to `upload-config.ts`
2. [ ] Create `attachment.ts` handler
3. [ ] Add routes to Worker
4. [ ] Create Next.js proxy routes
5. [ ] Modify post/thread creation to accept `attachmentIds`
6. [ ] Create `AttachmentZone` component
7. [ ] Integrate into post editor
8. [ ] Create `AttachmentGallery` component
9. [ ] Add orphan cleanup to scheduled Worker
10. [ ] Deploy Worker
11. [ ] Test e2e

## Future Enhancements

- Thumbnail generation (resize large images)
- Image compression before upload
- Paste from clipboard
- Non-image attachments (PDF, ZIP) with download UI
- Drag to reorder attachments
- Edit alt text for accessibility
