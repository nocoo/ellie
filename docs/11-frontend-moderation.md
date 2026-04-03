# 11. Frontend Moderation (User-Facing Management)

> This document describes the frontend moderation features for Ellie forum - management capabilities available to moderators, super moderators, and regular users within the forum interface.

## Overview

Frontend moderation provides in-context management capabilities directly within the forum UI, without requiring access to the admin console.

**Role Hierarchy:**
| Role | Code | Scope | Capabilities |
|------|------|-------|--------------|
| Admin | 1 | Global | All operations, can manage users |
| Super Moderator | 2 | Global | All forum operations, can manage users |
| Moderator | 3 | Assigned Forums | Thread/post operations within scope |
| User | 0 | Own Content | Edit/delete own posts (within time limit) |

**⚠️ IMPORTANT - Current Implementation Gap:**

The permission matrix above is the **intended design** per `@ellie/types/permission.ts`. However, the Worker implementation (`moderationMiddleware`) only checks "is role > 0" and does NOT enforce:
- Forum scope for moderators (Mod can currently operate on any forum)
- Action-level restrictions per the shared permission functions

This means a Moderator can currently bypass the permission model defined in `@ellie/types`. **Backend must be updated to call the shared permission functions.**

**Key Principles:**
- Management actions appear in-context (not separate pages)
- Clear visual separation: user actions (left), mod actions (right)
- All destructive actions require confirmation dialog
- User deletion cascades to all their content
- Atomic commits for each feature

---

## API Reference

### Actual Endpoints (Current Implementation)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/moderation/threads/:id/sticky` | PATCH | Set sticky level: `{ level: "none" \| "forum" \| "global" }` |
| `/api/v1/moderation/threads/:id/digest` | PATCH | Set digest level: `{ level: 0-3 }` |
| `/api/v1/moderation/threads/:id/close` | PATCH | Lock/unlock: `{ closed: boolean }` |
| `/api/v1/moderation/threads/:id/move` | PATCH | Move thread: `{ targetForumId: number }` |
| `/api/v1/moderation/threads/:id/highlight` | PATCH | Set highlight: `{ color, bold, italic, underline }` |
| `/api/v1/moderation/threads/:id` | DELETE | Delete thread and all posts |
| `/api/v1/moderation/posts/:id` | DELETE | Delete post (non-first only) |
| `/api/v1/moderation/posts/:id` | PATCH | Edit post content: `{ content: string }` |

### User Self-Service Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/me/posts/:id` | DELETE | Delete own post |
| `/api/v1/me/posts/:id` | PATCH | Edit own post |
| `/api/v1/me/threads/:id` | DELETE | Delete own thread |

### Sticky Levels

| Level | Value | Description |
|-------|-------|-------------|
| `none` | 0 | No sticky |
| `forum` | 1 | Sticky within forum |
| `global` | 2 | Global sticky (all forums) |

**Note:** "category" sticky mentioned in some old docs does NOT exist in implementation.

---

## Module Status

### 1. Thread Management

#### 1.1 Thread Moderation Menu ✅ Complete (needs UI relocation)

**Current Location:** Bottom of first post, in a separate "管理操作" bar  
**Component:** `ThreadModMenu` in `components/forum/thread-mod-menu.tsx`

| Feature | Status | API Endpoint |
|---------|--------|--------------|
| Sticky | ✅ | `PATCH /threads/:id/sticky` |
| Highlight | ✅ | `PATCH /threads/:id/highlight` |
| Digest | ✅ | `PATCH /threads/:id/digest` |
| Lock/Unlock | ✅ | `PATCH /threads/:id/close` |
| Move | ✅ | `PATCH /threads/:id/move` |
| Delete | ✅ | `DELETE /threads/:id` |

**UI Relocation Consideration:**

Current page structure places views/replies in the first post sidebar (not thread header). The thread header only shows:
- Badges (sticky, digest, locked)
- Title
- Forum link, author, timestamp

Options for mod menu placement:
1. **Keep current location** (first post footer) - consistent with "management actions near content"
2. **Add to thread header right side** - but header is already minimal
3. **Create expandable management section** - collapsible panel below header

Decision needed based on overall UX direction.

---

### 2. Post Management

#### 2.1 Post Action Bar ✅ Complete (layout adjustment optional)

**Current Location:** Bottom of each post  
**Component:** `PostActionBar` in `components/forum/post-action-bar.tsx`

| Feature | Status | Who Can Use |
|---------|--------|-------------|
| Reply | ✅ | All logged-in users |
| Edit | ✅ | Author (within limit) or Mod+ |
| Delete | ✅ | Author (non-first, within limit) or Mod+ |

**Current Layout:**
```
┌─────────────────────────────────────────────────┐
│ [Reply] [Edit] [Delete]                         │  ← All left-aligned
└─────────────────────────────────────────────────┘
```

**Optional Enhancement - Left/Right Separation:**
```
┌─────────────────────────────────────────────────┐
│ [Reply]                    [Edit] [Delete]      │
│   ↑                              ↑              │
│ User actions               Mod/Author actions   │
└─────────────────────────────────────────────────┘
```

This is a UI refinement, not blocking functionality.

---

### 3. User Management 📋 Planned

User management by moderators/admins needs two entry points:

#### 3.1 User Popover ⚠️ Partial (needs mod actions)

**Current State:** Shows user info, admin-only section visible, "管理" button exists but non-functional  
**Component:** `UserPopover` in `components/forum/user-popover.tsx`

| Feature | Status | Description |
|---------|--------|-------------|
| View profile | ✅ | Link to user page |
| Send message | ✅ | Link to PM compose |
| Admin info section | ✅ | Shows QQ/site for admins |
| **Mod actions button** | 📋 TODO | Dropdown with ban/warn actions |

**TODO - Mod Actions Dropdown:**
```tsx
<DropdownMenu>
  <DropdownMenuTrigger>
    <Button variant="ghost" size="xs">
      <Shield /> 管理
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuItem>查看 IP 记录</DropdownMenuItem>
    <DropdownMenuItem>禁止发言</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive">封禁用户</DropdownMenuItem>
    <DropdownMenuItem variant="destructive">封禁并删除内容</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

#### 3.2 User Profile Page 📋 Planned

**Path:** `/users/[id]`  
**Current State:** Shows user profile, edit capability for own profile

| Feature | Status | Description |
|---------|--------|-------------|
| Profile display | ✅ | User info, stats, recent activity |
| Edit own profile | ✅ | Update bio, avatar, etc. |
| **Mod action bar** | 📋 TODO | Management toolbar for admins/supermods |

---

### 4. User Moderation Actions Detail 📋 Planned

All user moderation actions require **confirmation dialog** before API call.

#### 4.1 View IP Records

| Item | Detail |
|------|--------|
| Entry | User popover, User profile page |
| Who can use | Admin, Super Moderator |
| Action | Show modal with IP history |
| API needed | `GET /api/v1/moderation/users/:id/ip-records` |

#### 4.2 Mute User (禁止发言)

| Item | Detail |
|------|--------|
| Entry | User popover, User profile page |
| Who can use | Admin, Super Moderator |
| Action | Set user status to muted (can view, cannot post) |
| Confirmation | "确定禁止 {username} 发言？禁言后该用户将无法发帖和回复。" |
| Duration | Permanent or timed (1d, 7d, 30d, custom) |
| API needed | `POST /api/v1/moderation/users/:id/mute` |

#### 4.3 Ban User (封禁用户)

| Item | Detail |
|------|--------|
| Entry | User popover, User profile page |
| Who can use | Admin, Super Moderator |
| Action | Set user status to banned (cannot access forum) |
| Confirmation | "确定封禁 {username}？封禁后该用户将无法访问论坛。" |
| API needed | `POST /api/v1/moderation/users/:id/ban` |

#### 4.4 Ban and Delete Content (封禁并删除内容)

| Item | Detail |
|------|--------|
| Entry | User popover, User profile page |
| Who can use | Admin, Super Moderator |
| Action | Ban user + delete all their posts and threads |
| Confirmation | "确定封禁 {username} 并删除其所有内容？此操作不可撤销。" |
| API needed | `POST /api/v1/moderation/users/:id/nuke` |

**IMPORTANT: Deletion Cascade Order:**
1. Delete all posts by user (update thread reply counts)
2. Delete all threads by user (update forum thread counts)
3. Delete all attachments by user
4. Update affected forum statistics
5. Ban user account

---

## Backend Permission Enforcement ✅ Complete

### Previous State (Problem - RESOLVED)

The `moderationMiddleware` only checked "is role > 0", allowing ANY mod to operate on ANY forum without scope enforcement.

### Solution Implemented

All moderation handlers now use the shared permission functions from `@ellie/types/permission.ts`:

| Handler | Permission Function | Notes |
|---------|-------------------|-------|
| `setSticky` | `canModerate()` | Requires forum scope for Mods |
| `setDigest` | `canModerate()` | Requires forum scope for Mods |
| `setClose` | `canModerate()` | Requires forum scope for Mods |
| `setHighlight` | `canModerate()` | Requires forum scope for Mods |
| `moveThread` | `canMoveThread()` | Admin/SuperMod only |
| `deleteThread` | `canDeleteThread()` | Author OR Admin/SuperMod |
| `deletePost` | `canDeletePost()` | Author OR Admin/SuperMod |
| `editPost` | `canEditPost()` | Author OR Mod in scope |

### Helper Functions

`apps/worker/src/lib/permissionHelpers.ts` provides:
- `getUserForPermission()` - fetches minimal user data for permission checks
- `getForumForPermission()` - fetches forum with moderators field
- `getThreadForPermission()` - fetches thread with forum_id
- `getPostForPermission()` - fetches post with author_id, forum_id

### Existing Data Model (forums.moderators)

The forum moderator assignment uses existing schema fields:

```sql
-- packages/db/src/schema.ts
moderators TEXT NOT NULL DEFAULT '',      -- comma-separated usernames
moderator_ids TEXT NOT NULL DEFAULT '',   -- comma-separated user IDs
```

The shared permission functions use this:

```typescript
// packages/types/src/permission.ts
export function canModerate(user: PermissionUser | null, forum: PermissionForum): boolean {
  if (!user) return false;
  if (user.role === UserRole.Admin || user.role === UserRole.SuperMod) return true;
  if (user.role === UserRole.Mod) {
    const mods = parseModerators(forum.moderators);
    return mods.includes(user.username);
  }
  return false;
}
```

---

## Implementation Roadmap

### Phase 1: Backend Permission Enforcement ✅ Complete

| Task | Status | Notes |
|------|--------|-------|
| Update Worker handlers to import `@ellie/types` permission functions | ✅ Done | All handlers now use permission functions |
| Add forum data fetch in moderation handlers | ✅ Done | `permissionHelpers.ts` provides helpers |
| Add user data fetch in moderation handlers | ✅ Done | `getUserForPermission()`, `getForumForPermission()` |
| L1 tests: permission boundary tests | ✅ Done | Tests cover Mod scope restrictions |

**Commit:** `feat(mod): enforce permission checks in moderation handlers`

**Implementation Details:**
- Created `apps/worker/src/lib/permissionHelpers.ts` with helper functions
- Updated all handlers in `moderation.ts` to use `canModerate`, `canMoveThread`, `canDeletePost`, `canDeleteThread`, `canEditPost`
- Updated `@ellie/types/permission.ts` to use `PermissionUser`/`PermissionForum` partial types for efficiency
- Tests updated with permission mocks including scope boundary tests

### Phase 2: User Moderation (Medium Priority)

| Task | Status |
|------|--------|
| Create mute/ban/nuke APIs | ✅ Done |
| Implement user popover mod dropdown | ✅ Done |
| Create user ban confirmation dialogs | ✅ Done |
| Add profile page mod panel | ✅ Done |
| Implement IP record viewer page | 📋 TODO |

**Phase 2.1 Commit:** `feat(mod): add user moderation APIs (mute/ban/nuke)`

**API Endpoints Implemented:**
- `GET /api/v1/moderation/users/:id/status` - Get user status (Admin/SuperMod only)
- `GET /api/v1/moderation/users/:id/ip-records` - View IP history (Admin/SuperMod only)
- `POST /api/v1/moderation/users/:id/mute` - Mute user (Admin/SuperMod only)
- `POST /api/v1/moderation/users/:id/unmute` - Unmute user (Admin/SuperMod only)
- `POST /api/v1/moderation/users/:id/ban` - Ban user (Admin/SuperMod only)
- `POST /api/v1/moderation/users/:id/unban` - Unban user (Admin/SuperMod only)
- `POST /api/v1/moderation/users/:id/nuke` - Ban + delete all content (Admin/SuperMod only)

**Phase 2.2 Commit:** `feat(mod): implement UserPopover mod actions dropdown`

**Frontend Features Implemented:**
- UserPopover mod dropdown with mute/unmute, ban/unban, nuke actions
- User status badges (banned/muted) in popover
- Confirmation dialogs for all destructive actions
- Next.js proxy routes for all moderation endpoints

**Phase 2.3 Commit:** `feat(mod): add mod panel to user profile page`

**Shared Component:**
- `UserModActions` component in `components/forum/user-mod-actions.tsx`
- Used by both UserPopover and ProfileHero
- Includes dropdown menu, confirmation dialogs, and status badge

### Phase 3: UI Polish (Low Priority)

| Task | Status |
|------|--------|
| Post action bar left/right separation | ✅ Done |
| Evaluate thread mod menu placement | 📋 Optional |

**Phase 3 Commit:** `refactor(mod): PostActionBar left/right layout separation`

**Layout Change:**
```
┌─────────────────────────────────────────────────┐
│ [Reply]                    [Edit] [Delete]      │
│   ↑                              ↑              │
│ User actions               Mod/Author actions   │
└─────────────────────────────────────────────────┘
```

---

## Permission Matrix (Per @ellie/types)

This is the **authoritative** permission model defined in `packages/types/src/permission.ts`:

| Action | Admin | SuperMod | Mod (in scope) | Mod (out of scope) | User |
|--------|-------|----------|----------------|-------------------|------|
| Sticky thread | ✅ | ✅ | ✅ | ❌ | ❌ |
| Highlight thread | ✅ | ✅ | ✅ | ❌ | ❌ |
| Digest thread | ✅ | ✅ | ✅ | ❌ | ❌ |
| Lock thread | ✅ | ✅ | ✅ | ❌ | ❌ |
| Move thread | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete thread | ✅ | ✅ | ❌ | ❌ | Own* |
| Edit any post | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete any post | ✅ | ✅ | ❌ | ❌ | ❌ |
| Edit own post | ✅ | ✅ | ✅ | ✅ | ✅* |
| Delete own post | ✅ | ✅ | ✅ | ✅ | ✅* |
| View user IP | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mute user | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ban user | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ban + delete | ✅ | ✅ | ❌ | ❌ | ❌ |

\* Within time limit, if not locked

**Key constraint from permission.ts:**
- `canDeletePost`: Author OR Admin/SuperMod only — **Mod CANNOT delete others' posts**
- `canDeleteThread`: Author OR Admin/SuperMod only — **Mod CANNOT delete others' threads**
- `canMoveThread`: Admin/SuperMod only — **Mod CANNOT move threads**

---

## Quality Assurance

### Test Status

| Level | Scope | Status | Notes |
|-------|-------|--------|-------|
| L1 Unit | Permission checks, UI rendering | ✅ Passing | 872 worker tests, permission boundary tests added |
| L2 Integration | Moderation API flows | ⚠️ Stale | `tests/integration/moderation.test.ts` tests `POST /api/v1/moderation` which doesn't exist |
| L3 E2E | Full moderation workflows | ❌ Not implemented | |

**Known Issues:**
- `tests/integration/moderation.test.ts` tests a non-existent endpoint:
  - Tests `POST /api/v1/moderation` with `{ action: "sticky", threadId }` body
  - Actual API is `PATCH /api/v1/moderation/threads/:id/sticky` with `{ level }` body
- Tests need complete rewrite

### Test Improvement Plan

1. **Rewrite L2 tests** to match actual API:
   ```typescript
   // Example corrected test
   test("PATCH /api/v1/moderation/threads/:id/sticky", async () => {
     const res = await fetch(`${BASE}/api/v1/moderation/threads/1/sticky`, {
       method: "PATCH",
       headers: { Authorization: `Bearer ${modToken}` },
       body: JSON.stringify({ level: "forum" }),
     });
     expect(res.status).toBe(200);
   });
   ```

2. **Add permission boundary tests:**
   - Mod cannot move threads
   - Mod cannot operate outside assigned forums (after backend fix)
   - User cannot access mod endpoints

### Commit Guidelines
- Each feature as atomic commit
- Prefix: `feat(mod):`, `fix(mod):`, `refactor(mod):`
- Include permission edge cases in tests
- Run `bun run test` before commit

---

## UI/UX Guidelines

1. **Placement Consistency:**
   - Thread management: first post footer (current) or header (optional relocation)
   - Post actions: post footer
   - User management: popover and profile page

2. **Visual Distinction:**
   - User actions: regular text color
   - Mod actions: grouped, with separator or distinct styling
   - Destructive actions: red color, require confirmation

3. **Confirmation Dialogs:**
   - All destructive actions must show confirmation
   - Show what will happen clearly
   - For user deletion: require typing username to confirm

4. **Loading States:**
   - Show loading spinner during API calls
   - Disable action buttons while processing
   - Show success/error feedback
