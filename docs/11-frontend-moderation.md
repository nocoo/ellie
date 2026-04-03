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

**Key Principles:**
- Management actions appear in-context (not separate pages)
- Clear visual separation: user actions (left), mod actions (right)
- All destructive actions require confirmation dialog
- User deletion cascades to all their content
- Atomic commits for each feature

---

## Module Status

### 1. Thread Management

#### 1.1 Thread Moderation Menu ✅ Complete (needs UI relocation)

**Current Location:** Bottom of first post, in a separate "管理操作" bar
**Target Location:** Thread title row, right side (next to view/reply counts)

| Feature | Status | Description |
|---------|--------|-------------|
| Sticky | ✅ | Set sticky level (none/forum/global/category) via dialog |
| Highlight | ✅ | Set title color/bold via dialog |
| Digest | ✅ | Set digest level (0-3) via dialog |
| Lock/Unlock | ✅ | Toggle thread closed status |
| Move | ✅ | Move to another forum (SuperMod/Admin only) |
| Delete | ✅ | Delete thread and all posts |

**Component:** `ThreadModMenu` in `components/forum/thread-mod-menu.tsx`

**TODO - UI Relocation:**
```
Current Layout:
┌─────────────────────────────────────────────────┐
│ [Thread Title]                                  │
├─────────────────────────────────────────────────┤
│ [Post Content...]                               │
├─────────────────────────────────────────────────┤
│ [Reply] [Edit]                                  │
├─────────────────────────────────────────────────┤
│ 管理操作: [管理 ▼]  ← CURRENT LOCATION         │
└─────────────────────────────────────────────────┘

Target Layout:
┌─────────────────────────────────────────────────┐
│ [Thread Title]              [👁 123] [管理 ▼]   │  ← NEW LOCATION
├─────────────────────────────────────────────────┤
│ [Post Content...]                               │
├─────────────────────────────────────────────────┤
│ [Reply] [Edit]                                  │
└─────────────────────────────────────────────────┘
```

**Implementation Plan:**
1. Move `ThreadModMenu` from `PostCard` action bar to thread header component
2. Update `ThreadHeader` or create `ThreadTitleRow` component
3. Position management button at far right of title row
4. Remove the separate "管理操作" section from first post
5. L1 tests: component render with various permission combinations
6. L2 tests: moderation API integration

---

### 2. Post Management

#### 2.1 Post Action Bar ✅ Complete (needs layout adjustment)

**Current Location:** Bottom left of each post
**Target Layout:** User actions (left) | Mod actions (right) in same row

| Feature | Status | Description |
|---------|--------|-------------|
| Reply | ✅ | Quote reply to post |
| Edit | ✅ | Edit post content (author or mod) |
| Delete | ✅ | Delete post (non-first posts only) |

**Component:** `PostActionBar` in `components/forum/post-action-bar.tsx`

**TODO - Add Moderator Actions (Right Side):**
```
Current Layout:
┌─────────────────────────────────────────────────┐
│ [Reply] [Edit] [Delete]                         │  ← All left-aligned
└─────────────────────────────────────────────────┘

Target Layout:
┌─────────────────────────────────────────────────┐
│ [Reply]                    [Edit] [Delete] [⚙]  │
│   ↑                              ↑              │
│ User actions               Mod actions (right)  │
└─────────────────────────────────────────────────┘
```

**Implementation Plan:**
1. Refactor `PostActionBar` to have left/right sections
2. Left section: Reply (for all users)
3. Right section: Edit, Delete (for authorized users)
4. Add moderator dropdown menu `[⚙]` for future mod-only actions
5. Ensure visual separation between user and mod actions
6. L1 tests: permission-based rendering
7. L2 tests: edit/delete API integration

---

### 3. User Management 📋 Planned

User management by moderators/admins needs two entry points:

#### 3.1 User Popover ⚠️ Partial (needs mod actions)

**Current State:** Shows user info, admin-only section visible, "管理" button exists but non-functional

| Feature | Status | Description |
|---------|--------|-------------|
| View profile | ✅ | Link to user page |
| Send message | ✅ | Link to PM compose |
| Admin info section | ✅ | Shows QQ/site for admins |
| **Mod actions button** | 📋 TODO | Dropdown with ban/warn actions |

**Component:** `UserPopover` in `components/forum/user-popover.tsx`

**TODO - Mod Actions Dropdown:**
```tsx
// Target implementation for mod actions
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

**TODO - Profile Mod Actions:**
```
Target Layout (for admins/supermods viewing other users):
┌─────────────────────────────────────────────────┐
│ [User Avatar] [Username]                        │
│ [Stats...]                                      │
├─────────────────────────────────────────────────┤
│ ⚠️ 管理面板 (Admin/SuperMod only)               │
│ ┌─────────────────────────────────────────────┐ │
│ │ IP 记录: 192.168.1.1 (last), 共 5 个        │ │
│ │ 最后活动: 2026-04-03 12:00                  │ │
│ │ [禁止发言] [封禁用户] [封禁并删除内容]        │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

### 4. User Moderation Actions Detail 📋 Planned

All user moderation actions require **confirmation dialog** before API call.

#### 4.1 View IP Records

| Item | Detail |
|------|--------|
| Entry | User popover, User profile page |
| Who can use | Admin, Super Moderator |
| Action | Show modal with IP history |
| Data | IP address, timestamp, action type |

#### 4.2 Mute User (禁止发言)

| Item | Detail |
|------|--------|
| Entry | User popover, User profile page |
| Who can use | Admin, Super Moderator |
| Action | Set user status to muted (can view, cannot post) |
| Confirmation | "确定禁止 {username} 发言？禁言后该用户将无法发帖和回复。" |
| Duration | Permanent or timed (1d, 7d, 30d, custom) |

#### 4.3 Ban User (封禁用户)

| Item | Detail |
|------|--------|
| Entry | User popover, User profile page |
| Who can use | Admin, Super Moderator |
| Action | Set user status to banned (cannot access forum) |
| Confirmation | "确定封禁 {username}？封禁后该用户将无法访问论坛。" |

#### 4.4 Ban and Delete Content (封禁并删除内容)

| Item | Detail |
|------|--------|
| Entry | User popover, User profile page |
| Who can use | Admin, Super Moderator |
| Action | Ban user + delete all their posts and threads |
| Confirmation | "确定封禁 {username} 并删除其所有内容？此操作不可撤销。" |
| Cascade | Delete all posts → Delete all threads (where author) → Update forum/thread counters |

**IMPORTANT: Deletion Cascade Order:**
1. Delete all posts by user (update thread reply counts)
2. Delete all threads by user (update forum thread counts)
3. Delete all attachments by user
4. Update affected forum statistics
5. Ban user account

---

## Implementation Roadmap

### Phase 1: UI Relocation (High Priority)

| Task | Component | Status |
|------|-----------|--------|
| Move thread mod menu to title row | `ThreadModMenu`, thread header | 📋 TODO |
| Adjust post action bar layout | `PostActionBar` | 📋 TODO |
| Add right-side mod actions | `PostActionBar` | 📋 TODO |

### Phase 2: User Moderation (Medium Priority)

| Task | Component | Status |
|------|-----------|--------|
| Implement user popover mod dropdown | `UserPopover` | 📋 TODO |
| Add profile page mod panel | `/users/[id]` | 📋 TODO |
| Create user ban confirmation dialogs | New component | 📋 TODO |
| Implement IP record viewer | New component | 📋 TODO |

### Phase 3: Backend Support (Medium Priority)

| Task | Layer | Status |
|------|-------|--------|
| User mute API | Worker | 📋 TODO |
| User ban with content delete API | Worker | 📋 TODO |
| IP record query API | Worker | 📋 TODO |
| Cascade deletion logic | Worker | 📋 TODO |

---

## API Endpoints Needed

### Existing (Reusable)
- `PATCH /api/v1/moderation/threads/:id/sticky` ✅
- `PATCH /api/v1/moderation/threads/:id/digest` ✅
- `PATCH /api/v1/moderation/threads/:id/highlight` ✅
- `PATCH /api/v1/moderation/threads/:id/closed` ✅
- `POST /api/v1/moderation/threads/:id/move` ✅
- `DELETE /api/v1/moderation/threads/:id` ✅
- `DELETE /api/v1/moderation/posts/:id` ✅

### New (To Implement)
- `GET /api/v1/moderation/users/:id/ip-records` - View user IP history
- `POST /api/v1/moderation/users/:id/mute` - Mute user (with duration)
- `POST /api/v1/moderation/users/:id/unmute` - Unmute user
- `POST /api/v1/moderation/users/:id/ban` - Ban user
- `POST /api/v1/moderation/users/:id/unban` - Unban user
- `POST /api/v1/moderation/users/:id/nuke` - Ban + delete all content

---

## Permission Matrix

| Action | Admin | SuperMod | Mod | User |
|--------|-------|----------|-----|------|
| Sticky thread | ✅ | ✅ | ✅* | ❌ |
| Highlight thread | ✅ | ✅ | ✅* | ❌ |
| Digest thread | ✅ | ✅ | ✅* | ❌ |
| Lock thread | ✅ | ✅ | ✅* | ❌ |
| Move thread | ✅ | ✅ | ❌ | ❌ |
| Delete thread | ✅ | ✅ | ✅* | Own** |
| Edit any post | ✅ | ✅ | ✅* | ❌ |
| Delete any post | ✅ | ✅ | ✅* | ❌ |
| Edit own post | ✅ | ✅ | ✅ | ✅*** |
| Delete own post | ✅ | ✅ | ✅ | ✅*** |
| View user IP | ✅ | ✅ | ❌ | ❌ |
| Mute user | ✅ | ✅ | ❌ | ❌ |
| Ban user | ✅ | ✅ | ❌ | ❌ |
| Ban + delete | ✅ | ✅ | ❌ | ❌ |

\* Within assigned forums only  
\** Within time limit, if not locked  
\*** Within time limit  

---

## Quality Assurance

### Test Strategy
| Level | Scope | Tests |
|-------|-------|-------|
| L1 Unit | Permission checks, UI rendering | Component tests with role mocking |
| L2 Integration | Moderation API flows | API route → Worker → D1 |
| L3 E2E | Full moderation workflows | Playwright scenarios |

### Commit Guidelines
- Each feature as atomic commit
- Prefix: `feat(mod):`, `fix(mod):`, `refactor(mod):`
- Include permission edge cases in tests
- Run `bun run test` before commit

---

## UI/UX Guidelines

1. **Placement Consistency:**
   - Thread management: always in thread title row (right side)
   - Post actions: always in post footer (user=left, mod=right)
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
