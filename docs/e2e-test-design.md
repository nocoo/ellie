# Ellie E2E Test Design (L3)

> Version: 2.0 | Date: 2026-04-02
> Ref: 6 维质量体系 L3 System/E2E

## Overview

本文档定义论坛前端 E2E 测试覆盖方案。**严格区分当前可测试范围 vs 未来规划**。

### S 级项目经验吸收

| 项目 | 模式 | 吸收点 |
|------|------|--------|
| **surety** | Page Object Model | 每个页面一个 `*.page.ts` |
| **surety** | Custom fixtures | `fixtures/base.ts` 扩展 test |
| **surety** | Data-driven tests | 路由数组 + for-loop |
| **gecko** | BDD 目录分离 | 独立于单元测试 |
| **dove** | Skeleton-aware | `skeleton.or(content)` |

### Quality System Context

| 维度 | 要求 | Ellie 状态 |
|------|------|-----------|
| L3 | 真实用户视角 E2E | ✅ Playwright |
| D1 | 测试资源物理隔离 | ⚠️ 需配置 |

### Port Convention

| 环境 | 端口 | 用途 |
|------|------|------|
| Dev | 3000 | 本地开发 |
| API E2E (L2) | 13000 | Worker API 测试 |
| Browser E2E (L3) | 23000 | Playwright 测试 |

---

## Critical Design Decisions

### 1. Test Isolation Strategy

**问题**: `fullyParallel: true` 与有状态测试（delete/ban/edit）冲突。

**解决方案**: 分层隔离

```typescript
// playwright.config.ts
export default defineConfig({
  // ... 
  projects: [
    {
      name: "stateless",
      testMatch: /\/(navigation|auth-readonly|search)\.spec\.ts/,
      fullyParallel: true,
    },
    {
      name: "stateful",
      testMatch: /\/(thread|post|moderation|admin)\.spec\.ts/,
      fullyParallel: false,  // Sequential
      workers: 1,
    },
  ],
});
```

**Stateful tests** 每个 describe 块前执行 seed reset：

```typescript
test.describe.serial("Thread CRUD", () => {
  test.beforeAll(async ({ request }) => {
    // Reset to known state via API
    await request.post("/api/test/reset-seed");
  });
  
  test("create thread", async ({ page }) => { /* ... */ });
  test("delete thread", async ({ page }) => { /* ... */ });
});
```

### 2. Admin Authentication Strategy

**问题**: Admin 路由需要 Google OAuth + ADMIN_EMAILS 白名单，无法用 credentials 登录。

**解决方案**: Storage State Injection

```typescript
// tests/e2e/fixtures/admin-auth.ts
import { test as base } from "@playwright/test";
import path from "path";

// Pre-authenticated admin session (generated once via setup project)
const ADMIN_STORAGE_STATE = path.join(__dirname, ".auth/admin.json");

export const adminTest = base.extend({
  storageState: ADMIN_STORAGE_STATE,
});

// Generate via setup project:
// 1. Manually login as admin in headed browser
// 2. Save storage state: await page.context().storageState({ path: ADMIN_STORAGE_STATE })
// 3. Commit .auth/admin.json to repo (or generate in CI setup step)
```

**Alternative (E2E bypass)**:
```typescript
// For test environment only
// apps/web/src/proxy.ts
if (process.env.E2E_ADMIN_BYPASS === "true" && pathname.startsWith("/admin")) {
  return "next";  // Skip auth in E2E
}
```

### 3. Test Data Strategy

**问题**: 固定 seed ID + 并行测试 = 竞态条件。

**解决方案**: 动态测试数据

```typescript
// tests/e2e/fixtures/test-data.ts
export async function createTestThread(request: APIRequestContext) {
  const res = await request.post("/api/v1/threads", {
    data: {
      forumId: 10,
      subject: `E2E-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      content: "Test content",
    },
    headers: { Authorization: `Bearer ${TEST_USER_TOKEN}` },
  });
  return res.json();
}
```

---

## Scope Definition

### Current Testable Scope (v2.0)

基于当前代码库实际状态，以下功能可立即测试：

| Domain | Specs | 状态 |
|--------|-------|------|
| Navigation | 6 | ✅ 可测试 |
| Auth (Read-only) | 3 | ✅ 可测试 |
| Thread (Create/View) | 2 | ✅ 可测试 |
| Post (Create/View) | 2 | ✅ 可测试 |
| Search | 2 | ✅ 可测试 |
| System (Theme) | 1 | ✅ 可测试 |
| **Total Current** | **16** | |

### Future Planned Coverage (Blocked)

以下测试需要产品功能完成后才能实施：

| Domain | Specs | 阻塞原因 |
|--------|-------|----------|
| Auth (Registration) | 1 | CAPTCHA 环境依赖 |
| User Profile Edit | 2 | `/users/me` 不存在，无编辑 UI |
| Moderation | 7 | 需要 stateful 隔离方案 |
| Admin | 8 | 需要 admin storage state |
| System (Maintenance) | 2 | 需要 admin 权限 |
| **Total Future** | **20** | |

---

## Current Testable Specs

### E2E-NV: Navigation Flow (6 specs)

#### E2E-NV-01: Homepage Loads
```gherkin
Given I navigate to /
Then I should see forum groups
And I should see digest showcase
And I should see home footer
```

#### E2E-NV-02: Forum Page Loads
```gherkin
Given I navigate to /forums/10
Then I should see forum heading
And I should see "发表新帖" button
And I should see thread list
```

#### E2E-NV-03: Thread Page Loads
```gherkin
Given I navigate to /threads/50001
Then I should see thread title
And I should see post cards
And I should see breadcrumbs
```

#### E2E-NV-04: User Profile Loads
```gherkin
Given I navigate to /users/1
Then I should see user avatar
And I should see stats cards (threads/posts/credits)
And I should see tab navigation
```

#### E2E-NV-05: Digest Page Loads
```gherkin
Given I navigate to /digest
Then I should see "精华帖列表" heading
And I should see digest statistics
```

#### E2E-NV-06: Search Page Loads
```gherkin
Given I navigate to /search
Then I should see search input
And I should see search type tabs
```

---

### E2E-AU: Auth Flow (3 specs - Read-only)

#### E2E-AU-01: Login Form Renders
```gherkin
Given I navigate to /login
Then I should see username input
And I should see password input
And submit button should be disabled
```

#### E2E-AU-02: Login Form Validation
```gherkin
Given I am on /login
When I fill username "admin"
And I fill password "admin"
Then submit button should be enabled
```

#### E2E-AU-03: Login Success Redirects
```gherkin
Given I am on /login
When I submit valid credentials
Then I should be redirected to /
And I should see my username in navbar
```

**Note**: E2E-AU-01 (Registration with CAPTCHA) 移至 Future scope，因为 CAPTCHA 需要 `NEXT_PUBLIC_CAP_API_ENDPOINT` 环境变量。

---

### E2E-TH: Thread Flow (2 specs)

#### E2E-TH-01: View Thread Detail
```gherkin
Given I navigate to /threads/50001
Then I should see thread subject
And I should see author info
And I should see post content
```

#### E2E-TH-02: Create Thread (Logged In)
```gherkin
Given I am logged in
And I navigate to /forums/10
When I click "发表新帖" button
Then new thread dialog should open
When I fill subject and content
And I submit
Then dialog should close
And I should see success feedback
```

---

### E2E-PO: Post Flow (2 specs)

#### E2E-PO-01: View Posts
```gherkin
Given I navigate to /threads/50001
Then I should see multiple post cards
And each post should have author sidebar
And each post should have content area
```

#### E2E-PO-02: Reply to Thread (Logged In)
```gherkin
Given I am logged in
And I am on /threads/50001
When I type reply in editor
And I click submit
Then my reply should appear
```

---

### E2E-SE: Search Flow (2 specs)

#### E2E-SE-01: Search by Title
```gherkin
Given I am on /search
When I type "测试" in search input
And I click search button
Then URL should contain ?q=测试
And I should see results or "未找到" message
```

#### E2E-SE-02: Switch Search Type
```gherkin
Given I have search results for "admin"
When I click "按作者搜索" tab
Then URL should contain ?type=author
And results should update
```

---

### E2E-SY: System Flow (1 spec)

#### E2E-SY-01: Theme Toggle (Three-state)
```gherkin
Given I am on any page
When I click theme toggle
Then icon should change to Moon (dark)
When I click again
Then icon should change to Monitor (system)
When I click again
Then icon should change to Sun (light)
```

**Note**: 主题是三态循环 (light → dark → system)，非二态。

---

## Future Specs (Blocked)

### E2E-AU-04: Registration (Blocked: CAPTCHA)
```gherkin
# Requires NEXT_PUBLIC_CAP_API_ENDPOINT
Given I am on /register
When I fill valid registration data
And I complete CAPTCHA
Then I should be auto-logged in
And redirected to /
```
**Status**: ⏸️ Blocked — CAPTCHA widget only renders when env var is set.

---

### E2E-US: User Profile Edit (Blocked: No UI)
```gherkin
# /users/me does not exist
# Profile page has no edit functionality
```
**Status**: ⏸️ Blocked — Product feature not implemented.

---

### E2E-MO: Moderation (Blocked: Isolation)
```gherkin
# Requires stateful test isolation
# Requires moderator login fixtures
```
**Status**: ⏸️ Blocked — Need serial execution + seed reset API.

---

### E2E-AD: Admin (Blocked: Auth)
```gherkin
# Requires Google OAuth + ADMIN_EMAILS
# Or storage state injection
```
**Status**: ⏸️ Blocked — Need admin auth strategy implementation.

---

## File Structure

```
tests/e2e/
├── fixtures/
│   ├── base.ts              # navigateTo, loginAs fixtures
│   ├── selectors.ts         # Common selectors
│   └── admin-auth.ts        # Admin storage state (future)
├── pages/
│   ├── home.page.ts
│   ├── forum.page.ts
│   ├── thread.page.ts
│   ├── login.page.ts
│   ├── search.page.ts
│   └── user.page.ts
├── navigation.spec.ts       # E2E-NV-* (6 tests)
├── auth.spec.ts             # E2E-AU-* (3 tests)
├── thread.spec.ts           # E2E-TH-* (2 tests)
├── post.spec.ts             # E2E-PO-* (2 tests)
├── search.spec.ts           # E2E-SE-* (2 tests)
└── system.spec.ts           # E2E-SY-* (1 test)
```

---

## Atomic Commit Plan (Revised)

### Phase 1: Infrastructure (2 commits)

#### Commit 1: Fixtures & Config
```
- tests/e2e/fixtures/base.ts (navigateTo, loginAs)
- tests/e2e/fixtures/selectors.ts
- playwright.config.ts (update: locale, projects)
```

#### Commit 2: Page Objects
```
- tests/e2e/pages/home.page.ts
- tests/e2e/pages/forum.page.ts
- tests/e2e/pages/thread.page.ts
- tests/e2e/pages/login.page.ts
- tests/e2e/pages/search.page.ts
- tests/e2e/pages/user.page.ts
```

### Phase 2: Current Specs (4 commits)

#### Commit 3: Navigation Spec
```
- tests/e2e/navigation.spec.ts (6 tests)
```

#### Commit 4: Auth Spec
```
- tests/e2e/auth.spec.ts (3 tests)
```

#### Commit 5: Thread & Post Specs
```
- tests/e2e/thread.spec.ts (2 tests)
- tests/e2e/post.spec.ts (2 tests)
```

#### Commit 6: Search & System Specs
```
- tests/e2e/search.spec.ts (2 tests)
- tests/e2e/system.spec.ts (1 test)
```

### Phase 3: Migration & Cleanup (1 commit)

#### Commit 7: Migrate Legacy Tests
```
- Merge content from critical-path.spec.ts
- Merge content from functional-flows.spec.ts
- Delete deprecated files
```

**Total: 7 atomic commits for current scope**

---

## Page Object Corrections

Based on actual UI inspection:

### ForumPage

```typescript
export class ForumPage {
  constructor(private page: Page) {}

  async goto(forumId: number) {
    await this.page.goto(`/forums/${forumId}`);
    await this.page.waitForLoadState("networkidle");
  }

  get heading() {
    return this.page.locator("h1");  // Forum name
  }

  get newThreadButton() {
    // Actual text is "发表新帖", not "发新帖"
    return this.page.getByRole("button", { name: "发表新帖" });
  }

  get threadList() {
    // No data-testid, use structure
    return this.page.locator(".divide-y");
  }

  // No sort buttons in current UI
  // No digest filter toggle in current UI
}
```

### ThemeToggle

```typescript
// Three-state cycle: light → dark → system
const THEME_SEQUENCE = ["Light mode", "Dark mode", "System theme"];

async function cycleTheme(page: Page, times: number) {
  for (let i = 0; i < times; i++) {
    await page.getByLabel(/mode|theme/).click();
  }
}
```

---

## Implementation Checklist

| # | Commit | Status |
|---|--------|--------|
| 1 | Fixtures & Config | ⬜ |
| 2 | Page Objects | ⬜ |
| 3 | Navigation Spec | ⬜ |
| 4 | Auth Spec | ⬜ |
| 5 | Thread & Post Specs | ⬜ |
| 6 | Search & System Specs | ⬜ |
| 7 | Legacy Migration | ⬜ |

**Current scope: 16 tests in 7 commits**

---

## Appendix: Blockers for Future Scope

| Blocker | Impact | Resolution Path |
|---------|--------|-----------------|
| CAPTCHA env dependency | Registration test | Mock CAPTCHA or skip in E2E |
| No `/users/me` route | Profile edit tests | Implement route + edit UI |
| No profile edit UI | Profile edit tests | Implement edit form |
| Admin requires OAuth | Admin tests | Storage state or E2E bypass |
| Stateful test collision | Moderation tests | Implement seed reset API |
