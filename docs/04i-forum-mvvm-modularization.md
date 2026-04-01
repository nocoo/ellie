# 04i — 论坛前端 MVVM 模块化优化

> 修复现有 MVVM 架构中的层间泄漏、类型冲突和重复代码问题，提取共享模块，统一约定。
>
> **前置依赖**：04b（前端架构选型）、04d（论坛前端）

---

## 概览

当前论坛前端已实现清晰的三层 MVVM 分离（`*.ts` 纯逻辑 + `*.server.ts` 服务端加载 + `use-*.ts` Hook），本方案不做大手术，聚焦于：

1. 修复 P0 架构问题（接口重名、构建安全缺失）
2. 标记写路径割裂问题并明确前置依赖（需 04g 认证链路先完成）
3. 将散落在组件中的业务逻辑下沉到 ViewModel 层
4. 消除层间反向依赖和重复定义
5. 提取 `viewmodels/shared/` 共享模块统一约定
6. 改善 Loader 返回类型的可空安全性

---

## 现状架构

```
Page (RSC)
  │
  ├── viewmodels/forum/*.server.ts   ← forumApi → Worker
  │       │
  │       └── viewmodels/forum/*.ts  ← 纯逻辑：enrich / format / validate
  │
  └── components/forum/*             ← View 层：props 接收、渲染
```

**已做对的事（不破坏）**：

| 优势 | 说明 |
|------|------|
| ViewModel 三文件分离 | `*.ts` + `*.server.ts` + `use-*.ts` 职责清晰 |
| RSC-first | 14/25 组件为 Server Component，无客户端数据请求 |
| 零全局状态 | 无 Redux/Zustand，服务端构建 VM + props 传递 |
| Pure 函数可测试 | 所有 `.ts` 文件无副作用 |
| VM 零互相依赖 | 各领域 VM 完全隔离 |

---

## Phase 1 — P0 架构修复

### 1.1 解决 `ThreadDetailData` 接口重名

**问题**：`thread-detail.ts` 和 `thread-detail.server.ts` 各自定义了同名但字段完全不同的 `ThreadDetailData`。

**修改文件**：

| 文件 | 变更 |
|------|------|
| `src/viewmodels/forum/thread-detail.server.ts` | `ThreadDetailData` → `ThreadDetailPageData` |
| `src/app/(forum)/threads/[id]/page.tsx` | 类型引用同步更新 |

### 1.2 所有 `.server.ts` 添加 `import "server-only"` guard

**问题**：8 个 `.server.ts` 中仅 2 个有 `import "server-only"` guard，其余依赖文件名约定。客户端误引入将在运行时（而非构建时）暴露。

**修改文件**（6 个缺失 guard 的文件）：

| 文件 | 变更 |
|------|------|
| `src/viewmodels/forum/digest.server.ts` | 添加 `import "server-only"` |
| `src/viewmodels/forum/forum-list.server.ts` | 同上 |
| `src/viewmodels/forum/search.server.ts` | 同上 |
| `src/viewmodels/forum/thread-detail.server.ts` | 同上 |
| `src/viewmodels/forum/thread-list.server.ts` | 同上 |
| `src/viewmodels/forum/user-profile.server.ts` | 同上 |

### 1.3 记录写路径割裂问题（不在本文档落地）

**问题**：`post-editor.ts` 的 `submitPost()` 直接调用 `@ellie/repositories`，是全站唯一绕过 HTTP API 层的写操作。读走 `forumApi`（Key A，无用户身份），写走 Repo 直连 — 路径割裂。

**当前无法落地的原因**：

1. **forumApi 无 JWT 能力** — `forum-api.ts` 仅注入 `X-API-Key`，没有携带论坛用户 JWT 的机制。Worker 的 `POST /api/v1/threads` 和 `POST /api/v1/posts` 要求用户认证。
2. **发帖/回帖 UI 未接入** — `new-thread-form.tsx` 的 `onSubmit` 是空函数（`() => {}`），`canSubmit={false}`。`threads/[id]/page.tsx` 页面没有回帖编辑器。
3. **`use-post-editor.ts`** 在客户端调用 `createRepositories()`，这个调用链在当前架构下实际上无法工作（repos 需要 D1 数据库绑定）。

**前置依赖**：04g（用户登录与注册 — JWT 认证链路）完成后，需要：
- 为 `forumApi` 添加 JWT 注入能力（或新建 `authedForumApi` 封装）
- 在页面层获取用户 session/JWT，传递给 Server Action
- 接入真实的发帖/回帖 UI

**当前处理**：本阶段仅做代码卫生清理 — 将 `post-editor.ts` 中的 `submitPost` 和 `@ellie/repositories` 依赖标记为 `@deprecated`，在函数 JSDoc 中注明 "待 04g 认证链路完成后迁移到 HTTP API 层"。不新建 `post-editor.server.ts`，不改动 `use-post-editor.ts`。

---

## Phase 2 — MVVM 违规修正

### 2.1 业务逻辑从组件下沉到 ViewModel

| 组件源 | 函数 | 目标 VM |
|--------|------|---------|
| `components/forum/forum-card.tsx` | `parseModerators()` | → `viewmodels/forum/forum-list.ts` |
| `components/forum/forum-card.tsx` | `formatDate()` | → `viewmodels/shared/formatting.ts`（Phase 3.3 一并处理） |
| `components/forum/page-pagination.tsx` | `generatePageNumbers()` | → `viewmodels/shared/pagination.ts`（Phase 3.2 一并处理） |
| `components/forum/thread-item.tsx` | `getThreadIconSrc()` | → `viewmodels/forum/thread-list.ts` |
| `components/forum/forum-group.tsx` + `forum-panel.tsx` | `GRID_THRESHOLD = 10` | → `viewmodels/forum/forum-list.ts`（定义一次） |

> 注：`generatePageNumbers` 和 `formatDate` 的实际迁移分别在 Phase 3.2（提交 5）和 Phase 3.3（提交 6）中完成，因为它们直接进入对应的 shared 模块。提交 8 仅处理上表中剩余的 3 项。

### 2.2 消除 ViewModel → Component 反向依赖

**问题**：`messages.ts` 和 `new-thread.ts` 从 `@/components/layout/breadcrumbs` 导入 `BreadcrumbItem` 类型，形成 VM → Component 的反向依赖。

**方案**：仅抽取 `BreadcrumbItem` **类型定义**到 shared 层。`lib/forum-breadcrumbs.ts` 的 builder 函数保留原位不动 — 它被 `forums/[id]/page.tsx`、`threads/[id]/page.tsx`、`users/[id]/page.tsx` 和 `tests/unit/lib/forum-breadcrumbs.test.ts` 共 4 处直接导入，全部搬迁改动面过大且无收益。

| 文件 | 变更 |
|------|------|
| `src/viewmodels/shared/breadcrumbs.ts` | **新建**，仅导出 `BreadcrumbItem` 类型定义 |
| `src/viewmodels/forum/messages.ts` | 改为从 `@/viewmodels/shared/breadcrumbs` 导入类型 |
| `src/viewmodels/forum/new-thread.ts` | 同上 |
| `src/components/layout/breadcrumbs.tsx` | 改为从 `@/viewmodels/shared/breadcrumbs` 导入类型 |
| `src/lib/forum-breadcrumbs.ts` | 改为从 `@/viewmodels/shared/breadcrumbs` 导入类型（**保留文件**，不删除） |
| `tests/unit/lib/forum-breadcrumbs.test.ts` | 无需修改（测试仍从 `lib/forum-breadcrumbs` 导入 builder 函数） |

### 2.3 消除 `vm ?? buildXxxViewModel()` 组件自构造

**问题**：`forum-header`、`home-footer`、`site-footer`、`messages-page` 四个组件接受可选 VM prop 并在内部自行构造 fallback VM，违反"View 不应构造自己的 ViewModel"原则。

**方案**：将 VM 改为必传 props。当前 `<ForumHeader />` 和 `<SiteFooter />` 的真正渲染位置是 `components/forum/forum-layout.tsx`（`ForumLayoutShell`），而非 `(forum)/layout.tsx`。需要将 VM 构建放在 `(forum)/layout.tsx`（RSC），通过 `ForumLayoutShell` 透传到子组件。

| 文件 | 变更 |
|------|------|
| `src/components/forum/forum-header.tsx` | `vm?: HeaderViewModel` → `vm: HeaderViewModel` |
| `src/components/forum/home-footer.tsx` | `vm?: HomeFooterViewModel` → `vm: HomeFooterViewModel` |
| `src/components/forum/site-footer.tsx` | `vm?: GlobalFooterViewModel` → `vm: GlobalFooterViewModel` |
| `src/components/forum/messages-page.tsx` | `vm?: MessagesPageViewModel` → `vm: MessagesPageViewModel` |
| `src/components/forum/forum-layout.tsx` | Props 增加 `headerVm: HeaderViewModel` + `footerVm: GlobalFooterViewModel`，透传给 `<ForumHeader vm={headerVm} />` 和 `<SiteFooter vm={footerVm} />` |
| `src/app/(forum)/layout.tsx` | 构建 header + footer VM，传递给 `<ForumLayoutShell headerVm={...} footerVm={...}>` |
| `src/app/(forum)/page.tsx` | 构建 home-footer VM 并传递 |
| `src/app/(forum)/messages/page.tsx` | 构建 messages VM 并传递 |

### 2.4 `highlightStyle` 去除 React 类型依赖

**问题**：`thread-list.ts`（纯逻辑层）的 `highlightStyle()` 返回 `React.CSSProperties`，引入 React 框架耦合。

| 文件 | 变更 |
|------|------|
| `src/viewmodels/forum/thread-list.ts` | 返回类型改为 `Record<string, string>`，组件端按需断言 |

---

## Phase 3 — 提取共享模块

### 3.1 新建 `viewmodels/shared/` 目录

```
src/viewmodels/shared/
├── breadcrumbs.ts      # BreadcrumbItem 类型定义（仅类型，builder 留在 lib/forum-breadcrumbs.ts）
├── pagination.ts       # PaginatedResult<T> 类型 + generatePageNumbers()
├── formatting.ts       # formatDate / formatTime / formatRelativeTime 统一实现
└── params.ts           # parseIntParam / parsePageParam URL 参数安全解析
```

### 3.2 统一 `PaginatedResult<T>`

**问题**：`digest.server.ts`、`search.server.ts`、`user-profile.server.ts` 各自复制粘贴了 `PaginatedResult<T>` 接口定义。

| 文件 | 变更 |
|------|------|
| `src/viewmodels/shared/pagination.ts` | 导出统一的 `PaginatedResult<T>` + `EMPTY_PAGE<T>()` 工厂 |
| `src/viewmodels/forum/digest.server.ts` | 删除本地定义，从 shared 导入 |
| `src/viewmodels/forum/search.server.ts` | 同上 |
| `src/viewmodels/forum/user-profile.server.ts` | 同上 |

### 3.3 统一日期格式化

**问题**：同类日期格式化散布在 4 个位置，实现不一致：
- `thread-detail.ts` — 手写 `YYYY-M-D` 无零填充
- `thread-list.ts` — `formatTime()` 中文相对时间
- `user-profile.ts` — `toLocaleDateString("zh-CN")` 有零填充
- `forum-card.tsx` — 组件内自定义 `formatDate()`

| 文件 | 变更 |
|------|------|
| `src/viewmodels/shared/formatting.ts` | 导出 `formatDate()` / `formatDateTime()` / `formatRelativeTime()` 统一实现 |
| `src/viewmodels/forum/thread-detail.ts` | 删除本地 `formatDate`，从 shared 导入 |
| `src/viewmodels/forum/thread-list.ts` | `formatTime` 改为调用 shared `formatRelativeTime` |
| `src/viewmodels/forum/user-profile.ts` | 删除本地格式化，从 shared 导入 |
| `src/components/forum/forum-card.tsx` | 删除本地 `formatDate`，从 shared 导入 |

### 3.4 统一 API 错误类型

**问题**：`ApiError`（`api-client.ts`）、`AdminApiError`（`admin-api.ts`）、`ForumApiError`（`forum-api.ts`）结构相同但独立定义。

| 文件 | 变更 |
|------|------|
| `src/lib/api-error.ts` | **新建**，导出统一的 `ApiError` 基类 |
| `src/lib/api-client.ts` | 删除本地 `ApiError`，从 `api-error.ts` 导入 |
| `src/lib/admin-api.ts` | 删除本地 `AdminApiError`，从 `api-error.ts` 导入（可 `extends` 或直接复用） |
| `src/lib/forum-api.ts` | 删除本地 `ForumApiError`，同上 |

### 3.5 Loader 返回类型可空化 + Result 模式

**问题**：`threads/[id]/page.tsx` 在 catch block 使用 `null as unknown as Thread` 这种不安全的类型断言。根本原因是 `ThreadDetailPageData.thread: Thread` 不允许 null，page 只能强制转型。（注：`ThreadListPagedData.forum` 已经是 `ForumTreeNode | null`，无需修改。）

**方案**：

**Step A — Loader 返回类型可空化**：

| 文件 | 变更 |
|------|------|
| `src/viewmodels/forum/thread-detail.server.ts` | `ThreadDetailPageData.thread: Thread` → `Thread \| null` |

**Step B — Page 错误处理适配**：

| 文件 | 变更 |
|------|------|
| `src/app/(forum)/threads/[id]/page.tsx` | catch 中 `data = { thread: null, ... }` — 合法赋值；render 层 `if (!data.thread)` 显示 error |

**不做的事**：不导出 `EMPTY_*` 常量。让 page 直接写 `{ thread: null, posts: [], ... }` 更显式，TypeScript 会在字段变更时报错。

### 3.6 URL 参数解析统一

**问题**：每个 page 独立做 `Number.parseInt(id, 10)` + `Math.max(1, ...)` 解析。

| 文件 | 变更 |
|------|------|
| `src/viewmodels/shared/params.ts` | 导出 `parseIntParam(raw, fallback)` / `parsePageParam(raw)` |
| 各 `page.tsx` | 替换内联解析调用 |

---

## Phase 4 — 组件提取与布局整理

### 4.1 抽取 `users/[id]/page.tsx` 内联子组件

**问题**：`UserInfoCard`、`ThreadsTab`、`PostsTab` 三个子组件（~180 行）定义在 page 文件内。

| 新文件 | 来源 |
|--------|------|
| `src/components/forum/user-info-card.tsx` | 从 `users/[id]/page.tsx` 抽取 |
| `src/components/forum/user-threads-tab.tsx` | 同上 |
| `src/components/forum/user-posts-tab.tsx` | 同上 |

### 4.2 面包屑计算统一到 VM loader

**问题**：`forums/[id]/page.tsx` 和 `threads/[id]/page.tsx` 在 page 中自行计算面包屑，而 `new-thread.server.ts` 已在 loader 中完成。不一致。

| 文件 | 变更 |
|------|------|
| `src/viewmodels/forum/thread-list.server.ts` | `loadThreadListPaged` 返回值增加 `breadcrumbs` 字段 |
| `src/viewmodels/forum/thread-detail.server.ts` | `loadThreadDetail` 返回值增加 `breadcrumbs` 字段 |
| `src/app/(forum)/forums/[id]/page.tsx` | 使用 VM 返回的 `breadcrumbs`，删除内联计算 |
| `src/app/(forum)/threads/[id]/page.tsx` | 同上 |

---

## 目标架构

```
src/viewmodels/
├── shared/                          ← 新增
│   ├── breadcrumbs.ts               # BreadcrumbItem 类型定义（仅类型）
│   ├── pagination.ts                # PaginatedResult<T> + generatePageNumbers
│   ├── formatting.ts                # 统一 formatDate / formatTime / formatRelativeTime
│   └── params.ts                    # URL 参数安全解析
├── forum/
│   ├── forum-list.ts                # + parseModerators + GRID_THRESHOLD
│   ├── forum-list.server.ts         # + import "server-only"
│   ├── thread-list.ts               # highlightStyle 返回 Record<string, string>
│   ├── thread-list.server.ts        # + breadcrumbs 预计算（forum 已可空，无需修改）
│   ├── thread-detail.ts             # ThreadDetailData（展示模型，保留）
│   ├── thread-detail.server.ts      # → ThreadDetailPageData + breadcrumbs，thread 可空
│   ├── post-editor.ts               # submitPost 标记 @deprecated（待 04g）
│   ├── use-post-editor.ts           # 保持不变（待 04g）
│   └── ...                          # 其余保持不变
└── admin/
    └── ...                          # 不在本次范围

src/lib/
├── forum-breadcrumbs.ts             # 保留，builder 函数不搬迁
├── api-error.ts                     # 新增，统一 API 错误基类
└── ...
```

**依赖方向（严格单向）**：

```
Page ──→ ViewModel.server ──→ ViewModel.pure ──→ @ellie/types
  │                │                │
  │                └── lib/*        └── viewmodels/shared/*
  │
  └──→ Component ←─ (props from Page)
           │
           └──→ components/ui/* (shadcn)
```

禁止的依赖方向：
- ~~Component → ViewModel.server~~ （组件不直接调用 server loader）
- ~~ViewModel → Component~~ （VM 不导入组件层任何内容）
- ~~ViewModel.pure → lib/forum-api~~ （纯逻辑层不做 I/O）

---

## 原子化提交计划

| 序号 | Commit | 涉及文件 | 验证 |
|------|--------|----------|------|
| 1 | ✅ `fix: rename ThreadDetailData to ThreadDetailPageData in server loader` | `thread-detail.server.ts`, `threads/[id]/page.tsx` | `bun run typecheck` |
| 2 | ✅ `refactor: add server-only guard to all .server.ts files` | 6 个 `.server.ts` 文件 | `bun run typecheck` |
| 3 | ✅ `refactor: deprecate post-editor direct repository access` | `post-editor.ts` — 添加 `@deprecated` JSDoc | `bun run typecheck` |
| 4 | ✅ `refactor: extract shared BreadcrumbItem type` | 新建 `shared/breadcrumbs.ts`，修改 `messages.ts`、`new-thread.ts`、`breadcrumbs.tsx`、`lib/forum-breadcrumbs.ts`（改导入源，不删除） | `bun run typecheck` + `bun test tests/unit/` |
| 5 | ✅ `refactor: extract shared pagination module` | 新建 `shared/pagination.ts`（含 `PaginatedResult<T>` + `generatePageNumbers()`），修改 3 个 `.server.ts`（删本地 `PaginatedResult`），修改 `page-pagination.tsx`（删本地 `generatePageNumbers`，改从 shared 导入），修改 `tests/unit/components/forum/page-pagination.test.ts`（导入路径更新） | `bun run typecheck` + `bun test tests/unit/` |
| 6 | ✅ `refactor: extract shared formatting module` | 新建 `shared/formatting.ts`，修改 `thread-detail.ts`、`thread-list.ts`、`user-profile.ts`、`forum-card.tsx` | `bun test tests/unit/` |
| 7 | ✅ `refactor: extract shared URL params module` | 新建 `shared/params.ts`，修改各 `page.tsx` | `bun run typecheck` |
| 8 | ✅ `refactor: move remaining business logic from components to viewmodels` | `forum-card.tsx`（`parseModerators`）、`thread-item.tsx`（`getThreadIconSrc`）、`forum-group.tsx` + `forum-panel.tsx`（`GRID_THRESHOLD`）→ 对应 VM | `bun run typecheck` |
| 9 | ✅ `refactor: make VM props required, remove self-construction fallback` | 4 个组件（`forum-header`、`home-footer`、`site-footer`、`messages-page`） + `forum-layout.tsx`（增加 VM props 透传） + `(forum)/layout.tsx`（构建 VM） + `page.tsx` + `messages/page.tsx` | `bun run typecheck` |
| 10 | ✅ `refactor: remove React.CSSProperties from pure viewmodel` | `thread-list.ts` | `bun run typecheck` |
| 11 | ✅ `refactor: unify API error types` | 新建 `lib/api-error.ts`，修改 3 个 API 客户端 | `bun test apps/worker` |
| 12 | ✅ `refactor: make ThreadDetailPageData.thread nullable for error safety` | `thread-detail.server.ts`（thread 可空）、`threads/[id]/page.tsx`（删除 `as unknown as` 强转） | `bun run typecheck` |
| 13 | ✅ `refactor: move breadcrumb computation into VM loaders` | `thread-list.server.ts`、`thread-detail.server.ts`、对应 page（page 不再自行计算） | `bun run typecheck` |
| 14 | ✅ `refactor: extract user profile sub-components` | 新建 3 个组件文件，修改 `users/[id]/page.tsx` | `bun run typecheck` |

---

## 测试策略

| 层 | 内容 | 命令 |
|----|------|------|
| **L1 单元测试** | 新增 shared 模块测试：`formatting.test.ts`、`pagination.test.ts`、`params.test.ts` | `bun test tests/unit/` |
| **G1 类型检查** | 每次 commit 必须通过 | `bun run typecheck` |
| **L1 现有测试** | 确保 `avatar.test.ts`、`forum-breadcrumbs.test.ts` 及 worker 测试不回归 | `bun test tests/unit/` + `bun test apps/worker` |
