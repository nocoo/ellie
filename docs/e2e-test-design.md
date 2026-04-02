# Ellie E2E Test Design (L3)

> Version: 1.1 | Date: 2026-04-02
> Ref: 6 维质量体系 L3 System/E2E

## Overview

本文档定义论坛前端 E2E 测试覆盖方案，确保 100% 主要用户流程覆盖。

### S 级项目经验吸收

从同仓库 S 级项目中提取的最佳实践：

| 项目 | 模式 | 吸收点 |
|------|------|--------|
| **surety** | Page Object Model | 每个页面一个 `*.page.ts`，封装 selectors 和 actions |
| **surety** | Custom fixtures | `fixtures/base.ts` 扩展 test，提供 `navigateTo` helper |
| **surety** | Data-driven navigation | 路由数组 + for-loop 生成测试 |
| **gecko** | BDD 目录分离 | `__tests__/bdd/` 独立于单元测试 |
| **gecko** | API seeding | 测试前通过 API 注入数据，确保可重复 |
| **dove** | Skeleton-aware assertions | `skeleton.or(content)` 处理加载态竞争 |
| **dove** | Sidebar navigation test | 完整点击验证每个导航项 |

### Quality System Context

| 维度 | 要求 | Ellie 状态 |
|------|------|-----------|
| L3 | 真实用户视角的端到端流程 | ✅ Playwright |
| D1 | 测试资源物理隔离 | ⚠️ 需配置 |

### Port Convention (6 维体系)

| 环境 | 端口 | 用途 |
|------|------|------|
| Dev | 3000 | 本地开发 |
| API E2E (L2) | 13000 | Worker API 测试 |
| Browser E2E (L3) | 23000 | Playwright 测试 |

---

## Current Coverage Analysis

### Existing Tests (tests/e2e/)

| File | Coverage |
|------|----------|
| `critical-path.spec.ts` | 基础页面可达性 (7 tests) |
| `functional-flows.spec.ts` | 排序/搜索/回复/管理 (5 tests) |
| `admin-path.spec.ts` | 管理后台可达性 (5 tests) |
| `theme-responsive.spec.ts` | 主题/响应式 |

### Gap Analysis

**Missing coverage:**
1. 完整认证流程 (注册/登录/登出/会话过期)
2. 发帖/编辑帖子流程
3. 版主操作 (置顶/精华/高亮/移动/删除)
4. 用户个人资料编辑
5. 消息系统
6. 分页导航
7. 维护模式

---

## Test Spec Design

### Spec Numbering Convention

```
E2E-{Domain}-{Sequence}: {Description}
```

| Domain | Code |
|--------|------|
| Auth | AU |
| Navigation | NV |
| Thread | TH |
| Post | PO |
| Moderation | MO |
| User | US |
| Search | SE |
| Admin | AD |
| System | SY |

---

## Spec Definitions

### E2E-AU: Authentication Flow

#### E2E-AU-01: User Registration
```gherkin
Given I am on /register
When I fill username "e2e_user_{timestamp}"
And I fill password "TestPass123!"
And I fill email "e2e_{timestamp}@test.com"
And I solve the CAPTCHA
And I click Register
Then I should be redirected to /
And I should see my username in navbar
```

#### E2E-AU-02: User Login (Credentials)
```gherkin
Given I am on /login
When I fill username "{test_user}"
And I fill password "{test_password}"
And I click Login
Then I should be redirected to /
And I should see my username in navbar
And session cookie should be set
```

#### E2E-AU-03: User Logout
```gherkin
Given I am logged in
When I click user dropdown
And I click Logout
Then I should be redirected to /login
And session cookie should be cleared
```

#### E2E-AU-04: Session Guard (Protected Route)
```gherkin
Given I am not logged in
When I navigate to /messages
Then I should be redirected to /login
And I should see a login prompt
```

#### E2E-AU-05: Login Form Validation
```gherkin
Given I am on /login
When I leave fields empty
Then submit button should be disabled
When I fill only username
Then submit button should be disabled
When I fill both username and password
Then submit button should be enabled
```

---

### E2E-NV: Navigation Flow

#### E2E-NV-01: Homepage → Forum → Thread Navigation
```gherkin
Given I am on /
When I click a forum card
Then I should be on /forums/{id}
When I click a thread title
Then I should be on /threads/{id}
And breadcrumbs should show: Home > Forum > Thread
```

#### E2E-NV-02: Breadcrumb Navigation
```gherkin
Given I am on /threads/{id}
When I click the forum breadcrumb
Then I should navigate back to /forums/{forumId}
```

#### E2E-NV-03: User Profile Navigation
```gherkin
Given I am viewing a thread
When I click the author name
Then I should be on /users/{authorId}
And I should see the user's stats
```

#### E2E-NV-04: Digest Page Navigation
```gherkin
Given I am on /
When I click "精华帖" / Digest link
Then I should be on /digest
And I should see digest statistics cards
```

#### E2E-NV-05: Pagination (Forum Thread List)
```gherkin
Given I am on /forums/{id}
And there are multiple pages
When I click page 2
Then URL should contain ?page=2
And thread list should update
When I click "下一页"
Then URL should contain ?page=3
```

#### E2E-NV-06: Keyset Pagination (Thread Posts)
```gherkin
Given I am on /threads/{id} with many posts
When I click "下一页"
Then URL should contain ?cursor=...
And posts should update
When I click "上一页"
Then posts should navigate backward
```

---

### E2E-TH: Thread Flow

#### E2E-TH-01: Create New Thread
```gherkin
Given I am logged in
And I am on /forums/{id}
When I click "发新帖" button
Then I should see new thread form
When I fill title "E2E Test Thread {timestamp}"
And I fill content "Test content"
And I click submit
Then I should be redirected to /threads/{new_id}
And I should see my thread title
```

#### E2E-TH-02: Create Thread via Dialog
```gherkin
Given I am logged in
And I am on /forums/{id}
When I click quick new thread button
Then new thread dialog should open
When I fill and submit
Then dialog should close
And thread list should update
```

#### E2E-TH-03: Thread Sort Controls
```gherkin
Given I am on /forums/{id}
When I click "最新回复" sort
Then URL should contain ?sort=newest
When I click "最新发表" sort
Then URL should contain ?sort=created
```

#### E2E-TH-04: Digest Filter Toggle
```gherkin
Given I am on /forums/{id}
When I toggle "只看精华"
Then URL should contain ?digest=true
And only digest threads should display
```

---

### E2E-PO: Post Flow

#### E2E-PO-01: Reply to Thread
```gherkin
Given I am logged in
And I am on /threads/{id}
When I type reply content in editor
And I click "发表回复"
Then my reply should appear in post list
And reply count should increase
```

#### E2E-PO-02: Quick Reply via Dialog
```gherkin
Given I am logged in
And I am viewing a post
When I click reply icon on post action bar
Then reply dialog should open with quote
When I type and submit
Then new reply should appear
```

#### E2E-PO-03: Edit Own Post
```gherkin
Given I am logged in
And I have a post in current thread
When I click edit on my post
Then edit dialog should open
When I modify content and save
Then post content should update
```

#### E2E-PO-04: Post Content Rendering
```gherkin
Given I view a thread with formatted content
Then HTML content should render safely
And images should have lightbox
And links should open in new tab
```

---

### E2E-MO: Moderation Flow

#### E2E-MO-01: Set Thread Sticky
```gherkin
Given I am logged in as moderator
And I am on /threads/{id}
When I click mod menu
And I click "置顶"
And I select sticky level
Then thread should show sticky badge
And request should succeed
```

#### E2E-MO-02: Set Thread Digest
```gherkin
Given I am logged in as moderator
And I am on /threads/{id}
When I click mod menu
And I click "设为精华"
And I select digest level
Then thread should show digest badge
```

#### E2E-MO-03: Set Thread Highlight
```gherkin
Given I am logged in as moderator
When I click "高亮" in mod menu
And I select color
Then thread title should have highlight color
```

#### E2E-MO-04: Move Thread
```gherkin
Given I am logged in as moderator
When I click "移动" in mod menu
And I select target forum
Then thread should move to new forum
And breadcrumbs should update
```

#### E2E-MO-05: Delete Thread
```gherkin
Given I am logged in as moderator
When I click "删除" in mod menu
And I confirm deletion
Then I should be redirected to forum
And thread should not exist
```

#### E2E-MO-06: Delete Post
```gherkin
Given I am logged in as moderator
When I click delete on a post
And I confirm deletion
Then post should be removed
And reply count should decrease
```

#### E2E-MO-07: Edit Post (Moderator)
```gherkin
Given I am logged in as moderator
When I click edit on any post
Then edit dialog should open
When I modify and save
Then post should update with "[已编辑]" marker
```

---

### E2E-US: User Profile Flow

#### E2E-US-01: View User Profile
```gherkin
Given I navigate to /users/{id}
Then I should see user avatar
And I should see username and role badge
And I should see stats (threads/posts/credits)
```

#### E2E-US-02: Profile Tab Navigation
```gherkin
Given I am on /users/{id}
When I click "主题" tab
Then URL should contain ?tab=threads
And I should see user's threads
When I click "回帖" tab
Then URL should contain ?tab=posts
```

#### E2E-US-03: Edit Own Profile
```gherkin
Given I am logged in
And I am on my profile /users/me
When I click edit profile
And I update signature
And I save
Then profile should show new signature
```

#### E2E-US-04: Change Password
```gherkin
Given I am logged in
When I go to profile settings
And I fill old password
And I fill new password
And I confirm new password
And I submit
Then password should be changed
And I should be logged out
```

---

### E2E-SE: Search Flow

#### E2E-SE-01: Search by Title
```gherkin
Given I am on /search
When I type "测试" in search input
And I click search
Then I should see search results
And URL should contain ?q=测试&type=title
```

#### E2E-SE-02: Search by Author
```gherkin
Given I am on /search
When I click "按作者搜索" tab
And I type username
And I search
Then results should filter by author
And URL should contain ?type=author
```

#### E2E-SE-03: Search Pagination
```gherkin
Given I have search results with multiple pages
When I click next page
Then URL should update with cursor
And results should update
```

---

### E2E-AD: Admin Flow

#### E2E-AD-01: Admin Dashboard Stats
```gherkin
Given I am logged in as admin
When I navigate to /admin
Then I should see statistics cards
And I should see recent activity
```

#### E2E-AD-02: User Management - Ban/Unban
```gherkin
Given I am logged in as admin
And I am on /admin/users
When I click "封禁" on a user
Then user status should change to "已封禁"
And button should change to "解封"
```

#### E2E-AD-03: Thread Management - Delete
```gherkin
Given I am logged in as admin
And I am on /admin/threads
When I click delete on a thread
And I confirm
Then thread should be removed from list
```

#### E2E-AD-04: Forum Management - Create/Edit
```gherkin
Given I am logged in as admin
And I am on /admin/forums
When I click "新建版块"
And I fill forum details
And I submit
Then new forum should appear in list
```

#### E2E-AD-05: Settings - General
```gherkin
Given I am logged in as admin
And I am on /admin/settings/general
When I modify site title
And I save
Then settings should persist
```

#### E2E-AD-06: Settings - Features
```gherkin
Given I am logged in as admin
And I am on /admin/settings/features
When I toggle maintenance mode
Then maintenance mode should activate
```

#### E2E-AD-07: IP Ban Management
```gherkin
Given I am logged in as admin
And I am on /admin/ip-bans
When I add an IP ban
Then IP should appear in ban list
```

#### E2E-AD-08: Censor Words Management
```gherkin
Given I am logged in as admin
And I am on /admin/censor-words
When I add a censored word
Then word should appear in list
```

---

### E2E-SY: System Flow

#### E2E-SY-01: Maintenance Mode (User View)
```gherkin
Given maintenance mode is enabled
When I navigate to / as non-admin
Then I should see maintenance page
And I should not access forum content
```

#### E2E-SY-02: Maintenance Mode (Admin Bypass)
```gherkin
Given maintenance mode is enabled
When I am logged in as admin
Then I should access forum normally
```

#### E2E-SY-03: Theme Toggle
```gherkin
Given I am on any page
When I click theme toggle
Then theme should switch between light/dark
And preference should persist
```

#### E2E-SY-04: Responsive Layout
```gherkin
Given I resize viewport to mobile (375px)
Then sidebar should collapse
And mobile navigation should appear
```

---

## Test Data Requirements

### D1 Isolation Requirements

测试必须使用隔离的测试数据库实例：

| Resource | Production | Test (E2E) |
|----------|------------|------------|
| D1 Database | `ellie-db` | `ellie-db-test` |
| API Endpoint | `api.ellie.app` | `localhost:13000` |

### Seed Data

```typescript
// tests/e2e/fixtures/seed.ts
export const TEST_USERS = {
  admin: { id: 1, username: "admin", role: 1 },
  moderator: { id: 2, username: "moderator", role: 2 },
  user: { id: 3, username: "testuser", role: 0 },
};

export const TEST_FORUMS = {
  general: { id: 10, name: "综合讨论" },
  tech: { id: 11, name: "技术交流" },
};

export const TEST_THREADS = {
  sample: { id: 50001, forumId: 10, subject: "Sample Thread" },
  withReplies: { id: 50002, forumId: 10, subject: "Thread with Replies" },
};
```

---

## Implementation Priority

### Phase 1: Critical Path (Required)

| Priority | Spec ID | Description |
|----------|---------|-------------|
| P0 | E2E-AU-02 | Login |
| P0 | E2E-AU-03 | Logout |
| P0 | E2E-NV-01 | Core navigation |
| P0 | E2E-TH-01 | Create thread |
| P0 | E2E-PO-01 | Reply to thread |

### Phase 2: Core Features

| Priority | Spec ID | Description |
|----------|---------|-------------|
| P1 | E2E-AU-01 | Registration |
| P1 | E2E-SE-01 | Search |
| P1 | E2E-MO-01~07 | Moderation |
| P1 | E2E-US-01~02 | Profile view |

### Phase 3: Admin & Edge Cases

| Priority | Spec ID | Description |
|----------|---------|-------------|
| P2 | E2E-AD-* | Admin functions |
| P2 | E2E-SY-* | System features |
| P2 | E2E-US-03~04 | Profile edit |

---

## File Structure

```
tests/
└── e2e/
    ├── auth.spec.ts          # E2E-AU-*
    ├── navigation.spec.ts    # E2E-NV-*
    ├── thread.spec.ts        # E2E-TH-*
    ├── post.spec.ts          # E2E-PO-*
    ├── moderation.spec.ts    # E2E-MO-*
    ├── user.spec.ts          # E2E-US-*
    ├── search.spec.ts        # E2E-SE-*
    ├── admin.spec.ts         # E2E-AD-*
    ├── system.spec.ts        # E2E-SY-*
    ├── fixtures/
    │   ├── seed.ts           # Test data
    │   └── users.json        # User credentials
    └── helpers/
        ├── auth-setup.ts     # Login helpers
        └── assertions.ts     # Custom assertions
```

---

## Running Tests

```bash
# Run all E2E tests
bun run test:e2e

# Run specific spec
bunx playwright test tests/e2e/auth.spec.ts

# Run with UI mode
bunx playwright test --ui

# Run headed (see browser)
bunx playwright test --headed
```

---

## Coverage Summary

| Domain | Specs | Priority |
|--------|-------|----------|
| Auth (AU) | 5 | P0/P1 |
| Navigation (NV) | 6 | P0/P1 |
| Thread (TH) | 4 | P0/P1 |
| Post (PO) | 4 | P0/P1 |
| Moderation (MO) | 7 | P1 |
| User (US) | 4 | P1/P2 |
| Search (SE) | 3 | P1 |
| Admin (AD) | 8 | P2 |
| System (SY) | 4 | P2 |
| **Total** | **45** | |

**Target: 100% 主要流程覆盖**

---

## Appendix: Existing Test Migration

现有测试需要重新组织以符合本设计：

| Old File | New Location |
|----------|--------------|
| `critical-path.spec.ts` | Split to `navigation.spec.ts`, `auth.spec.ts` |
| `functional-flows.spec.ts` | Split to `thread.spec.ts`, `search.spec.ts`, `admin.spec.ts` |
| `admin-path.spec.ts` | Merge to `admin.spec.ts` |
| `theme-responsive.spec.ts` | Move to `system.spec.ts` |

---

## Atomic Commit Plan

基于 S 级项目经验，按原子化提交实施 E2E 测试基础设施。

### Commit 1: Infrastructure Setup

**Scope:** 测试基础设施搭建

```
tests/e2e/
├── fixtures/
│   └── base.ts           # Custom test fixtures
├── pages/
│   └── .gitkeep          # Page Object placeholder
└── helpers/
    └── selectors.ts      # Common selectors
```

**Files:**
- `tests/e2e/fixtures/base.ts` — 扩展 Playwright test，添加 `navigateTo`, `loginAs` fixtures
- `tests/e2e/helpers/selectors.ts` — 共享 selectors（sheet, dialog, table-row）
- `playwright.config.ts` — 更新配置（locale: zh-CN, screenshot: only-on-failure）

**Commit message:**
```
test(e2e): add custom fixtures and selector helpers

- Add base.ts with navigateTo and loginAs fixtures
- Add selectors.ts for common UI patterns (sheet, dialog)
- Update playwright.config with locale and screenshot settings

Ref: surety fixtures pattern
```

---

### Commit 2: Page Objects - Forum

**Scope:** 论坛核心页面的 Page Object

**Files:**
- `tests/e2e/pages/home.page.ts` — 首页（forum cards, digest showcase）
- `tests/e2e/pages/forum.page.ts` — 版块页（thread list, sort controls, pagination）
- `tests/e2e/pages/thread.page.ts` — 帖子页（posts, reply form, mod menu）

**Pattern (from surety):**
```typescript
// pages/forum.page.ts
export class ForumPage {
  constructor(private page: Page) {}

  async goto(forumId: number) {
    await this.page.goto(`/forums/${forumId}`);
    await this.page.waitForLoadState("networkidle");
  }

  get heading() { return this.page.getByRole("heading", { level: 1 }); }
  get threadList() { return this.page.locator("[data-testid='thread-list']"); }
  get sortNewest() { return this.page.getByRole("button", { name: "最新回复" }); }
  get newThreadBtn() { return this.page.getByRole("button", { name: "发新帖" }); }

  threadRow(subject: string) {
    return this.page.locator("a", { hasText: subject });
  }
}
```

**Commit message:**
```
test(e2e): add page objects for forum core pages

- home.page.ts: forum cards, digest showcase
- forum.page.ts: thread list, sort, pagination
- thread.page.ts: posts, reply form, mod actions

Ref: surety POM pattern
```

---

### Commit 3: Page Objects - Auth & User

**Scope:** 认证和用户相关页面

**Files:**
- `tests/e2e/pages/login.page.ts` — 登录页（form fields, submit）
- `tests/e2e/pages/register.page.ts` — 注册页（form, CAPTCHA placeholder）
- `tests/e2e/pages/user.page.ts` — 用户资料页（avatar, stats, tabs）

**Commit message:**
```
test(e2e): add page objects for auth and user pages

- login.page.ts: credentials form
- register.page.ts: registration form
- user.page.ts: profile stats and tabs
```

---

### Commit 4: Page Objects - Admin

**Scope:** 管理后台页面

**Files:**
- `tests/e2e/pages/admin/dashboard.page.ts`
- `tests/e2e/pages/admin/users.page.ts`
- `tests/e2e/pages/admin/threads.page.ts`
- `tests/e2e/pages/admin/forums.page.ts`
- `tests/e2e/pages/admin/settings.page.ts`

**Commit message:**
```
test(e2e): add page objects for admin pages

- dashboard, users, threads, forums, settings
- Encapsulate admin table operations (ban, delete, edit)
```

---

### Commit 5: Navigation Spec (E2E-NV-*)

**Scope:** 实现 6 个导航测试

**Files:**
- `tests/e2e/navigation.spec.ts`

**Tests:**
- E2E-NV-01: Homepage → Forum → Thread
- E2E-NV-02: Breadcrumb navigation
- E2E-NV-03: User profile link
- E2E-NV-04: Digest page
- E2E-NV-05: Page pagination
- E2E-NV-06: Keyset pagination

**Pattern (from gecko):**
```typescript
const routes = [
  { path: "/", heading: "首页" },
  { path: "/digest", heading: "精华帖" },
  { path: "/search", heading: "搜索" },
];

for (const route of routes) {
  test(`navigates to ${route.heading}`, async ({ navigateTo, page }) => {
    await navigateTo(route.path);
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
  });
}
```

**Commit message:**
```
test(e2e): implement navigation specs (E2E-NV-*)

- 6 navigation tests covering core user flows
- Data-driven route verification
- Breadcrumb and pagination tests
```

---

### Commit 6: Auth Spec (E2E-AU-*)

**Scope:** 实现 5 个认证测试

**Files:**
- `tests/e2e/auth.spec.ts`

**Tests:**
- E2E-AU-01: Registration (placeholder for CAPTCHA)
- E2E-AU-02: Login
- E2E-AU-03: Logout
- E2E-AU-04: Session guard
- E2E-AU-05: Form validation

**Commit message:**
```
test(e2e): implement auth specs (E2E-AU-*)

- Login/logout flow tests
- Session guard for protected routes
- Form validation states
```

---

### Commit 7: Thread & Post Specs (E2E-TH-*, E2E-PO-*)

**Scope:** 实现 8 个帖子相关测试

**Files:**
- `tests/e2e/thread.spec.ts`
- `tests/e2e/post.spec.ts`

**Tests:**
- E2E-TH-01~04: Thread CRUD and controls
- E2E-PO-01~04: Reply and post operations

**Commit message:**
```
test(e2e): implement thread and post specs

- Thread creation and sort controls
- Reply submission and edit
- Post content rendering verification
```

---

### Commit 8: Moderation Spec (E2E-MO-*)

**Scope:** 实现 7 个版主操作测试

**Files:**
- `tests/e2e/moderation.spec.ts`

**Tests:**
- E2E-MO-01~07: Sticky, digest, highlight, move, delete

**Commit message:**
```
test(e2e): implement moderation specs (E2E-MO-*)

- Moderator actions: sticky, digest, highlight
- Thread move and delete flows
- Post moderation operations
```

---

### Commit 9: Search & User Specs (E2E-SE-*, E2E-US-*)

**Scope:** 实现 7 个搜索和用户测试

**Files:**
- `tests/e2e/search.spec.ts`
- `tests/e2e/user.spec.ts`

**Tests:**
- E2E-SE-01~03: Search by title/author, pagination
- E2E-US-01~04: Profile view, tabs, edit

**Commit message:**
```
test(e2e): implement search and user profile specs

- Search by title and author
- User profile tabs and stats
- Profile edit flow
```

---

### Commit 10: Admin Spec (E2E-AD-*)

**Scope:** 实现 8 个管理后台测试

**Files:**
- `tests/e2e/admin.spec.ts`

**Tests:**
- E2E-AD-01~08: Dashboard, user management, settings

**Commit message:**
```
test(e2e): implement admin specs (E2E-AD-*)

- Admin dashboard stats
- User ban/unban operations
- Forum and settings management
```

---

### Commit 11: System Spec (E2E-SY-*)

**Scope:** 实现 4 个系统功能测试

**Files:**
- `tests/e2e/system.spec.ts`

**Tests:**
- E2E-SY-01~02: Maintenance mode
- E2E-SY-03: Theme toggle
- E2E-SY-04: Responsive layout

**Commit message:**
```
test(e2e): implement system specs (E2E-SY-*)

- Maintenance mode with admin bypass
- Theme toggle persistence
- Responsive layout verification
```

---

### Commit 12: Migrate Existing Tests

**Scope:** 迁移并清理旧测试文件

**Actions:**
1. 将 `critical-path.spec.ts` 内容合并到 `navigation.spec.ts`, `auth.spec.ts`
2. 将 `functional-flows.spec.ts` 内容合并到相应 specs
3. 将 `admin-path.spec.ts` 合并到 `admin.spec.ts`
4. 将 `theme-responsive.spec.ts` 合并到 `system.spec.ts`
5. 删除旧文件

**Commit message:**
```
test(e2e): migrate legacy test files to new structure

- Merge critical-path, functional-flows, admin-path, theme-responsive
- Remove deprecated test files
- All specs now follow consistent POM pattern
```

---

### Commit 13: CI Integration & Documentation

**Scope:** CI 集成和文档更新

**Files:**
- `.github/workflows/e2e.yml` (if using GitHub Actions)
- `CLAUDE.md` — 更新 Quality Gates 说明
- `docs/e2e-test-design.md` — 标记完成状态

**Commit message:**
```
docs: finalize E2E test implementation

- Add CI workflow for E2E tests
- Update quality gates in CLAUDE.md
- Mark E2E design document as implemented
```

---

## Implementation Checklist

| # | Commit | Files | Status |
|---|--------|-------|--------|
| 1 | Infrastructure | fixtures/base.ts, helpers/selectors.ts | ⬜ |
| 2 | POM Forum | pages/{home,forum,thread}.page.ts | ⬜ |
| 3 | POM Auth/User | pages/{login,register,user}.page.ts | ⬜ |
| 4 | POM Admin | pages/admin/*.page.ts | ⬜ |
| 5 | Navigation | navigation.spec.ts | ⬜ |
| 6 | Auth | auth.spec.ts | ⬜ |
| 7 | Thread/Post | thread.spec.ts, post.spec.ts | ⬜ |
| 8 | Moderation | moderation.spec.ts | ⬜ |
| 9 | Search/User | search.spec.ts, user.spec.ts | ⬜ |
| 10 | Admin | admin.spec.ts | ⬜ |
| 11 | System | system.spec.ts | ⬜ |
| 12 | Migration | Delete legacy files | ⬜ |
| 13 | CI & Docs | Workflow, CLAUDE.md | ⬜ |

**Total: 13 atomic commits**

