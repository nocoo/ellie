# 15. Avatar Upload

## Overview

Allow users to upload custom avatars via drag-and-drop. Avatars are stored in Cloudflare R2 with GUID-based paths to avoid cache issues.

## Architecture

### Storage Strategy

**GUID-based paths** (new system):
- Each upload generates a unique path: `avatars/{uuid}.{ext}`
- Stored in R2 bucket `tongjinet` at `t.no.mt/avatars/...`
- Path changes bypass all cache layers naturally

**Legacy UID-based paths** (fallback):
- Path computed from UID: `avatar/000/01/23/45_avatar_big.jpg`
- Used for users who haven't uploaded in the new system
- Still served from `t.no.mt/avatar/...`

### Schema

| Field | Type | Purpose |
|-------|------|---------|
| `avatar` | TEXT | Legacy field, always empty string |
| `avatar_path` | TEXT | GUID-based R2 path (e.g., `avatars/abc123.jpg`). Empty = use legacy UID path |
| `has_avatar` | INTEGER | Backward compat flag, set to 1 when avatar_path is set |

```sql
-- Migration 0027_add_avatar_path.sql
ALTER TABLE users ADD COLUMN avatar_path TEXT NOT NULL DEFAULT '';
```

### Avatar Resolution

```
Browser → /api/avatar/{uid}
           │
           ▼
       Next.js proxy
           │
           ├── GET /api/v1/users/{uid}/avatar-path → get avatar_path
           │   (internal endpoint, ignores user status)
           │
           ├── if avatar_path set → https://t.no.mt/{avatar_path}
           └── else → https://t.no.mt/avatar/{computed-from-uid}
           │
           ▼
       CDN/R2 → image
```

**Cache behavior:**
- Normal avatar: cache 7 days
- Fallback (no avatar): cache 1 day
- Fresh upload (?v=): no cache
- API error: cache 5 minutes (prevents caching errors for a day)

### Posting Permission

```typescript
// apps/worker/src/lib/postingPermission.ts
// User has avatar if: avatar_path is set (new GUID system) OR has_avatar = 1 (legacy system)
const hasAvatar = !!userRow.avatar_path || userRow.has_avatar === 1;
if (settings.requireAvatar && !hasAvatar) {
  // Block posting if avatar required but not uploaded
}
```

**Important**: Legacy users with `has_avatar = 1` can still post even if they haven't uploaded in the new system. This ensures backward compatibility.

## Upload Flow

```
Browser → POST /api/v1/upload (multipart)
           │
           ▼
       Next.js proxy (adds JWT + API key)
           │
           ▼
       Worker handler
           │
           ├── Validate: size ≤ 200KB, type = JPG/PNG
           ├── Generate GUID path: avatars/{uuid}.{ext}
           ├── PUT to R2
           └── UPDATE users SET avatar_path = ?, has_avatar = 1
           │
           ▼
       Response: { url: "/api/avatar/{uid}", path: "avatars/..." }
```

## File Locations

| Component | Path |
|-----------|------|
| Migration | `apps/worker/migrations/0027_add_avatar_path.sql` |
| Upload handler | `apps/worker/src/lib/upload.ts` |
| Upload config | `apps/worker/src/lib/upload-config.ts` |
| Avatar proxy | `apps/web/src/app/api/avatar/[uid]/route.ts` |
| Avatar path endpoint | `apps/worker/src/handlers/user.ts` (`getAvatarPath`) |
| Avatar helpers | `apps/web/src/lib/avatar-proxy.ts` |
| Upload UI | `apps/web/src/components/forum/avatar-upload.tsx` |
| Posting permission | `apps/worker/src/lib/postingPermission.ts` |

## Constraints

| Constraint | Value |
|------------|-------|
| Max file size | 200 KB |
| Allowed formats | JPG, PNG |
| Storage | R2 bucket `tongjinet` |
| New avatar folder | `avatars/` |
| Legacy avatar folder | `avatar/` |

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `NO_FILE` | 400 | No file in request |
| `INVALID_PURPOSE` | 400 | Unknown purpose value |
| `FILE_TOO_LARGE` | 413 | Exceeds 200 KB limit |
| `INVALID_FORMAT` | 415 | Not JPG or PNG |
| `UPLOAD_FAILED` | 500 | R2 write failed |

## Migration Notes

1. **Deploy migration**: `npx wrangler d1 migrations apply tongjinet-db --remote -c apps/worker/wrangler.toml`
2. **Deploy Worker**: `bun run worker:deploy`
3. **No backfill needed**: Old users continue using legacy UID-based paths until they upload
4. **Old avatars preserved**: Files in `avatar/` folder remain accessible
