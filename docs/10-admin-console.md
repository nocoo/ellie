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

---

## Planned Features (TODO)

### 6. Reports Management 📋 Planned

| Page | Path | Priority | Features |
|------|------|----------|----------|
| **Reports** | `/admin/reports` | High | List user reports for threads/posts/users, review status, resolve/dismiss, batch operations |

**Implementation Plan:**
1. Add `reports` table: `id`, `type`, `target_id`, `reporter_id`, `reason`, `status`, `handler_id`, `handled_at`, `created_at`
2. Create Worker handlers: `GET/POST /admin/reports`, `PATCH /admin/reports/:id`
3. Create Next.js proxy routes
4. Build admin UI page with filters (status/type), action buttons (resolve/dismiss/ban user)
5. L1 tests: unit tests for handlers and viewmodel
6. L2 tests: integration tests for report lifecycle

### 7. Audit Logs 📋 Planned

| Page | Path | Priority | Features |
|------|------|----------|----------|
| **Operation Logs** | `/admin/logs/operations` | Medium | Admin action history, filterable by admin/action type/target |
| **Audit Logs** | `/admin/logs/audit` | Medium | Content changes, user status changes, security events |

**Implementation Plan:**
1. Add `admin_logs` table: `id`, `admin_id`, `action`, `target_type`, `target_id`, `details` (JSON), `ip`, `created_at`
2. Add logging middleware to all admin mutation endpoints
3. Create Worker handlers for log retrieval with pagination
4. Build admin UI with advanced filters and export capability
5. L1 tests: logging middleware unit tests
6. L2 tests: verify logs created for each admin action

### 8. Staff Management 📋 Planned

| Page | Path | Priority | Features |
|------|------|----------|----------|
| **Staff** | `/admin/staff` | Medium | Assign/revoke admin/supermod/mod roles, per-forum moderator assignment |

**Implementation Plan:**
1. Create staff management UI showing all users with role > 0
2. Add role assignment dialog with forum scope for moderators
3. Integrate with existing `users` table role field
4. Add `forum_moderators` junction table for per-forum mod assignment
5. L1 tests: role validation, permission boundary tests
6. L2 tests: role change and access verification

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
| L1 Unit | Handler logic, viewmodel functions | ✅ Passing | ~800 tests in `apps/worker/tests/` and `tests/unit/` |
| L2 Integration | API route → Worker → D1 | ⚠️ Stale | `tests/integration/admin.test.ts` tests non-existent endpoints (e.g., `GET /api/admin/content`) |
| L3 E2E | Full admin workflows | ❌ Not implemented | Needs Playwright scenarios |

**Known Issues:**
- `tests/integration/admin.test.ts` references deprecated API structure:
  - Tests `GET /api/admin/content` (doesn't exist, should be `GET /api/admin/threads`)
  - Tests `POST /api/admin/users` with `{ action: "ban" }` (actual API uses `POST /api/admin/users/:id/ban`)
- These tests need to be rewritten to match current API

### Test Improvement Plan

1. **Rewrite L2 tests** to match actual API endpoints:
   - `GET /api/admin/users` ✓ (exists)
   - `GET /api/admin/threads` (not `/content`)
   - `PATCH /api/admin/users/:id`
   - `POST /api/admin/users/:id/ban`
   - `POST /api/admin/users/:id/nuke`

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

4. **Audit Trail**: Planned for future implementation (see §7)

5. **Dangerous Actions**: Always require confirmation dialogs
