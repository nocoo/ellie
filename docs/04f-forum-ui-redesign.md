# 04f — 论坛前端 UI 重写

> 对论坛前端全部页面和组件进行 UI 重写，提升信息密度、视觉质量和响应式体验。
>
> **前置依赖**：04d（原始论坛前端设计）、04b（前端架构选型）
>
> **路径约定**：本文档所有文件路径相对于 `apps/web/`。例如 `src/hooks/use-theme.ts` 指 `apps/web/src/hooks/use-theme.ts`。

## 目标

1. **卡片化布局** — 全站使用 shadcn `Card` 组件体系
2. **极致纵向节约** — 合并导航栏、压缩行高、单行化信息展示
3. **响应式** — 360px / 768px / 1024px / 1440px 全覆盖
4. **主题色板变量化** — 提取论坛语义 CSS 变量，方便未来主题覆盖
5. **新功能：宽度切换** — 居中显示 ↔ 全屏宽度
6. **保持暗黑模式** — 右上角切换，已有实现不变

## 约束

| 约束 | 说明 |
|------|------|
| 不修改 `viewmodels/**/*.ts` | 纯逻辑层保持不变 |
| 不修改 `viewmodels/**/*.server.ts` | 服务端数据加载保持不变 |
| 不修改 `src/components/ui/**` | shadcn 基础组件不动 |
| 不修改 `src/components/admin/**` | Admin 相关代码不动 |
| 不修改 `src/lib/**` | API 层、导航配置、工具函数不动 |
| 不修改 `src/app/api/**` | API 代理路由不动 |
| 不修改 `(admin)/**` 页面 | Admin 页面不动 |
| 不修改 `use-theme.ts` / `use-is-mobile.ts` | 现有 hooks 不动 |
| 保持所有路由 | 路由结构、RSC 数据加载模式不变 |
| 中文 UI | 所有用户可见文本保持中文 |

---

## 文件清单

### 新建文件（3 个）

| 文件路径 | 用途 |
|----------|------|
| `src/hooks/use-width-mode.ts` | 宽度模式 hook（居中 ↔ 全屏），模式同 `use-theme.ts` |
| `src/components/width-toggle.tsx` | 宽度切换按钮，模式同 `theme-toggle.tsx` |
| `src/components/forum/keyset-pagination.tsx` | 提取 5 处重复的翻页组件为共享组件 |

### 重写文件（19 个）

**布局层（5 个）：**

| 文件路径 | 变更 |
|----------|------|
| `src/components/forum/forum-layout.tsx` | 移除 TopBar 引用，接入宽度模式，重构容器结构 |
| `src/components/forum/forum-navbar.tsx` | 合并 TopBar 功能，单栏导航（logo + nav + auth + toggles） |
| `src/components/forum/top-bar.tsx` | 废弃，返回 `null`（功能已合并到 ForumNavbar） |
| `src/components/forum/forum-breadcrumbs.tsx` | 移除独立栏，改为内容区内联渲染 |
| `src/components/forum/site-footer.tsx` | 移除内部 max-w 容器，压缩间距 |

**首页组件（2 个）：**

| 文件路径 | 变更 |
|----------|------|
| `src/components/forum/forum-group.tsx` | Card/CardHeader/CardContent + divide-y 行列表 |
| `src/components/forum/forum-card.tsx` | 从独立卡片变为密集行，全部信息单行展示 |

**帖子列表组件（2 个）：**

| 文件路径 | 变更 |
|----------|------|
| `src/components/forum/thread-item.tsx` | 单行密集行（标签+标题+作者+时间+统计同行） |
| `src/components/forum/thread-badge.tsx` | 微调：`px-1` + `leading-tight` |

> **注意**：`thread-list.tsx` 不再使用。当前它是客户端组件（onClick 排序），但 `forums/[id]/page.tsx` 是 RSC 页面，排序通过 searchParams 驱动。page.tsx 直接内联 ThreadItem + KeysetPagination，排序使用 `<Link>` 而非 onClick。`thread-list.tsx` 保留文件但标记为废弃（由 admin 侧可能仍有引用）。

**帖子详情组件（2 个）：**

| 文件路径 | 变更 |
|----------|------|
| `src/components/forum/post-card.tsx` | 去除 120px 侧边栏，作者信息变为内联头部行 |
| `src/components/forum/post-editor.tsx` | Card 包裹，min-height 160→120px |

**其他组件（1 个）：**

| 文件路径 | 变更 |
|----------|------|
| `src/components/forum/user-card.tsx` | 增加 `layout="inline"` 变体 |

**页面文件（7 个）：**

| 文件路径 | 变更 |
|----------|------|
| `src/app/(forum)/page.tsx` | 移除 h1/p 标题，space-y-6→4 |
| `src/app/(forum)/forums/[id]/page.tsx` | Card 包裹 header，RSC 内联 ThreadItem + KeysetPagination，排序用 Link |
| `src/app/(forum)/threads/[id]/page.tsx` | Card 包裹 header，使用 KeysetPagination |
| `src/app/(forum)/users/[id]/page.tsx` | 单 Card 包含 profile+tabs+空状态（API 暂不支持历史查询） |
| `src/app/(forum)/search/page.tsx` | Card 包裹搜索表单+结果+翻页 |
| `src/app/(forum)/digest/page.tsx` | 单 Card 包含标题+列表+翻页 |
| `src/app/(forum)/login/page.tsx` | 使用 shadcn Card/Input/Button/Label |

### 修改文件（2 个）

| 文件路径 | 变更 |
|----------|------|
| `src/app/layout.tsx` | 在 `<head>` 添加 `widthModeInitScript` |
| `src/app/tailwind.css` | 添加论坛语义 CSS 变量（纯增量） |

---

## 设计详情

### 1. CSS 变量扩展

在 `tailwind.css` 的 `:root` 和 `.dark` 中增加论坛语义变量（纯别名，引用现有 L0/L1/L2 体系）：

```css
:root {
  --forum-group-bg: var(--card);
  --forum-item-bg: var(--secondary);
  --forum-item-hover: var(--accent);
  --forum-header-bg: var(--card);
  --forum-nav-bg: var(--card);
  --forum-nav-border: var(--border);
  --content-max-width: 1200px;
  --content-px: 1rem;
}
```

在 `@theme inline` 中增加对应的 Tailwind 颜色映射：

```css
--color-forum-group: hsl(var(--forum-group-bg));
--color-forum-item: hsl(var(--forum-item-bg));
--color-forum-item-hover: hsl(var(--forum-item-hover));
```

**为何使用别名**：未来主题覆盖时，只需修改 `--forum-*` 变量即可改变论坛外观，无需改动基础设计系统。

### 2. 宽度切换 Hook

**文件**：`src/hooks/use-width-mode.ts`

与 `use-theme.ts` 完全同构：

- `WidthMode = "centered" | "full"`
- 默认值 `"centered"`（不写 localStorage）
- `useSyncExternalStore` + localStorage `"width-mode"` key
- 导出 `useWidthMode()` hook、`widthModeInitScript`

**防闪烁方案**：不使用 React className 驱动宽度。改为：

1. `widthModeInitScript` 在 `<head>` 中立即读取 localStorage 并设置 `document.documentElement.dataset.widthMode`
2. 在 `tailwind.css` 中用 CSS 属性选择器定义容器宽度：

```css
/* 宽度模式 — 默认居中 */
.width-container {
  max-width: var(--content-max-width);
  margin-left: auto;
  margin-right: auto;
  padding-left: var(--content-px);
  padding-right: var(--content-px);
}
:root[data-width-mode="full"] .width-container {
  max-width: none;
  padding-left: 1rem;
  padding-right: 2rem;
}
@media (min-width: 768px) {
  :root[data-width-mode="full"] .width-container {
    padding-left: 2rem;
    padding-right: 2rem;
  }
}
```

3. `useWidthMode()` hook 的 `setMode()` 同时更新 localStorage 和 `document.documentElement.dataset.widthMode`
4. `ForumLayoutShell` 中容器使用固定 `className="width-container"`，不依赖 React state 切换 class

**这样做的好处**：
- `<head>` script 在 HTML 解析阶段就设置好 `data-width-mode`，CSS 立即生效
- React hydration 时 className 是固定的 `"width-container"`，不会 mismatch
- 切换时 hook 直接操作 DOM 属性，CSS 即时响应，无需 React re-render

**文件**：`src/components/width-toggle.tsx`

与 `theme-toggle.tsx` 同构：

- 图标：`Maximize2`（居中态，点击切到全屏）/ `Minimize2`（全屏态，点击切到居中）
- 调用 `useWidthMode().toggleMode`
- aria-label：`"切换宽屏模式"` / `"切换居中模式"`

### 3. 布局重构

**当前结构（3 层顶部栏，84px）**：

```
TopBar        (h-10, 40px)  — auth + theme toggle
ForumNavbar   (h-14, 56px)  — logo + nav + mobile hamburger
Breadcrumbs   (h-10, 40px)  — 面包屑独立栏
Content
SiteFooter
```

**新结构（1 层顶部栏 + 内联面包屑，48px）**：

```
ForumNavbar   (h-12, 48px)  — logo + nav + auth + width toggle + theme toggle + mobile menu
Content (内含内联面包屑)
SiteFooter (compact)
```

**节约**：顶部栏从 84px 减少到 48px，节约 36px 纵向空间。

#### ForumNavbar 新布局

```
┌───────────────────────────────────────────────────────────────────┐
│ [Ellie]   首页  精华  搜索         [username] [⬜] [🌙]  [☰mob]  │
└───────────────────────────────────────────────────────────────────┘
```

Desktop：
- 左侧：Logo（font-display text-primary）
- 中左：导航链接（首页 / 精华 / 搜索）
- 右侧：用户名或登录链接 + WidthToggle + ThemeToggle

Mobile：
- 左侧：Logo
- 右侧：Hamburger → Sheet 展开 nav + auth + toggles

内部容器使用固定 `className="width-container"`，由 CSS 属性选择器驱动宽度。

#### ForumLayoutShell 新结构

```tsx
<div className="flex min-h-screen flex-col bg-background">
  <ForumNavbar />
  <main className="flex-1">
    <div className="width-container">
      <ForumBreadcrumbs />      {/* 内联，仅在内页显示 */}
      <div className="py-4">
        {children}
      </div>
    </div>
  </main>
  <SiteFooter />
</div>
```

> **注意**：`width-container` 是纯 CSS class，不依赖 React state。宽度由 `<html data-width-mode>` 属性控制。

#### ForumBreadcrumbs 新版

- 移除独立 `h-10` 栏和 `bg-background` 背景
- 移除内部 `max-w-[1200px]` 容器（父级已提供）
- 仅 `py-2` padding，内联在内容容器中

#### SiteFooter 新版

- 移除内部 `max-w-[1200px]` 容器
- `py-6` → `py-4`

### 4. 共享翻页组件

**文件**：`src/components/forum/keyset-pagination.tsx`

提取自 5 个页面中重复的 `PageLink` + 翻页栏：

```tsx
interface KeysetPaginationProps {
  total: number;
  totalLabel?: string;     // 默认 "条"
  prevHref: string | null;
  nextHref: string | null;
}
```

使用 shadcn `Button` + Next.js `Link`，`variant="outline" size="xs"`。

### 5. 首页设计

**当前**：`<h1>` 标题 + `<p>` 副标题 + ForumGroup 卡片网格

**新版**：直接渲染 ForumGroup 卡片（navbar 已标识"首页"为活跃状态），`space-y-4`。

#### ForumGroup

```
┌─ Card ────────────────────────────────────────────────────────┐
│ CardHeader: 📂 学术交流                                        │
│ CardContent:                                                   │
│ ┌──────────────────────┬────────┬────────┬──────────────────┐ │
│ │ 📘 计算机科学 [算法,DB] │ 1.2K帖 │ 3.4K回 │ 张三 · 2分钟前  │ │
│ ├──────────────────────┼────────┼────────┼──────────────────┤ │
│ │ 📗 数学               │  856帖 │ 2.1K回 │ 李四 · 1小时前   │ │
│ └──────────────────────┴────────┴────────┴──────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

- 每个 ForumGroup 是一个 `Card`
- `CardHeader`：组名 + 描述（`pb-2`）
- `CardContent`：`divide-y` 行列表（`pt-0`）
- 每个 Forum 是一行（`ForumCard`）

#### ForumCard（密集行）

单行展示全部信息：

```
[icon] [name + sub-forum links] [description]   [thread#] [post#]  [lastPoster · timeAgo]
```

- `flex items-center gap-3 py-2.5`
- hover: `hover:bg-accent/50`
- Sub-forum 链接在名称同行，`relative z-10`
- Mobile（sm 以下）：隐藏统计列，仅显示名称+描述

### 6. 帖子列表页设计

**页面**：`/forums/[id]`

```
┌─ Card: Forum Header ──────────────────────────────────────────┐
│ 计算机科学                             帖子 1,234   回帖 5,678  │
│ 讨论计算机相关话题                                               │
└───────────────────────────────────────────────────────────────┘
┌─ Card: Thread List ───────────────────────────────────────────┐
│ [最新回复] [最新发布] [热门]                      [只看精华]     │
│ ──────────────────────────────────────────────────────────── │
│ [置顶][精华] 关于期末考试安排  张三·2h前    156👁  23💬        │
│ 新手报到帖                    李四·5m前     42👁   8💬        │
│ 求推荐数据结构教材            王五·1d前    891👁  67💬        │
│ ──────────────────────────────────────────────────────────── │
│                     共 1,234 条    [← 上一页] [下一页 →]       │
└───────────────────────────────────────────────────────────────┘
```

#### ThreadItem（单行密集行）

从 ~52px/行 压缩到 ~36px/行：

```
[badges] [title truncated...] [author · time]  [views👁] [replies💬]
```

- `flex items-center gap-2 py-1.5`
- `border-b border-border/50 last:border-0`
- hover: `hover:bg-accent/50`
- 统计数字使用 `tabular-nums` 对齐
- Mobile：隐藏 author/time 列

#### 帖子列表页渲染方案

`forums/[id]/page.tsx` 保持 RSC。排序和翻页通过 searchParams + `<Link>` 驱动：

- 排序按钮：`<Link href={"/forums/${id}?sort=newest"}>` 而非 onClick
- 精华过滤：`<Link href={"/forums/${id}?digest=1"}>`
- 翻页：使用 `KeysetPagination` 组件（href 驱动）

页面直接内联 `ThreadItem` + `KeysetPagination`，不使用客户端 `ThreadList` 组件。

> **`thread-list.tsx` 处置**：当前是客户端交互组件（onClick 排序），与 RSC 页面不兼容。论坛前端不再引用它。文件保留但在顶部添加 `@deprecated` 注释，待确认 admin 侧无引用后可删除。

### 7. 帖子详情页设计

**页面**：`/threads/[id]`

```
┌─ Card: Thread Header ─────────────────────────────────────────┐
│ [置顶][精华] 关于期末考试安排的通知                               │
│ 版块 · 张三 · 2024-03-15 · 1,234 浏览 · 56 回复                │
└───────────────────────────────────────────────────────────────┘

┌─ Card: Post #1 ───────────────────────────────────────────────┐
│ [av24] 张三 · 2024-03-15 14:30                          楼主   │
│ ─────────────────────────────────────────────────────────────  │
│ 帖子正文内容，全宽显示...                                        │
│ 📎 attachment1.pdf (2.3 MB)                                    │
└───────────────────────────────────────────────────────────────┘

┌─ Card: Post #2 ───────────────────────────────────────────────┐
│ [av24] 李四 · 2024-03-15 15:00                          2 楼   │
│ ─────────────────────────────────────────────────────────────  │
│ 回复内容...                                                     │
└───────────────────────────────────────────────────────────────┘

共 56 条回复    [← 上一页] [下一页 →]
```

#### PostCard（内联作者）

**核心变更**：移除 120px 作者侧边栏，改为内联头部行。

```
┌─ Card size="sm" ──────────────────────────────────────────────┐
│ [av24] username · timeAgo                            #N 楼     │
│ ─────────────────── border-b border-border/50 ───────────────  │
│ 帖子 HTML 内容（prose prose-sm max-w-none）                      │
│ [附件列表]                                                      │
└───────────────────────────────────────────────────────────────┘
```

- Avatar 从 48px 降为 24px（`h-6 w-6`）
- 作者名 + 时间左对齐，楼层号右对齐
- 内容获得全宽（不再被 120px 侧边栏挤占）
- Mobile 和 Desktop 使用同一布局（不再需要分开渲染）

### 8. 用户主页设计

**页面**：`/users/[id]`

> **API 限制**：Worker v1 不支持 `authorId` 过滤查询帖子/回帖（见 `user-profile.server.ts` 注释）。
> `loadUserProfile()` 返回的 `threads` 和 `posts` 都是空分页结果。
> 本次 UI 重写只做壳子改造（Card 化 + 信息密度优化），不对历史 tab 内容做功能性改动。
> 发帖/回帖历史功能需等 Worker API 扩展后再实现。

```
┌─ Card ────────────────────────────────────────────────────────┐
│ [av48] 张三   管理员 · 正常                                     │
│        注册: 2020-01-15 · 最后登录: 2天前                        │
│        发帖 1,234 · 回帖 5,678 · 积分 12,345                    │
├─ Tabs ────────────────────────────────────────────────────────┤
│ [发帖历史]  [回帖历史]                                           │
├───────────────────────────────────────────────────────────────┤
│ 暂无数据（Worker v1 尚不支持按用户查询历史）                       │
└───────────────────────────────────────────────────────────────┘
```

- 单个 `Card` 包含全部内容
- Avatar 从 64px 降为 48px
- Tabs 保留（UI 就绪，待 API 支持后即可填充数据）
- 空状态显示友好提示而非空白
- 使用 `KeysetPagination`（当有数据时自动显示）

### 9. 搜索页设计

**页面**：`/search`

```
┌─ Card ────────────────────────────────────────────────────────┐
│ [           搜索框                ] [搜索]                      │
│ [按标题搜索]  [按作者搜索]                                       │
├───────────────────────────────────────────────────────────────┤
│ 共 42 条结果                                                    │
│ [精华] 帖子标题  张三·2024-03-15                 156👁  23💬    │
│ ...                                                            │
│                     共 42 条    [← 上一页] [下一页 →]           │
└───────────────────────────────────────────────────────────────┘
```

- 单 Card：搜索表单 + 类型 tabs + 结果 + 翻页
- 使用 shadcn `Input` + `Button`
- 使用 `KeysetPagination`

### 10. 精华页设计

**页面**：`/digest`

```
┌─ Card ────────────────────────────────────────────────────────┐
│ CardHeader: ⭐ 精华帖                                          │
├───────────────────────────────────────────────────────────────┤
│ [精华] 帖子标题  作者·时间                        回复 · 浏览    │
│ ...                                                            │
│                     共 42 条    [← 上一页] [下一页 →]           │
└───────────────────────────────────────────────────────────────┘
```

- 单 Card + CardHeader + CardContent
- 帖子行复用 ThreadItem 的密集行样式
- 使用 `KeysetPagination`

### 11. 登录页设计

**页面**：`/login`（不在 ForumLayoutShell 中）

轻度改进：
- 表单外层使用 shadcn `Card`
- `<input>` → shadcn `Input`
- `<button>` → shadcn `Button`
- `<label>` → shadcn `Label`
- 保持全屏居中布局
- 保持右上角 ThemeToggle

---

## 实施阶段

### Phase 0：基础设施 ✅

| 步骤 | 文件 | 依赖 | 状态 |
|------|------|------|------|
| 0.1 | 创建 `src/hooks/use-width-mode.ts` | 无 | ✅ |
| 0.2 | 创建 `src/components/width-toggle.tsx` | 0.1 | ✅ |
| 0.3 | 修改 `src/app/layout.tsx`（加 script） | 0.1 | ✅ |
| 0.4 | 创建 `src/components/forum/keyset-pagination.tsx` | 无 | ✅ |
| 0.5 | 修改 `src/app/tailwind.css`（加 CSS 变量） | 无 | ✅ |

**原子提交**：`feat(web): add width mode toggle and shared pagination` ✅ `72895ba`

### Phase 1：布局层 ✅

| 步骤 | 文件 | 依赖 | 状态 |
|------|------|------|------|
| 1.1 | 重写 `forum-navbar.tsx` | 0.1, 0.2 | ✅ |
| 1.2 | 废弃 `top-bar.tsx` | 1.1 | ✅ |
| 1.3 | 重写 `forum-breadcrumbs.tsx` | 无 | ✅ |
| 1.4 | 重写 `forum-layout.tsx` | 0.1, 1.1, 1.3 | ✅ |
| 1.5 | 重写 `site-footer.tsx` | 无 | ✅ |

**原子提交**：`refactor(web): merge topbar into navbar, width-aware layout` ✅ `f0850b4`

### Phase 2：首页 ✅

| 步骤 | 文件 | 依赖 | 状态 |
|------|------|------|------|
| 2.1 | 重写 `forum-card.tsx` | 无 | ✅ |
| 2.2 | 重写 `forum-group.tsx` | 2.1 | ✅ |
| 2.3 | 重写 `(forum)/page.tsx` | 2.2 | ✅ |

**原子提交**：`refactor(web): redesign forum home with dense card rows` ✅ `e98fcbb`

### Phase 3：帖子列表页 ✅

| 步骤 | 文件 | 依赖 | 状态 |
|------|------|------|------|
| 3.1 | 微调 `thread-badge.tsx` | 无 | ✅ |
| 3.2 | 重写 `thread-item.tsx` | 3.1 | ✅ |
| 3.3 | 废弃标记 `thread-list.tsx`（添加 @deprecated 注释） | 无 | ✅ 已在 Phase 6 删除 |
| 3.4 | 重写 `forums/[id]/page.tsx`（RSC 内联 ThreadItem + KeysetPagination） | 3.2, 0.4 | ✅ |

**原子提交**：`refactor(web): redesign thread list with single-line rows` ✅ `a95eee0`

### Phase 4：帖子详情页 ✅

| 步骤 | 文件 | 依赖 | 状态 |
|------|------|------|------|
| 4.1 | 重写 `post-card.tsx` | 无 | ✅ |
| 4.2 | 轻改 `post-editor.tsx` | 无 | ✅ |
| 4.3 | 重写 `threads/[id]/page.tsx` | 4.1, 0.4 | ✅ |

**原子提交**：`refactor(web): redesign thread detail with inline author` ✅ `a1c279f`

### Phase 5：其余页面 ✅

| 步骤 | 文件 | 依赖 | 状态 |
|------|------|------|------|
| 5.1 | 轻改 `user-card.tsx` | 无 | ✅ |
| 5.2 | 重写 `users/[id]/page.tsx` | 5.1, 0.4 | ✅ |
| 5.3 | 重写 `search/page.tsx` | 0.4 | ✅ |
| 5.4 | 重写 `digest/page.tsx` | 0.4 | ✅ |
| 5.5 | 轻改 `login/page.tsx` | 无 | ✅ |

**原子提交**：`refactor(web): redesign user/search/digest/login pages` ✅ `f220beb`

### Phase 6：验证

| 步骤 | 内容 |
|------|------|
| 6.1 | 响应式测试：360px / 768px / 1024px / 1440px |
| 6.2 | 暗黑模式测试 |
| 6.3 | 宽度切换测试（居中 ↔ 全屏） |
| 6.4 | 清理死代码 / 未使用导入 |
| 6.5 | TypeCheck：`bun run typecheck` |

---

## 纵向空间节约汇总

| 区域 | 当前 | 新版 | 节约 |
|------|------|------|------|
| 顶部导航栏 | 84px（3 栏） | 48px（1 栏 + 内联面包屑） | 36px |
| ForumCard 行高 | ~80px（网格卡片） | ~40px（密集行） | ~50% |
| ThreadItem 行高 | ~52px（多行卡片） | ~36px（单行行） | ~31% |
| PostCard 宽度 | 内容区 - 120px 侧栏 | 全宽 | +120px 内容宽度 |
| 首页标题区 | ~60px（h1 + p） | 0px（移除） | 60px |
