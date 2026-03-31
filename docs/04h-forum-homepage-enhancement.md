# 04h — 论坛框架与首页增强计划

> 对论坛导航、面包屑、帖子列表页和发帖/回帖交互进行功能增强。
>
> **前置依赖**：04d（论坛前端）、04f（UI 重写）、04e（高级功能 — 编辑器）、04g（用户登录与注册）、05（Worker API）

---

## 概览

本文档覆盖 4 个功能领域，按优先级排列：

| 领域 | 功能 | 影响范围 |
|------|------|----------|
| §1 | 用户面板/弹出菜单 | Navbar `AuthControls` |
| §2 | 面包屑增强 | 全站面包屑 |
| §3 | 帖子列表页增强 | `/forums/[id]` 页面 + Worker API |
| §4 | 发帖/回帖系统 | 新建页面 + 帖子详情页 + Auth + Worker API |

---

## §1 用户面板/弹出菜单

### 现状

Navbar 右侧仅显示 `session.user.name`（截断 100px）+ 登出图标。登录态来自 NextAuth v5 `useSession()`。

**关键缺陷**：当前 `auth.ts` 只配置了 Google OAuth provider（用于 Admin），论坛用户的 Credentials provider 尚未注册。登录页 `signIn("credentials", ...)` 调用会静默失败。

### 目标

登录用户 hover/click 用户名时弹出面板，展示个人信息和快捷操作。

### 设计

```
┌─────────────────────────┐
│  [Avatar]  Username     │
│  Lv.3  用户组头衔        │
├─────────────────────────┤
│  主题: 42    帖子: 156   │
│  积分: 1,280             │
├─────────────────────────┤
│  📄  我的帖子            │
│  👤  个人资料            │
├─────────────────────────┤
│  🚪  退出登录            │
└─────────────────────────┘
```

### 前置条件

**依赖 04g（用户注册与登录）**：NextAuth Credentials Provider、Worker JWT 透传、session 扩展均在 04g 中定义。04g 完成后，本节所需的 `session.user` 字段（id, name, role）即可使用。

用户面板需要额外的用户详情（积分、头衔、帖子数等），通过 `GET /api/v1/auth/me` 获取，或在 04g 的 session callback 中扩展。

### 文件变更

| 文件 | 变更 |
|------|------|
| `apps/web/src/auth.ts` | 添加 Credentials provider，扩展 jwt/session callback |
| `apps/web/src/components/forum/user-popover.tsx` | **新建** — 用户弹出面板组件 |
| `apps/web/src/components/forum/forum-navbar.tsx` | `AuthControls` 替换为 `<UserPopover>` |

### 组件规格

**`UserPopover`**

- 触发方式：桌面端 hover（`onMouseEnter/Leave` + 延迟关闭 200ms），移动端 click
- 使用 shadcn `Popover` 组件
- 数据源：`useSession()` — 从扩展后的 session 读取所有字段，无需额外 API 调用
- 头像：复用 `UserAvatar` 组件（CDN 路径 + fallback）
- "我的帖子" → `/users/{id}?tab=threads`
- "个人资料" → `/users/{id}`
- "退出登录" → `signOut()` from `next-auth/react`

---

## §2 面包屑增强

### 现状

当前面包屑结构：`首页 > 版块A > 版块B > 当前页`

- `首页` 是纯文字链接，无图标
- 没有站点名称层级
- 构建函数在 `src/lib/forum-breadcrumbs.ts`，三个 builder 函数均以 `{ label: "首页", href: "/" }` 开头

### 目标

面包屑增加 Home 图标和站点名称作为第 0、1 级：

```
🏠 > 同济网 > 版块A > 版块B > 当前页
```

### 设计

| 层级 | 内容 | 链接 | 说明 |
|------|------|------|------|
| 0 | `Home` 图标（Lucide `House`，14×14） | `/` | 替代原来的"首页"文字 |
| 1 | 站名（"同济网"） | `/` | 站名可配置，通过 env `NEXT_PUBLIC_SITE_NAME` 或 fallback 硬编码 |
| 2+ | 原有层级 | 不变 | 版块祖先链 → 当前页 |

### 文件变更

| 文件 | 变更 |
|------|------|
| `apps/web/src/lib/forum-breadcrumbs.ts` | 修改三个 builder 函数，第 0 项改为 `{ label: "🏠", href: "/" }`（icon 占位符），插入第 1 项 `{ label: siteName, href: "/" }` |
| `apps/web/src/components/layout/breadcrumbs.tsx` | 识别第 0 项 icon 占位符，渲染 Lucide `House` 图标代替文字 |

### 具体改动

**`forum-breadcrumbs.ts`**

```typescript
const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME ?? "同济网";

// 统一前缀
const HOME_PREFIX: BreadcrumbItem[] = [
  { label: "__home_icon__", href: "/" },  // 特殊标记，组件中渲染为图标
  { label: SITE_NAME, href: "/" },
];
```

三个 builder 函数均替换原来的 `{ label: "首页", href: "/" }` 为 `...HOME_PREFIX`。

**`breadcrumbs.tsx`**

渲染时检测 `item.label === "__home_icon__"`，输出 `<House className="h-3.5 w-3.5" />` 替代文字。

### 视觉效果

```
桌面端:  🏠 › 同济网 › 校园生活 › 同济灌水 › 帖子标题
移动端:  🏠 › 同济网 › ... › 帖子标题（面包屑可横向滚动或折叠中间层级）
```

---

## §3 帖子列表页增强

### 现状

`/forums/[id]` 页面当前功能：
- 面包屑 + 版块标题/描述 + 子版块面板
- 帖子列表（经典 4 列） + 分页器
- 排序固定为 `ORDER BY sticky DESC, last_post_at DESC`
- 无筛选、无分类、无发帖按钮、无版规展示

### 目标

补全 5 项功能：分类筛选、排序选项、帖子类型筛选、公告/全局置顶、版规/规则展示、发帖按钮。

### §3.1 版规/规则展示

#### 数据层

Forum 表当前无 `rules` 字段。方案：

**方案 A（推荐）**：复用现有 `description` 字段。目前 `description` 已在版块标题下方展示，许多版块的 description 本身就包含版规内容。不加新字段，将现有 description 展示区改为可折叠：

```
┌────────────────────────────────────────────────┐
│  📋 版块介绍与版规                    [展开 ▼]  │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─   │
│  （折叠时隐藏正文，只显示标题行）                 │
│  展开后显示 description 的完整 HTML 内容         │
└────────────────────────────────────────────────┘
```

**方案 B**：新增 `rules` TEXT 字段到 forums 表 + D1 migration。Admin 后台加编辑入口。首页展示为独立折叠区块。

#### 前端组件

新建 `ForumRulesPanel` 组件：
- 默认折叠，点击标题行展开
- `localStorage` 记忆每个 forum 的折叠状态 key: `forum-rules-{forumId}`
- 内容通过 `SafeHtml` 组件渲染（已有 HTML 净化器）

### §3.2 分类筛选 + 帖子类型筛选

#### 数据分析

- `threads.type_name` 字段存在于 DB schema，类型为 TEXT
- 这是从 DZ 迁移来的帖子分类标签（如"求助""分享""讨论"等）
- 当前 Worker `GET /api/v1/threads` **不支持** `typeName` 筛选参数

#### 方案

**Step 1 — Worker API 增强**

`GET /api/v1/threads` 增加查询参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| `typeName` | string | 精确匹配 `type_name` 字段 |
| `digest` | `0 \| 1 \| 2 \| 3` | 精确匹配 `digest` 字段；传 `1+` 表示任意精华 |
| `sticky` | `0 \| 1 \| 2 \| 3` | 精确匹配 `sticky` 字段 |
| `closed` | `0 \| 1` | 精确匹配 `closed` 字段 |

SQL 拼接为 `WHERE forum_id = ? AND type_name = ? AND ...` 按需追加条件。

**Step 2 — 获取版块可用分类**

新增 Worker 端点：`GET /api/v1/forums/:id/type-names`

```json
// Response
{ "typeNames": ["求助", "分享", "讨论", "公告", ""] }
```

实现：`SELECT DISTINCT type_name FROM threads WHERE forum_id = ? AND type_name != '' ORDER BY type_name`

**Step 3 — 前端筛选栏**

在帖子列表表头上方添加筛选/工具栏：

```
┌────────────────────────────────────────────────────────────────┐
│  [全部] [求助] [分享] [讨论] ...    │  筛选: [全部▾] [精华▾]  │ [+ 发新帖]  │
│  ← 分类标签 (pill buttons) →        │  ← 下拉筛选 →           │             │
└────────────────────────────────────────────────────────────────┘
```

组件结构：

```
<ThreadListToolbar>
  <TypeNameTabs />      — pill 按钮组，点击切换 typeName 筛选
  <ThreadFilters />     — 下拉菜单：精华/置顶/关闭 筛选
  <NewThreadButton />   — 链接到 /threads/new?forumId=X
</ThreadListToolbar>
```

- 筛选状态通过 URL searchParams 管理：`?typeName=求助&digest=1`
- 切换筛选时重置到第 1 页

### §3.3 排序选项

#### Worker API 增强

`GET /api/v1/threads` 增加 `sort` 参数：

| sort 值 | SQL ORDER BY | 说明 |
|---------|-------------|------|
| `latest`（默认） | `sticky DESC, last_post_at DESC, id DESC` | 最新回复 |
| `newest` | `sticky DESC, created_at DESC, id DESC` | 最新发帖 |
| `hot` | `sticky DESC, replies DESC, id DESC` | 最多回复 |
| `views` | `sticky DESC, views DESC, id DESC` | 最多查看 |

**注意**：所有排序均保留 `sticky DESC` 前缀，确保置顶帖始终在顶部。

#### 前端

在 `<ThreadFilters>` 中添加排序下拉：

```
排序: [最新回复 ▾]
       ├ 最新回复
       ├ 最新发帖
       ├ 最多回复
       └ 最多查看
```

URL 参数：`?sort=newest`

### §3.4 公告/全局置顶帖

#### 现状分析

- `StickyLevel`: `None=0, Forum=1, Global=2, Category=3`
- 当前 Worker 查询 `WHERE forum_id = ?` — 全局置顶帖（sticky=2）只会出现在其原始 `forum_id` 的列表中
- Discuz 行为：全局置顶帖应在**所有版块**的帖子列表顶部显示

#### 方案

**Step 1 — Worker 行为修改**

`GET /api/v1/threads?forumId=X` 的查询逻辑改为：

```sql
-- 1. 全局置顶帖（所有版块显示）
SELECT * FROM threads WHERE sticky = 2
UNION ALL
-- 2. 分区置顶帖（同分区版块显示 — 需要 forum 的 parent_id 信息）
SELECT * FROM threads WHERE sticky = 3 AND forum_id IN (同分区版块列表)
UNION ALL
-- 3. 本版块帖子（含本版置顶）
SELECT * FROM threads WHERE forum_id = ? AND sticky IN (0, 1)
ORDER BY sticky DESC, last_post_at DESC
```

**简化方案**（推荐先实现）：仅处理全局置顶（sticky=2），分区置顶暂不处理（DZ 迁移数据中分区置顶极少）。

```sql
SELECT * FROM threads
WHERE forum_id = :forumId OR sticky = 2
ORDER BY sticky DESC, last_post_at DESC, id DESC
```

**Step 2 — 前端视觉区分**

全局/分区置顶帖在列表中用不同背景色或顶部分隔线区分：

```
┌─ 全局置顶 ─────────────────────────────────┐
│ 📌 [全局置顶] 论坛公告：xxx               │
│ 📌 [全局置顶] 新版规发布                   │
├─ 本版帖子 ─────────────────────────────────┤
│ 📌 [置顶] 本版必读                        │
│    普通帖子 1                              │
│    普通帖子 2                              │
└────────────────────────────────────────────┘
```

### §3.5 发帖按钮

在工具栏右侧放置"发新帖"按钮：

- 未登录：点击跳转 `/login?redirect=/threads/new?forumId=X`
- 已登录：跳转 `/threads/new?forumId=X`
- 版块已关闭（closed=1）或无权限：按钮禁用，tooltip 提示原因

### 文件变更汇总

| 文件 | 变更 |
|------|------|
| `apps/worker/src/handlers/thread.ts` | `list` 增加 `typeName`/`digest`/`sort`/`sticky`/`closed` 参数处理，修改全局置顶查询 |
| `apps/worker/src/handlers/forum.ts` | 新增 `getTypeNames` handler |
| `apps/worker/src/index.ts` | 注册 `GET /api/v1/forums/:id/type-names` 路由 |
| `apps/web/src/lib/forum-api.ts` | 新增 `fetchTypeNames()`，`fetchThreads()` 增加筛选/排序参数 |
| `apps/web/src/viewmodels/forum/thread-list.server.ts` | 数据加载增加 `typeName`/`digest`/`sort` 参数透传 |
| `apps/web/src/components/forum/thread-list-toolbar.tsx` | **新建** — 筛选/排序/发帖工具栏 |
| `apps/web/src/components/forum/forum-rules-panel.tsx` | **新建** — 版规展示折叠面板 |
| `apps/web/src/app/(forum)/forums/[id]/page.tsx` | 集成工具栏和版规面板 |

---

## §4 发帖与回帖系统

### 现状

- `PostEditor` 组件（Tiptap）已完整实现，含主题输入、工具栏、emoji picker
- `PostEditorViewModel` hook 已有 `canSubmit()` 和 `submitPost()` 逻辑
- Worker `POST /api/v1/threads` 和 `POST /api/v1/posts` 端点已实现，含审查词过滤
- **缺失**：前端页面（`/threads/new`）不存在，帖子详情页无回复入口

### 前置条件

1. §1 的 Credentials Provider 必须先完成 — 发帖需要 Worker JWT
2. NextAuth session 需暴露 `workerJwt` 给客户端（或通过 server action 代理）

### 架构决策：JWT 传递方式

**方案 A（推荐）— Server Action 代理**

```
Client → Server Action → 携带 workerJwt 调用 Worker API → 返回结果
```

- 优点：JWT 不暴露给浏览器，安全性高
- 适配 Next.js RSC 生态

**方案 B — 客户端直调**

```
Client → 直接携带 workerJwt 调用 Worker API
```

- 优点：实现简单
- 缺点：JWT 暴露在浏览器中

### §4.1 发新帖（`/threads/new`）

#### 页面结构

```
┌─────────────────────────────────────────────┐
│  面包屑: 🏠 › 同济网 › 版块名 › 发表新帖    │
├─────────────────────────────────────────────┤
│                                             │
│  发表新帖                                    │
│                                             │
│  帖子分类: [选择分类 ▾]  （可选）             │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  标题输入框                          │    │
│  ├─────────────────────────────────────┤    │
│  │  [B] [I] [U] [H2] [H3] ...  [😊]   │    │
│  ├─────────────────────────────────────┤    │
│  │                                     │    │
│  │  Tiptap 编辑器区域                   │    │
│  │  （最小高度 300px）                   │    │
│  │                                     │    │
│  ├─────────────────────────────────────┤    │
│  │  字数: 0 / 50,000     [发表帖子]     │    │
│  └─────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

#### 数据流

```
1. URL: /threads/new?forumId=123
2. RSC 加载: 获取 forum 信息（面包屑）+ type-names（分类下拉）
3. Client: PostEditor (thread mode) + 分类选择
4. Submit: Server Action → POST /api/v1/threads (携带 workerJwt)
5. 成功: redirect 到 /threads/{newId}
6. 失败: 显示错误消息（审查词/网络错误）
```

#### 权限

- 未登录 → redirect 到 `/login?redirect=/threads/new?forumId=X`
- 已登录 → 正常展示
- 版块不存在 → 404

### §4.2 回复帖子（帖子详情页集成）

#### 快速回复框

在帖子详情页底部（分页器下方）添加快速回复区域：

```
┌─────────────────────────────────────────────┐
│  回复帖子                                    │
│  ┌─────────────────────────────────────┐    │
│  │  [B] [I] [U] [链接] [😊]            │    │
│  ├─────────────────────────────────────┤    │
│  │                                     │    │
│  │  Tiptap 编辑器（最小高度 120px）      │    │
│  │                                     │    │
│  ├─────────────────────────────────────┤    │
│  │  字数: 0 / 50,000     [回复]         │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ⚠️ 帖子已关闭（closed=1 时显示，隐藏编辑器）  │
└─────────────────────────────────────────────┘
```

#### 条件显示

| 条件 | 行为 |
|------|------|
| 未登录 | 显示提示："请[登录](/login?redirect=当前URL)后回复" |
| 已登录 + 帖子未关闭 | 显示编辑器 |
| 已登录 + 帖子已关闭 | 显示灰色提示："此帖已关闭，无法回复" |
| 被封禁用户 | 显示提示："您的账号已被禁言" |

#### 数据流

```
1. Client: PostEditor (reply mode, 无标题输入)
2. Submit: Server Action → POST /api/v1/posts { threadId, content } (携带 workerJwt)
3. 成功: router.refresh() 刷新帖子列表（RSC 重新渲染），滚动到新回复
4. 失败: 显示错误消息
```

#### 回复后刷新策略

- 使用 `router.refresh()` 触发 RSC 重新获取数据 — 不需要手动拼接
- 如果当前不在最后一页，提示"回复已发布"并提供跳转到最后一页的链接

### §4.3 帖内回复/引用

帖子楼层的"回复"按钮功能：

1. 点击"回复" → 滚动到底部快速回复框
2. 自动插入引用格式到编辑器：

```html
<blockquote>
  <p><strong>username</strong> 发表于 2026-03-30 14:23</p>
  <p>被引用的内容前 200 字...</p>
</blockquote>
<p></p>  <!-- 光标定位到这里 -->
```

3. 使用 Tiptap 的 `editor.commands.setContent()` 插入引用块

### 文件变更汇总

| 文件 | 变更 |
|------|------|
| `apps/web/src/auth.ts` | 添加 Credentials provider（§1 前置） |
| `apps/web/src/app/(forum)/threads/new/page.tsx` | **新建** — 发帖页面（RSC） |
| `apps/web/src/app/(forum)/threads/new/new-thread-form.tsx` | **新建** — 发帖表单（客户端组件） |
| `apps/web/src/actions/thread.ts` | **新建** — `createThread` Server Action |
| `apps/web/src/actions/post.ts` | **新建** — `createPost` Server Action |
| `apps/web/src/app/(forum)/threads/[id]/page.tsx` | 集成快速回复框 |
| `apps/web/src/components/forum/quick-reply.tsx` | **新建** — 快速回复组件 |
| `apps/web/src/components/forum/post-action-bar.tsx` | "回复"按钮实现引用回复逻辑 |
| `apps/web/src/lib/forum-api.ts` | 新增 `createThread()`, `createPost()` 服务端调用 |
| `apps/web/proxy.ts` | 确认 `/threads/new` 路由保护正确 |

---

## 实施计划

### Phase 1 — 基础设施（前置）

| 步骤 | 内容 | 预估 |
|------|------|------|
| 1.1 | ~~NextAuth Credentials Provider + session 扩展~~ → **已移至 04g** | — |
| 1.2 | 面包屑增强（§2） | 小 |

### Phase 2 — 帖子列表增强

| 步骤 | 内容 | 预估 |
|------|------|------|
| 2.1 | Worker API: `sort` 参数 | 小 |
| 2.2 | Worker API: `typeName`/`digest`/`closed` 筛选 + `type-names` 端点 | 中 |
| 2.3 | Worker API: 全局置顶查询逻辑 | 小 |
| 2.4 | 前端: `ThreadListToolbar` 组件（筛选 + 排序 + 发帖按钮） | 中 |
| 2.5 | 前端: `ForumRulesPanel` 版规折叠面板 | 小 |

### Phase 3 — 发帖与回帖

| 步骤 | 内容 | 预估 |
|------|------|------|
| 3.1 | Server Actions: `createThread` + `createPost` | 中 |
| 3.2 | 发帖页面 `/threads/new` | 中 |
| 3.3 | 帖子详情页快速回复框 | 中 |
| 3.4 | 引用回复功能 | 小 |

### Phase 4 — 用户面板

| 步骤 | 内容 | 预估 |
|------|------|------|
| 4.1 | `UserPopover` 组件 | 小 |
| 4.2 | Navbar 集成 | 小 |

> **依赖链**：Phase 1.1 → Phase 3（全部）→ Phase 4.1
> **可并行**：Phase 1.2、Phase 2（全部）可独立进行

---

## 新建文件清单

| 文件 | 用途 |
|------|------|
| `apps/web/src/components/forum/user-popover.tsx` | 用户弹出面板 |
| `apps/web/src/components/forum/thread-list-toolbar.tsx` | 帖子列表工具栏 |
| `apps/web/src/components/forum/forum-rules-panel.tsx` | 版规折叠面板 |
| `apps/web/src/components/forum/quick-reply.tsx` | 快速回复组件 |
| `apps/web/src/app/(forum)/threads/new/page.tsx` | 发帖页面 |
| `apps/web/src/app/(forum)/threads/new/new-thread-form.tsx` | 发帖表单 |
| `apps/web/src/actions/thread.ts` | 发帖 Server Action |
| `apps/web/src/actions/post.ts` | 回帖 Server Action |

## 修改文件清单

| 文件 | 变更 |
|------|------|
| `apps/web/src/auth.ts` | ~~Credentials provider + session 扩展~~ → **已移至 04g** |
| `apps/web/src/lib/forum-breadcrumbs.ts` | Home icon + 站名 |
| `apps/web/src/components/layout/breadcrumbs.tsx` | Icon 渲染支持 |
| `apps/web/src/lib/forum-api.ts` | 新增 API 调用函数 |
| `apps/web/src/viewmodels/forum/thread-list.server.ts` | 筛选/排序参数透传 |
| `apps/web/src/components/forum/forum-navbar.tsx` | 集成 UserPopover |
| `apps/web/src/components/forum/post-action-bar.tsx` | 回复按钮功能实现 |
| `apps/web/src/app/(forum)/forums/[id]/page.tsx` | 集成工具栏 + 版规面板 |
| `apps/web/src/app/(forum)/threads/[id]/page.tsx` | 集成快速回复 |
| `apps/worker/src/handlers/thread.ts` | 筛选/排序/全局置顶 |
| `apps/worker/src/handlers/forum.ts` | type-names 端点 |
| `apps/worker/src/index.ts` | 新路由注册 |
