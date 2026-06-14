# Ellie L3 → BDD 重构方案

> **Numbers in this doc are reproducible.** All test counts come from commands
> embedded inline; re-run them on `main` to verify. If a count drifts during
> the migration, update the doc in the same commit that changes the count.

## 1. 存量分析

### 1.1 测试规模

Reproducible baseline commands (run from repo root):

```bash
# Forum specs
grep -cE '^\s*test\(' tests/e2e/*.spec.ts | awk -F: '{s+=$2} END {print s}'
# => 74

# Admin specs
grep -cE '^\s*test\(' tests/e2e/admin/*.spec.ts | awk -F: '{s+=$2} END {print s}'
# => 20

# Total
grep -cE '^\s*test\(' tests/e2e/*.spec.ts tests/e2e/admin/*.spec.ts | awk -F: '{s+=$2} END {print s}'
# => 94
```

| 指标 | 数值 |
|------|------|
| Spec 文件数 (Forum) | 23 |
| Spec 文件数 (Admin) | 6 |
| Spec 文件数合计 | **29** |
| 测试用例总数 | **94** |
| Forum 域 | 23 spec, 74 tests |
| Admin 域 | 6 spec, 20 tests |

### 1.2 Spec 文件清单

Per-file counts (reproducible via
`grep -cE '^\s*test\(' tests/e2e/*.spec.ts tests/e2e/admin/*.spec.ts`):

#### Forum Specs (23 files, 74 tests)

| Spec 文件 | 测试数 | 现有 Describe ID | 域 | 覆盖范围 |
|-----------|--------|------------------|----|---------|
| `already-logged-in` | 2 | E2E-AL | Auth | 已登录用户落地页 |
| `auth` | 3 | E2E-AU | Auth | 登录/注册/登出流程 |
| `redirect` | 3 | E2E-RD | Auth | 重定向安全（未登录守卫） |
| `navigation` | 6 | E2E-NV | Navigation | 核心导航流程 |
| `navigation-extra` | 4 | E2E-NX | Navigation | 扩展导航覆盖 |
| `header-actions` | 4 | E2E-HA | Navigation | 页眉/页脚操作元素 |
| `not-found` | 4 | E2E-NF | Navigation | 404 和无效参数路由 |
| `search` | 1 | E2E-SE | Search | 搜索流程 |
| `search-interaction` | 2 | E2E-SI | Search | 搜索交互 |
| `thread` | 1 | E2E-TH | Content | 帖子查看流程 |
| `thread-crud` | 2 | E2E-TC | Content | 帖子 CRUD（stateful） |
| `post` | 1 | E2E-PO | Content | 回复查看流程 |
| `post-crud` | 3 | E2E-PR | Content | 回复 CRUD（stateful） |
| `post-comments` | 2 | E2E-PC | Content | 回复评论 |
| `pagination` | 2 | E2E-PG | Content | 分页 |
| `digest-filter` | 1 | E2E-DF | Content | 精华筛选 |
| `message` | 2 | E2E-MS | Social | 私信流程 |
| `user-actions` | 2 | E2E-UA | Social | 用户操作流程 |
| `user-journey` | 3 | E2E-UJ | Social | 用户旅程 |
| `system` | 5 | E2E-SY | System | 系统流程 + 响应式视口 |
| `dialog-layout` | 2 | E2E-DL | UI | 对话框布局 |
| `mobile-layout` | 15 | E2E-MOB | UI | 移动端布局（5 个子 describe） |
| `misc-coverage` | 4 | E2E-MX | Misc | 杂项用户可见流程 |
| **合计** | **74** | | | |

#### Admin Specs (6 files, 20 tests)

| Spec 文件 | 测试数 | 域 | 覆盖范围 |
|-----------|--------|-----|---------|
| `admin-auth` | 3 | Admin Auth | 管理员认证守卫 |
| `admin-users` | 9 | Admin CRUD | 用户管理（查看/搜索/编辑/封禁） |
| `admin-logs` | 4 | Admin Read | 操作日志 |
| `admin-reports` | 2 | Admin Read | 举报列表 |
| `admin-forums` | 1 | Admin CRUD | 版块管理 |
| `admin-threads` | 1 | Admin CRUD | 帖子/回复管理 |
| **合计** | **20** | | |

域加总核对：74 + 20 = 94 ✅

### 1.3 技术栈现状

| 维度 | 现状 |
|------|------|
| 框架 | Playwright ^1.60.0 (Chromium only) |
| 配置 | `playwright.config.ts`（根目录） |
| 测试目录 | `tests/e2e/` (forum) + `tests/e2e/admin/` (admin) |
| 端口 | 27031 (dev=7031, L2=17031, L3=27031), admin=7032 |
| 启动器 | `scripts/run-l3.ts`（forum）、`scripts/run-l3-admin.ts`（admin） |
| 并行度 | 1 worker (sequential) |
| 超时 | 90s per test, 15s expect, 30s navigation |
| Locale | zh-CN, timezone: Asia/Shanghai |
| 4 个 Projects | stateless (parallel), stateful (sequential), mobile (iPhone 14), admin (独立端口) |
| Page Objects | 7 个：forum, home, login, message, search, thread, user |
| 共享 Fixtures | `fixtures/base.ts`（navigateTo + loginAs）、`fixtures/selectors.ts`（集中选择器） |
| Admin Fixtures | `admin/fixtures/admin-base.ts`（JWT minting 认证） |
| CI 方式 | 自建 job（`browser-e2e`），需 D1 迁移 + seed + Worker deploy |
| BDD 元素 | **零 Gherkin**，但 97 处 Given/When/Then 已存在于代码注释中 |

### 1.4 测试风格分析

**命名模式**：使用编号式 ID 前缀（`E2E-NV`, `E2E-AU`），describe 内测试用命令式短句。

**Locator 策略**：

| 定位方式 | 使用次数 | 占比 |
|----------|---------|------|
| `page.locator()` (CSS) | 107 | 35% |
| `page.getByRole()` | 101 | 33% |
| `page.getByText()` | 58 | 19% |
| `page.getByTestId()` | 32 | 10% |
| `page.getByLabel()` | 6 | 2% |
| `page.getByPlaceholder()` | 4 | 1% |

**断言模式**：

| 断言 | 使用次数 |
|------|---------|
| `toBe()` | 339 |
| `toBeVisible()` | 225 |
| `toBeHidden()` | 21 |
| `toHaveCount()` | 12 |
| `toHaveURL()` | 11 |
| `toContainText()` | 6 |
| `toBeDisabled()` | 4 |
| `toBeEnabled()` | 3 |

**操作复杂度**：

| 操作 | 使用次数 | 说明 |
|------|---------|------|
| `page.goto()` | 99 | 多数测试有多次导航 |
| `.click()` | 87 | 大量交互操作 |
| `waitForURL()` | 26 | 导航等待 |
| `.fill()` | 16 | 表单填写 |
| `page.route()` | 5 | API mock |
| `waitForTimeout()` | 0 | ✅ 无硬编码等待 |

**结论**：
1. **交互复杂度高**：click(87) + fill(16) 远高于 firefly(35+2) 和 pew(18+6)，BDD 改写需更谨慎
2. **Locator 质量中等**：语义化 65%（getByRole+getByText+getByLabel+getByPlaceholder），CSS 35% 需审查
3. **Page Object 成熟**：7 个 POM + 集中选择器文件是 ellie 独有优势，BDD 改写可直接复用
4. **测试已有 BDD 思维**：97 处 Given/When/Then 注释说明开发者已按 BDD 思路组织，改写阻力低
5. **无 waitForTimeout**：测试质量基础好，无需消除硬编码等待

### 1.5 已有痛点

1. **防御性 catch 模式**：7 处 `.isVisible().catch(() => false)` 散落在 navigation/pagination/message/search/digest-filter specs
2. **条件跳过不统一**：4 处 `test.skip`（thread-crud、navigation-extra、post-crud）+ 2 处自定义 `skipOnCI`（auth、user-actions），无统一数据门模式
3. **Playwright Projects 配置复杂**：4 个 project（stateless/stateful/mobile/admin）各有独立匹配规则，BDD 目录结构必须兼容
4. **命名 ID 系统陈旧**：`E2E-NV`/`E2E-AU` 编号系统与 BDD Feature 前缀冲突，需统一替换
5. **mobile-layout 单文件过大**：15 个测试 + 5 个子 describe，是最大的单 spec
6. **Admin 独立启动器**：`run-l3-admin.ts` 与 `run-l3.ts` 分离，BDD 迁移需分别处理

### 1.6 已有优势（BDD 迁移加速器）

与 firefly/pew 不同，ellie 已具备多项 BDD 友好基础设施：

1. **Page Object Model (7 个)**：`forum.page.ts`、`home.page.ts`、`login.page.ts`、`message.page.ts`、`search.page.ts`、`thread.page.ts`、`user.page.ts` — BDD 步骤可直接调用 POM 方法
2. **Custom Fixtures**：`fixtures/base.ts` 已有 `navigateTo`、`loginAs` — 无需从零搭建
3. **集中选择器**：`fixtures/selectors.ts` 定义 NAV/FORM/FORUM/THREAD/DIALOG/USER/SEARCH 常量 — locator 重写可参考
4. **BDD 注释 DNA**：97 处 Given/When/Then 在代码注释中，改写为正式 BDD 命名的映射关系清晰
5. **Skeleton-aware 断言模式**：已吸收 dove 项目经验，处理 loading 状态

## 2. BDD 目标架构

### 2.1 方案选型

采用 **方案 B：L3 原地升级为 BDD**，与 firefly/pew 标杆保持一致。

技术选型：**Playwright 原生 BDD**（Given/When/Then 命名约定 + 结构化步骤注释）。**不引入** 任何 Gherkin/Cucumber 依赖。

BDD 在本项目中的定义仅是：**test 名称用 Given/When/Then 句式 + 测试体内有 `// Given:` / `// When:` / `// Then:` 注释分段 + `describe` 用 `Feature:` 前缀**。

### 2.2 目录结构迁移

```
tests/e2e/
├── *.spec.ts              # 当前 forum specs（重构期与 bdd/ 并存，最终删除）
├── admin/                 # 当前 admin specs（重构期与 bdd/admin/ 并存，最终删除）
├── bdd/                   # 目标
│   ├── fixtures.ts        # BDD 共享 fixtures（继承现有 base.ts + 新增 emptyDataGate）
│   ├── auth.spec.ts       # 认证域
│   ├── navigation.spec.ts # 导航域
│   ├── search.spec.ts     # 搜索域
│   ├── content.spec.ts    # 帖子/回复/分页/精华
│   ├── social.spec.ts     # 私信/用户操作/用户旅程
│   ├── system.spec.ts     # 系统/对话框/杂项
│   ├── mobile.spec.ts     # 移动端布局
│   └── admin/
│       ├── admin-auth.spec.ts
│       └── admin-crud.spec.ts
├── fixtures/              # 保留（base.ts, selectors.ts）
├── pages/                 # 保留（7 个 Page Objects）
└── playwright.config.ts   # 重构期同时覆盖旧目录和 bdd/（见 §6.2）
```

### 2.3 BDD 命名规范

**test 名称**：`"Given <前置条件>, When <操作>, Then <期望结果>"`

```typescript
// ❌ 当前风格
test("NV-01 home → forum → thread navigation", async ({ navigateTo }) => { ... });

// ✅ BDD 风格
test("Given I am on the home page, When I navigate to a forum and open a thread, Then I see the thread content", async ({ navigateTo }) => {
  // Given: on home page
  // When: navigate to forum, then thread
  // Then: thread content visible
});
```

**describe 名称**：`"Feature: <功能域>"`

```typescript
// ❌ 当前风格
test.describe("E2E-NV: Navigation Flow", () => { ... });

// ✅ BDD 风格
test.describe("Feature: Forum Navigation", () => { ... });
```

### 2.4 共享 Fixtures（边界约束）

`tests/e2e/bdd/fixtures.ts` **继承**现有 `fixtures/base.ts` 的 `navigateTo`/`loginAs` 能力，并新增 BDD 标准辅助：

```typescript
// tests/e2e/bdd/fixtures.ts
import { test as base } from "../fixtures/base";
export { expect } from "@playwright/test";

/** Inspect count; caller must consume via `test.skip(result.skip, result.reason)`. */
export function emptyDataGate(count: number, what: string): { skip: boolean; reason: string } {
  return count === 0
    ? { skip: true, reason: `Test DB has no ${what}; seed required.` }
    : { skip: false, reason: "" };
}

export { base as test };
```

**保留不动**的现有基础设施：
- `fixtures/base.ts` — `navigateTo`、`loginAs`、auth state caching
- `fixtures/selectors.ts` — 集中选择器常量
- `pages/*.page.ts` — 7 个 Page Objects

**不放进 BDD fixtures**：
- 任何 spec 内部一次性 helper
- Page Object 逻辑（已在 `pages/` 中）

### 2.5 Locator 策略（迁移强制）

迁移过程中 107 处 CSS `.locator()` 按以下优先级审查：

1. `page.getByRole("...", { name: "..." })` — 首选
2. `page.getByLabel(...)` — 表单字段首选
3. `page.getByTestId(...)` — 已有 32 处，保留
4. `page.getByText(...)` — 用户可见文本断言时接受
5. `page.locator("css")` — **仅作为兜底**，必须加注释说明

**审查重点**：
- `fixtures/selectors.ts` 中的选择器常量如 `NAV.sidebar`、`FORUM.threadCard` 等：若底层是 CSS 选择器，保留但加注释说明为何无法用语义化 locator
- Page Object 内部的 locator 也应审查，但不强制改写（POM 内部 CSS 是可接受的封装）

### 2.6 数据门模式统一

**消除防御性 catch（7 处）**：

```typescript
// ❌ 当前
const hasContent = await page.locator(".post-list").isVisible().catch(() => false);

// ✅ BDD
const count = await page.locator(".post-list").count();
const gate = emptyDataGate(count, "posts");
test.skip(gate.skip, gate.reason);
```

**统一条件跳过**：
- 4 处 `test.skip` → 保留，但统一格式为 `test.skip(condition, "explicit reason")`
- 2 处 `skipOnCI` → 迁移为 `test.skip(!!process.env.CI, "Requires local-only resource")`

## 3. Spec 合并计划

当前 29 个 spec 合并到 9 个 BDD spec。

> **来源数核对原则**：本表"原测试数"列必须与 §1.2 完全一致。

### Forum Specs (23 → 7)

| 目标 BDD Spec | 合并来源 (旧 spec → 取用测试数) | 原测试数 | 新 BDD 测试数 |
|---------------|-----------------------------|---------|----------------|
| `auth.spec.ts` | already-logged-in(2) + auth(3) + redirect(3) | 8 | 8 |
| `navigation.spec.ts` | navigation(6) + navigation-extra(4) + header-actions(4) + not-found(4) | 18 | 14 |
| `search.spec.ts` | search(1) + search-interaction(2) | 3 | 3 |
| `content.spec.ts` | thread(1) + thread-crud(2) + post(1) + post-crud(3) + post-comments(2) + pagination(2) + digest-filter(1) | 12 | 10 |
| `social.spec.ts` | message(2) + user-actions(2) + user-journey(3) | 7 | 7 |
| `system.spec.ts` | system(5) + dialog-layout(2) + misc-coverage(4) | 11 | 9 |
| `mobile.spec.ts` | mobile-layout(15) | 15 | 12 |
| **Forum 小计** | **23 → 7** | **74** | **63** |

### Admin Specs (6 → 2)

| 目标 BDD Spec | 合并来源 (旧 spec → 取用测试数) | 原测试数 | 新 BDD 测试数 |
|---------------|-----------------------------|---------|----------------|
| `admin/admin-auth.spec.ts` | admin-auth(3) | 3 | 3 |
| `admin/admin-crud.spec.ts` | admin-users(9) + admin-logs(4) + admin-reports(2) + admin-forums(1) + admin-threads(1) | 17 | 14 |
| **Admin 小计** | **6 → 2** | **20** | **17** |

### 合计

| | 旧 | 新 |
|-|----|----|
| Spec 文件 | 29 | **9** |
| 测试数 | 94 | **80** |

**合计来源核对**：8+18+3+12+7+11+15+3+17 = 94 ✅

**新 BDD 测试数核对**（reproducible from `bunx playwright test --list --project=<p>`）：
8+14+3+10+7+9+12 = 63 forum，3+14 = 17 admin，合计 80 ✅

预估测试数减少原因：
- 合并 navigation + navigation-extra + header-actions 中重复的导航验证
- 合并 mobile-layout 5 个子 describe 中重复的响应式断言
- 合并 admin-users 中功能相近的搜索/筛选测试

**Traceability 要求**：每个目标 spec 完成时，提交 message body 必须附"旧 test 名 → 新 scenario 名"的全量映射。

## 4. Playwright Projects 兼容

### 4.1 Projects 迁移（关键约束）

ellie 的 4 个 Playwright project 必须在 BDD 目录中保持等价分组：

| Project | Stage 1 testMatch (旧/新并存) | Stage 2 testMatch (纯 BDD) |
|---------|-------------------------------|----------------------------|
| `stateless` | `navigation`, `navigation-extra`, `auth`, `search`, `system`, `redirect`, `pagination`, `message`, `user-journey`, `search-interaction`, `digest-filter`, `dialog-layout`, `not-found`, `user-actions`, `misc-coverage`, `already-logged-in`, `header-actions` (17 文件) | `bdd/auth.spec.ts`, `bdd/navigation.spec.ts`, `bdd/search.spec.ts`, `bdd/system.spec.ts` |
| `stateful` | `thread`, `post`, `post-comments`, `thread-crud`, `post-crud`, `content`, `social` (Stage 1 兼容) | `bdd/content.spec.ts`, `bdd/social.spec.ts` |
| `mobile` | `mobile-layout`, `mobile`（Stage 1 兼容） | `bdd/mobile.spec.ts` |
| `admin` | `tests/e2e/admin/*.spec.ts` + `tests/e2e/bdd/admin/*.spec.ts`（Stage 1 broadened testDir） | `tests/e2e/bdd/admin/*.spec.ts`（testDir 收敛到 `tests/e2e/bdd/admin`） |

Stage 1 迁移期需同时匹配旧/新路径，Stage 2 收敛到纯 BDD 路径。

**Project 归属变化（合并的副作用）**：

下列 4 个 spec 当前在 `stateless`（`fullyParallel: true`），合并后落入 `content.spec.ts` / `social.spec.ts`，归属变为 `stateful`（`fullyParallel: false`）：

| 原 spec | 原 project | 合并去向 | 新 project |
|---------|-----------|---------|-----------|
| `pagination` | stateless | `content.spec.ts` | stateful |
| `digest-filter` | stateless | `content.spec.ts` | stateful |
| `message` | stateless | `social.spec.ts` | stateful |
| `user-journey` | stateless | `social.spec.ts` | stateful |

**取舍**：本次重构优先按"语义域"分组（content / social），接受这 4 个原本可并行的只读 spec 转串行带来的 L3 时长增加（预估 +10~15s，目前 L3 单 worker 顺序执行已无并行收益）。**不**为此引入第五个 `stateful-readonly` project，理由：
- 现有 `playwright.config.ts` 顶层就是 `workers: 1`，stateless 的 `fullyParallel: true` 实际只在单 worker 内做文件内并行，收益有限
- 多一个 project 等于多一组 testMatch 维护成本，与 BDD"按语义分文件"的核心目的冲突
- 若 L3 时长后续恶化超过 20%（以基线运行时为准），再考虑拆 readonly project

### 4.2 admin project 的 testDir 迁移

当前 admin project 配置：

```ts
{ name: "admin", testDir: "tests/e2e/admin", testMatch: /.*\.spec\.ts/, ... }
```

由于 admin project 设置了独立的 `testDir`，仅在顶层 `testMatch` 加 `bdd/admin/*.spec.ts` **不会**让 BDD 文件被收集。Stage 1/2 必须显式修改 admin project 的 `testDir`：

**Stage 1（并存期）**：admin project 的 `testDir` 改为 `tests/e2e`，`testMatch` 同时匹配旧/新两个路径：

```ts
{
  name: "admin",
  testDir: "tests/e2e",
  testMatch: /\/(admin\/[^/]+\.spec\.ts|bdd\/admin\/[^/]+\.spec\.ts)$/,
  ...
}
```

**Stage 2（迁移完成）**：admin project 的 `testDir` 收敛到 `tests/e2e/bdd/admin`：

```ts
{
  name: "admin",
  testDir: "tests/e2e/bdd/admin",
  testMatch: /.*\.spec\.ts/,
  ...
}
```

### 4.3 stateful 保护

stateful project 中的 CRUD 测试（thread-crud、post-crud）依赖顺序执行。`content.spec.ts` 既包含只读 scenario（原 thread/post/post-comments/pagination/digest-filter）也包含 CRUD scenario（原 thread-crud/post-crud），必须按以下模式组织：

```typescript
test.describe("Feature: Forum Content", () => {
  // 只读 scenarios（并行安全，但 stateful project fullyParallel=false 也接受）
  test("Given a thread exists, When I open it, Then I see its posts", ...);
  test("Given a long thread, When I paginate, Then I see next page", ...);

  // CRUD scenarios 必须包在 .serial 块内，保证写操作顺序
  test.describe.serial("Thread CRUD", () => {
    test("Given I am logged in, When I create a thread, Then it appears in the forum", ...);
    test("Given the thread I created, When I edit it, Then I see updates", ...);
    test("Given the thread I created, When I delete it, Then it is gone", ...);
  });

  test.describe.serial("Post CRUD", () => { ... });
});
```

`social.spec.ts` 同理：`message`、`user-actions` 中的写操作（发私信、关注/取关）若依赖前序状态，包在独立的 `.serial` 块内；纯只读的 `user-journey` 不需要。

## 5. 迁移优先级与原子提交

### 5.1 原子提交规则

- **每个 commit 最多迁移一个目标 BDD spec**。
- 删除旧 spec 与新 spec 落地必须在同一个 commit 内或紧接的下一个 commit 中。
- 单个 commit 必须包含 traceability 映射表。

### 5.2 Phase 0：基建准备

| 批次 | 内容 | 工作量 |
|------|------|--------|
| 0.1 | 创建 `tests/e2e/bdd/fixtures.ts` + Stage 1 config commit | 0.5h |

### 5.3 Phase 1：只读页面（风险最低）

| 批次 | Spec | 测试数 (旧→新) | 工作量 | 理由 |
|------|------|--------|--------|------|
| 1.1 | `navigation.spec.ts` | 18 → 14 | 中 | 合并 4 个 spec，纯导航 |
| 1.2 | `search.spec.ts` | 3 → 3 | 小 | 合并 2 个 spec，只读 |
| 1.3 | `system.spec.ts` | 11 → 9 | 中 | 合并 3 个 spec，混合断言 |

### 5.4 Phase 2：认证 + 社交

| 批次 | Spec | 测试数 (旧→新) | 工作量 | 理由 |
|------|------|--------|--------|------|
| 2.1 | `auth.spec.ts` | 8 → 8 | 小 | 合并 3 个 spec，有 loginAs fixture |
| 2.2 | `social.spec.ts` | 7 → 7 | 中 | 合并 3 个 spec，有 message/user flows |

### 5.5 Phase 3：有状态内容 + 移动端

| 批次 | Spec | 测试数 (旧→新) | 工作量 | 理由 |
|------|------|--------|--------|------|
| 3.1 | `content.spec.ts` | 12 → 10 | 大 | 合并 7 个 spec，含 CRUD serial mode |
| 3.2 | `mobile.spec.ts` | 15 → 12 | 中 | 单文件重构，5 个子 describe |

### 5.6 Phase 4：Admin

| 批次 | Spec | 测试数 (旧→新) | 工作量 | 理由 |
|------|------|--------|--------|------|
| 4.1 | `admin/admin-auth.spec.ts` | 3 → 3 | 小 | 独立认证 |
| 4.2 | `admin/admin-crud.spec.ts` | 17 → 14 | 大 | 合并 5 个 spec，有 CRUD 操作 |

## 6. 迁移检查清单（每个批次 / 每个目标 spec）

每个目标 spec 落地前按以下步骤执行：

1. **创建 BDD spec 文件**：在 `tests/e2e/bdd/` 下新建
2. **重写测试名称**：全部改为 Given/When/Then 格式，删除 E2E-XX 编号前缀
3. **添加步骤注释**：`// Given:` / `// When:` / `// Then:`
4. **Locator 审查**：按 §2.5 优先级，CSS fallback 必须加注释说明
5. **复用 POM**：通过 `fixtures/base.ts` 的 `navigateTo`/`loginAs` 和 `pages/*.page.ts` 调用
6. **数据门标准化**：把 `.isVisible().catch(() => false)` 改为 `emptyDataGate` + `test.skip()`（§2.6）
7. **条件跳过统一**：`skipOnCI` 改为 `test.skip(!!process.env.CI, "reason")`
8. **合并微测试**：同一 scenario 的多个微断言合并
9. **Serial mode 保留**：CRUD 测试保持 `test.describe.serial`
10. **Traceability 映射**：在 commit body 中写"旧 test 名 → 新 scenario 名"全量表
11. **删除旧 spec**：确认 playwright projects 仍正确匹配后删除
12. **验证四件套**：
    - `bun run typecheck`
    - `bun run lint`
    - `bunx playwright test --list`（确认新 spec 被收集，旧 spec 不在）
    - **L3 全量**：forum 批次至少跑 `bun run test:e2e:browser`，admin 批次至少跑 `bun run test:e2e:admin`。**收尾 commit（最后一个删除旧 spec 的 commit）必须二者都跑通过**，不允许只跑其中一个。

## 7. CI 迁移

### 7.1 当前 CI 架构

ellie CI 使用**自建 L3 job**（`browser-e2e`），因为需要：
- D1 迁移（`bun run worker:migrate:test`）
- Best-effort worker deploy
- 测试数据 seed
- 环境变量写入（WORKER_URL_TEST、API_KEY、JWT_SECRET、AUTH_SECRET 等）

这些需求使得 base-ci 的 `enable-l3` + `l3-command` 模式**不适用**。ellie 的 L3 CI 保持自建 job。

### 7.2 BDD 迁移期间的 `playwright.config.ts` 演化（三阶段）

**Stage 0（重构前，当前）**：

```ts
testDir: "tests/e2e",
// 4 projects with specific testMatch patterns
```

**Stage 1（迁移期，旧/新并存）**：每个 project 的 testMatch 同时包含旧路径和 `bdd/` 路径。

**Stage 2（迁移完成）**：所有旧 spec 删除后，testDir 收敛到 `tests/e2e/bdd`，projects 的 testMatch 更新为纯 BDD 路径。

### 7.3 CI 命令统一

Stage 2 完成后，在 `package.json` 添加别名，**同时覆盖 forum 与 admin**，避免 BDD 一键运行漏掉 admin：

```json
"test:e2e:bdd": "bun run test:e2e:browser && bun run test:e2e:admin"
```

`test:e2e:bdd` 的语义即 "L3 BDD 全量"（forum + admin），与 §11 验收里"browser + admin 全量通过"一致。

## 8. 工作量估算

| Phase | Spec 数 | 测试数 | 预估工时 | SDE Issue 数 |
|-------|---------|--------|---------|-------------|
| 准备工作 | 0 | 0 | 0.5h | 1 |
| Phase 1 | 3 | 26 | 2h | 3 |
| Phase 2 | 2 | 15 | 1.5h | 2 |
| Phase 3 | 2 | 22 | 2.5h | 2 |
| Phase 4 | 2 | 17 | 2h | 2 |
| 收尾 | 0 | 0 | 0.5h | 1 |
| **合计** | **9** | **80** | **~9.5h** | **11** |

## 9. 约束与风险

### 9.1 不变量

| 不变量 | Baseline | 验证命令 |
|--------|----------|---------|
| `scripts/run-l3.ts` 不改 | — | `git diff main -- scripts/run-l3.ts` 必须为空 |
| `scripts/run-l3-admin.ts` 不改 | — | 同上 |
| Page Objects 不改 | 7 个 | `ls tests/e2e/pages/*.page.ts \| wc -l` |
| `fixtures/base.ts` 不改 | — | `git diff main -- tests/e2e/fixtures/base.ts` 必须为空 |
| `fixtures/selectors.ts` 不改 | — | 同上 |
| L3 baseline | 29 spec, 94 tests | `grep -cE '^\s*test\(' tests/e2e/*.spec.ts tests/e2e/admin/*.spec.ts \| awk -F: '{s+=$2} END {print s}'` |
| L1 覆盖率 | 95/90/95/95 per package | `bun run test:coverage` 门限不变 |
| CI 自建 job | — | `.github/workflows/ci.yml` 中 `browser-e2e` job 步骤不变 |

### 9.2 风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Playwright projects testMatch 迁移不完整 | 部分测试不被收集 | Stage 1 期间每次改动后 `bunx playwright test --list` 验证 |
| stateful CRUD 顺序被打破 | 数据状态不一致 | content.spec.ts 保持 `test.describe.serial` |
| mobile project viewport 设置丢失 | 移动端测试在桌面视口运行 | mobile.spec.ts 必须在 `mobile` project 的 testMatch 中 |
| Admin 独立端口/启动器兼容 | admin specs 无法运行 | admin BDD specs 保持在 `bdd/admin/` 子目录，`run-l3-admin.ts` 不变 |
| POM 内部 locator 与 BDD locator 审查冲突 | 审查范围膨胀 | POM 内部 CSS 允许保留，仅审查 spec 文件中的直接 locator |
| 防御性 catch 改为 test.skip 后暴露真实失败 | 测试数减少 | 可接受——BDD 的价值之一 |
| 中文 locale 对 getByRole name 匹配 | 角色匹配困难 | zh-CN 下 `getByRole("heading", { name: "..." })` 需用中文名 |

## 10. 标杆经验（从 firefly/pew 改造中沉淀）

### 10.1 已验证的最佳实践

| 实践 | 来源 | 说明 |
|------|------|------|
| Route-mock 集中到 fixtures.ts | pew 标杆 | 避免 mock 数据散落各 spec |
| emptyDataGate + test.skip | firefly 标杆 | 替代 `.isVisible().catch(() => false)` + `expect(x\|\|y).toBe(true)` |
| expectPathname 集中化 | firefly 修正 | 避免 helper 在 8 个文件中重复（firefly 教训） |
| 死代码及时删除 | pew 修正 | 定义但未使用的 fixture export（gotoAdmin/emptyDataGate）必须删除 |
| `page.getByRole("dialog")` | pew 修正 | 不要用 `page.locator('[role="dialog"]')` 替代 |
| Stage 1/2 三阶段 config | firefly/pew 共识 | 并存期 testMatch 同时覆盖旧新，完成后收敛 |

### 10.2 已知陷阱

| 陷阱 | 项目 | 说明 |
|------|------|------|
| Phase 2.3+ 漏加步骤注释 | firefly | 后期 phase 容易忘记 `// Given:` / `// When:` / `// Then:`，需要 review 时逐文件检查 |
| expectPathname 重复 8 次 | firefly | 多文件共用的 helper 必须第一时间提取到 fixtures |
| test 数静态计数 vs 运行时 | pew | 参数化循环（for...of 生成 test）在 `grep` 中计数少于实际运行数，文档用 grep 数，验收用运行数 |
| gotoAdmin 导出但从未调用 | firefly + pew | 不要"预留" fixture，用到再导出 |

## 11. 验收标准

- [ ] §1.2 / §3 的数字与 §9.1 验证命令的输出完全一致
- [ ] 所有原 94 个测试的行为覆盖被保留（按 §3 合并表追溯）
- [ ] 每个目标 spec commit body 含 "旧 test 名 → 新 scenario 名" 全量映射表
- [ ] 所有 test 名称符合 Given/When/Then 格式，无残留 E2E-XX 编号
- [ ] 所有 test 包含 `// Given:` / `// When:` / `// Then:` 步骤注释
- [ ] 所有 `describe` 使用 `Feature: <...>` 前缀
- [ ] 所有 selector 符合 §2.5 优先级，CSS fallback 必须有解释注释
- [ ] BDD fixtures 继承现有 `fixtures/base.ts`，不重复实现 navigateTo/loginAs
- [ ] 7 个 Page Objects 保持不变（POM 内部 locator 不强制审查）
- [ ] 防御性 `.isVisible().catch()` 模式全部消除
- [ ] 条件跳过统一为 `test.skip(condition, "reason")` 或 `emptyDataGate`
- [ ] stateful CRUD 保持 `test.describe.serial`
- [ ] Playwright 4 个 projects 正确匹配 BDD 目录
- [ ] `bun run typecheck` / `bun run lint` 通过
- [ ] `bunx playwright test --list` 输出包含全部新 spec
- [ ] `bun run test:e2e:browser` + `bun run test:e2e:admin` 全量通过（或等价地，`bun run test:e2e:bdd` 一键通过）
- [ ] `package.json` 有 `test:e2e:bdd` 别名，且语义为 forum + admin 全量
- [ ] 旧 `tests/e2e/*.spec.ts` 和 `tests/e2e/admin/*.spec.ts` 完全删除
- [ ] L1 覆盖率门限不变（95/90/95/95）
