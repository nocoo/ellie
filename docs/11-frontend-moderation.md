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

The permission matrix above is the **intended design**. However, the current Worker implementation (`moderationMiddleware`) only checks "is role > 0" and does NOT enforce:
- Forum scope for moderators (Mod can currently operate on any forum)
- Action-level restrictions (e.g., move should be SuperMod+ only)

This means a Moderator can currently perform actions outside their assigned forums. **Backend permission refinement is needed.**

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

## Backend Permission Refinement Needed

### Current State (Problem)

`apps/worker/src/middleware/auth.ts`:
```typescript
// Mod (3), SuperMod (2), Admin (1) can perform moderation actions
if (user.role === UserRole.User) {
  return errorResponse("FORBIDDEN_MOD_ONLY", 403);
}
```

This allows ANY non-User role to perform ANY moderation action.

### Required Changes

1. **Add forum scope check for Moderators:**
   - Need `forum_moderators` junction table: `user_id`, `forum_id`
   - Thread operations must validate `thread.forum_id` is in moderator's scope
   - SuperMod/Admin bypass scope check

2. **Add action-level permissions:**
   - `moveThread`: SuperMod+ only
   - User management: Admin/SuperMod only
   - Thread management: Mod+ (within scope)

3. **Implementation approach:**
   ```typescript
   // Per-handler permission check
   async function checkThreadPermission(env, userId, role, threadId, action) {
     if (role === UserRole.Admin || role === UserRole.SuperMod) {
       return true; // Full access
     }
     if (role === UserRole.Mod) {
       // Check if thread's forum is in mod's assigned forums
       const thread = await getThread(env, threadId);
       const isMod = await isForumModerator(env, userId, thread.forum_id);
       if (!isMod) return false;
       // Check action-level permission
       if (action === 'move') return false; // Mods can't move
       return true;
     }
     return false;
   }
   ```

---

## Implementation Roadmap

### Phase 1: Backend Permission Fix (High Priority)

| Task | Status |
|------|--------|
| Add `forum_moderators` table | 📋 TODO |
| Create per-action permission checks | 📋 TODO |
| Update moderation handlers to use checks | 📋 TODO |
| L1 tests: permission boundary tests | 📋 TODO |

### Phase 2: User Moderation (Medium Priority)

| Task | Status |
|------|--------|
| Implement user popover mod dropdown | 📋 TODO |
| Add profile page mod panel | 📋 TODO |
| Create user ban confirmation dialogs | 📋 TODO |
| Implement IP record viewer | 📋 TODO |
| Create mute/ban/nuke APIs | 📋 TODO |

### Phase 3: UI Polish (Low Priority)

| Task | Status |
|------|--------|
| Post action bar left/right separation | 📋 Optional |
| Evaluate thread mod menu placement | 📋 Optional |

---

## Permission Matrix (Target State)

| Action | Admin | SuperMod | Mod (in scope) | Mod (out of scope) | User |
|--------|-------|----------|----------------|-------------------|------|
| Sticky thread | ✅ | ✅ | ✅ | ❌ | ❌ |
| Highlight thread | ✅ | ✅ | ✅ | ❌ | ❌ |
| Digest thread | ✅ | ✅ | ✅ | ❌ | ❌ |
| Lock thread | ✅ | ✅ | ✅ | ❌ | ❌ |
| Move thread | ✅ | ✅ | ❌ | ❌ | ❌ |
| Delete thread | ✅ | ✅ | ✅ | ❌ | Own* |
| Edit any post | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete any post | ✅ | ✅ | ✅ | ❌ | ❌ |
| Edit own post | ✅ | ✅ | ✅ | ✅ | ✅* |
| Delete own post | ✅ | ✅ | ✅ | ✅ | ✅* |
| View user IP | ✅ | ✅ | ❌ | ❌ | ❌ |
| Mute user | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ban user | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ban + delete | ✅ | ✅ | ❌ | ❌ | ❌ |

\* Within time limit, if not locked

---

## Quality Assurance

### Test Status

| Level | Scope | Status | Notes |
|-------|-------|--------|-------|
| L1 Unit | Permission checks, UI rendering | ⚠️ Partial | Need permission boundary tests |
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
