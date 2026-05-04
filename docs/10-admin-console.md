# 10. Admin Console (Management Backend)

> This document describes the admin console for Ellie forum - a full-featured management backend accessible only to administrators.

## Overview

The admin console is a standalone management interface at `/admin/*` that provides comprehensive control over all forum entities.

**Access Control Model:**
- Admin status is determined by `ADMIN_EMAILS` environment variable (comma-separated email whitelist)
- Authentication via Google OAuth + NextAuth session
- All admins in whitelist have equal full permissions (no role hierarchy in admin console)
- This is independent of forum user roles (role=1/2/3 in users table)

**Key Principles:**
- Complete visibility: admins can see all data across all forums
- Full CRUD operations on all entities
- Batch operations for efficiency
- Dangerous actions require confirmation dialogs
- Atomic commits for each feature

## Architecture

```
/admin/login          → Admin authentication (Google OAuth)
/admin                → Dashboard
/admin/users          → User management
/admin/threads        → Thread management
/admin/threads/[id]   → Thread detail (posts)
/admin/forums         → Forum management
/admin/attachments    → Attachment management
/admin/statistics     → Statistics recalculation
/admin/ip-bans        → IP ban management
/admin/censor-words   → Sensitive word filtering
/admin/settings/*     → System settings
```

### Authentication Flow

```
Browser → Next.js Admin Layout
            ↓
         resolveAdmin(session)  ← Checks session.user.email against ADMIN_EMAILS
            ↓
         If not admin → redirect to /admin/login
            ↓
         Admin API Routes (/api/admin/*) → Session check + ADMIN_EMAILS check
            ↓
         Worker API (/api/admin/*) ← Uses Key B (ADMIN_API_KEY)
            ↓
         D1 Database
```

**Important:** Worker does NOT validate admin identity. It trusts requests with Key B unconditionally. All authorization happens at the Next.js layer.

### Key Files

| Layer | Files |
|-------|-------|
| Auth Check | `apps/web/src/lib/admin.ts` - `isAdmin()`, `resolveAdmin()` |
| Layout Guard | `apps/web/src/app/(admin)/layout.tsx` - redirects non-admins |
| API Proxy | `apps/web/src/lib/admin-proxy.ts` - session validation |
| Admin Pages | `apps/web/src/app/(admin)/admin/**/*.tsx` |
| Admin API Routes | `apps/web/src/app/api/admin/**/*.ts` |
| Worker Handlers | `apps/worker/src/handlers/admin/*.ts` |
| Viewmodels | `apps/web/src/viewmodels/admin/*.ts` |

---

## Module Status

### 1. Overview Module ✅ Complete

| Page | Path | Status | Features |
|------|------|--------|----------|
| **Dashboard** | `/admin` | ✅ | User/thread/post statistics, quick links, activity summary |

### 2. Content Management Module ✅ Complete

| Page | Path | Status | Features |
|------|------|--------|----------|
| **Users** | `/admin/users` | ✅ | List/search/filter (status/role), edit, ban/unban, ban+delete content, nuke, batch ban/activate |
| **Threads** | `/admin/threads` | ✅ | List/search/filter (sticky/closed), edit, lock/unlock, delete, batch delete |
| **Thread Detail** | `/admin/threads/[id]` | ✅ | View thread with all posts, edit thread properties, edit/delete individual posts |
| **Forums** | `/admin/forums` | ✅ | Tree structure (group/forum/sub), create/edit/delete, show/hide, merge forums, reorder |
| **Attachments** | `/admin/attachments` | ✅ | Grid/list view toggle, image preview (lightbox), filter by type, delete, batch delete |

### 3. Data & Statistics Module ✅ Complete

| Page | Path | Status | Features |
|------|------|--------|----------|
| **Statistics** | `/admin/statistics` | ✅ | Recalculate forum stats, thread stats, user stats |

### 4. Security Module ✅ Complete

| Page | Path | Status | Features |
|------|------|--------|----------|
| **IP Bans** | `/admin/ip-bans` | ✅ | Add/edit/delete bans, IP check tool, permanent/temporary, batch delete |
| **Censor Words** | `/admin/censor-words` | ✅ | Add/edit/delete words, replace/block/ban actions, content test tool, batch delete |

### 5. Settings Module ✅ Complete

| Page | Path | Status | Features |
|------|------|--------|----------|
| **General** | `/admin/settings/general` | ✅ | Site name, description, global parameters |
| **Features** | `/admin/settings/features` | ✅ | Feature toggles (registration, posting permissions, etc.) |
| **Nav Links** | `/admin/settings/nav-links` | ✅ | Header navigation bar, drag-to-reorder |
| **Friend Links** | `/admin/settings/friend-links` | ✅ | Footer friend links, drag-to-reorder |

### 6. Reports Management ✅ Complete

| Page | Path | Status | Features |
|------|------|--------|----------|
| **Reports** | `/admin/reports` | ✅ | Type-aware list (thread/post/user) with per-type target metadata, status & type filters, detail dialog, resolve/dismiss/revert + batch delete |

**Scope (E batch):**
- Worker `POST /api/v1/reports` accepts `type ∈ {thread, post, user}` with uniform self-report / duplicate / visibility guards.
- Admin list/detail JOINs per-type metadata (`target_title` for thread/post via `threads.subject`, `target_name` for user, `thread_id` for post→parent thread navigation).
- Admin UI exposes 类型 filter + 类型 badge column; target column links to `/admin/threads/:id` (thread/post) or `/admin/users/:id` (user).
- Web entries: 举报回帖 (post-card), 举报主题 (thread header), 举报用户 (profile hero). UI hides self-report; Worker remains final guard.

### 7. Audit Logs ✅ Complete (F batch)

| Page | Path | Status | Features |
|------|------|--------|----------|
| **Operation Logs** | `/admin/logs/operations` | ✅ | Read-only admin action history. Filters: action (exact), targetType, adminId, targetId, date range. Detail dialog renders pretty-printed JSON or falls back to raw text on parse failure. Target column whitelist-links to `user`/`thread`/`report`/`forum`. |

**Scope (F batch):**
- F1 (write helper): `apps/worker/src/lib/adminLog.ts` provides `resolveActor(request)` (reads `X-Admin-Actor-Email` / `X-Admin-Actor-Name` injected by `adminApiAs`; falls back to `system`/`id=0`), `sanitizeAdminLogDetails(input)` (deny-list redaction at every depth, depth cap 4, 4 KB UTF-8 cap with `{truncated:true,head:"…"}` envelope), and `writeAdminLog(env, actor, params)` (best-effort INSERT — never throws back to the caller; failures go to `console.error`).
- F2 (read API): `GET /api/admin/admin-logs` (list, filterable + paginated) and `GET /api/admin/admin-logs/:id` (single row).
- F3-a/b/c (handler integration): the mutation families covered are `user.ban` / `user.unban` / `user.nuke` / `user.purge`, `report.resolve` / `report.dismiss` / `report.batch_delete`, `thread.update` / `thread.delete` / `thread.batch_delete` / `thread.batch_move`, `post.update` / `post.delete` / `post.batch_delete`, `forum.create` / `forum.update` / `forum.delete` / `forum.merge` / `forum.reorder`, `setting.update`, `ip_ban.create` / `ip_ban.update` / `ip_ban.delete` / `ip_ban.batch_delete`, `censor_word.create` / `censor_word.update` / `censor_word.delete` / `censor_word.batch_delete`, `announcement.create` / `announcement.update` / `announcement.delete` / `announcement.batch_delete`. Each handler calls `writeAdminLog` after the underlying mutation commits. Failure-path audit is intentionally out of scope.
- F4 (UI): `/admin/logs/operations` read-only page + `AdminLogDetailDialog`. No mutations, no batch bar. Lives under the **日志** nav group.

**Not yet covered (follow-ups):**
- Attachment mutations (`attachment.delete` / `attachment.batch_delete`) — R2 + DB side-effects need their own action shape; tracked as F3-d.
- Generic `user.update`, role/status batch flips, statistics recalc — maintenance-class mutations not part of the F batch.
- No `/admin/logs/audit` event-stream page is planned — operation logs cover the audit need today.

See [`docs/14a-audit-logs.md`](./14a-audit-logs.md) for schema, action matrix, redaction rules, and test gates.

---

## Planned Features (TODO)

### 8. Staff Management 📋 Planned

| Page | Path | Priority | Features |
|------|------|----------|----------|
| **Staff** | `/admin/staff` | Medium | Assign/revoke admin/supermod/mod roles, per-forum moderator assignment |

**Implementation Plan:**
1. Create staff management UI showing all users with role > 0
2. Add role assignment dialog
3. Add forum moderator assignment UI (edits `forums.moderators` / `moderator_ids` fields)
4. L1 tests: role validation, permission boundary tests
5. L2 tests: role change and access verification

**Note:** Per-forum moderator assignment uses existing `forums.moderators` (usernames) and `forums.moderator_ids` fields, NOT a separate junction table.

### 9. Announcements 📋 Planned

| Page | Path | Priority | Features |
|------|------|----------|----------|
| **Announcements** | `/admin/announcements` | Low | Create/edit/delete announcements, schedule, target forums, display priority |

**Implementation Plan:**
1. Add `announcements` table: `id`, `title`, `content`, `forum_ids` (JSON), `sticky`, `start_at`, `end_at`, `status`, `created_at`
2. Create Worker handlers for CRUD
3. Build admin UI with rich text editor, forum selector, date picker
4. Add frontend announcement display component
5. L1 tests: announcement CRUD handlers
6. L2 tests: announcement visibility by forum and time

---

## Shared Components

| Component | Purpose |
|-----------|---------|
| `AdminDataTable` | Generic data table with selection, sorting, loading states |
| `AdminFilters` | Filter bar with search input, select dropdowns |
| `AdminPagination` | Pagination controls |
| `AdminBatchBar` | Floating batch action toolbar |
| `AdminConfirmDialog` | Confirmation dialog for dangerous actions (supports required text input) |
| `StatCard` | Dashboard statistics card |

---

## Quality Assurance

### Test Status

| Level | Scope | Status | Notes |
|-------|-------|--------|-------|
| L1 Unit | Handler logic, viewmodel functions | ✅ Passing | ~900 tests in `apps/worker/tests/` and `tests/unit/` |
| L2 Integration | API route → Worker → D1 | ✅ Rewritten | `tests/integration/worker/admin.test.ts` updated to match actual endpoints |
| L3 E2E | Full admin workflows | ✅ Partial / Active | Playwright `admin` project covers auth, forums, threads, users, reports, and operation logs. Run via `bun run test:e2e:admin` (boots admin app on :7032 with `NODE_ENV=test` + `.env.test`). Direct `bunx playwright …` requires the same env loaded manually. |

**Known Issues:**
- Admin L3 specs require `.env.test` + a `-test` Worker URL via the `bun run test:e2e:admin` runner; running raw `bunx playwright …` without that setup will fail in `loginAsAdmin`.
- Attachment delete audit is still a follow-up (F3-d); attachment mutations do not yet write to `admin_logs`.

### Test Improvement Plan

1. **L2 tests rewritten** ✅ to match actual API endpoints:
   - `GET /api/admin/users` ✅
   - `GET /api/admin/threads` ✅ (not `/content`)
   - `PATCH /api/admin/users/:id` ✅
   - `POST /api/admin/users/:id/ban` ✅
   - `GET /api/admin/stats` ✅
   - `GET /api/admin/forums` ✅
   - `GET /api/admin/attachments` ✅
   - `GET /api/admin/ip-bans` ✅
   - `GET /api/admin/censor-words` ✅
   - `GET /api/admin/settings` ✅

2. **Add L3 E2E tests** for critical workflows:
   - Admin login flow
   - User ban workflow
   - Forum management

### Commit Guidelines
- Each feature as atomic commit
- Prefix: `feat(admin):`, `fix(admin):`, `refactor(admin):`
- Include test updates in same commit
- Run `bun run test` before commit

---

## Security Considerations

1. **Access Control**: 
   - Admin status via `ADMIN_EMAILS` environment variable (Next.js side)
   - Layout-level redirect for non-admins
   - API route session validation before proxying to Worker
   - Worker trusts Key B unconditionally (no identity check)

2. **CSRF Protection**: NextAuth handles session tokens

3. **Input Validation**: All inputs validated at Worker level

4. **Audit Trail**: Implemented under the F batch (see §7 + [`docs/14a-audit-logs.md`](./14a-audit-logs.md)). Mutations in the covered families (user ban/nuke, report resolve/dismiss, thread/post content edits & deletes, forum/setting/ip_ban/censor_word/announcement CRUD) are recorded best-effort to `admin_logs`; sensitive keys are redacted by `sanitizeAdminLogDetails`. Attachment delete audit (F3-d) and maintenance-class mutations (statistics recalc, role/status batches, generic `user.update`) are not covered yet.

5. **Dangerous Actions**: Always require confirmation dialogs
