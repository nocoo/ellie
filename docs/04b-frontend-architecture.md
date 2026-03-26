# 04b — 前端架构选型

> 定义 Admin 和论坛共享的技术栈、项目结构、MVVM 分层、设计系统和质量体系。
>
> **前置依赖**：04a（类型定义和 Repository 接口）

## 技术栈

| 层 | 技术 | 版本 | 说明 |
|---|---|---|---|
| **框架** | Next.js | 16 | App Router, Turbopack, Server Components |
| **运行时** | Bun | ≥1.3 | 与 Doc01 一致 |
| **语言** | TypeScript | ^5.9 | strict mode |
| **React** | React | 19 | Server + Client Components |
| **样式** | Tailwind CSS | v4 | `@tailwindcss/postcss`, CSS variables |
| **UI 组件** | shadcn/ui (Radix UI) | latest | new-york style, copy-paste 模式 |
| **图标** | Lucide React | latest | 1.5px stroke, tree-shakeable |
| **图表** | Recharts | ^3.8 | Admin 仪表盘用（04c） |
| **i18n** | next-intl | latest | 中/英双语 |
| **代码质量** | Biome strict | 仓库已有 | 0 error, 0 warning |
| **测试** | bun test (L1/L2) + Playwright (L3) | | 六维质量体系 |
| **Git Hooks** | Husky + lint-staged | | pre-commit / pre-push |

> 富文本 (Tiptap) 和 Emoji (emoji-mart) 属于高级功能，定义在 04e。

### 从参考项目复用的模式

**从 basalt 复用：**
- MVVM 架构（`models/` → `viewmodels/` → `pages/`）
- 3 层亮度体系（L0 background / L1 card / L2 secondary）
- Dashboard widget 组件（StatCard, Chart Cards 等）→ 04c
- AppSidebar + DashboardLayout → 04c
- ThemeToggle 三态主题切换 + FOUC 防闪
- 响应式 sidebar（desktop 折叠 / mobile 抽屉）
- Mock data 集中管理
- `cn()` = `clsx()` + `tailwind-merge()`

**从 pew 复用：**
- Next.js 16 App Router Route Groups
- Proxy（替代 middleware）守卫路由
- `useIsMobile()` 响应式 hook
- `useSyncExternalStore` 主题状态管理（无 Context）
- 数据 hooks 模式（data / loading / error / refetch）

---

## 项目结构

沿用 Doc01 的**单包结构**，前端代码放 `src/`，与迁移脚本共存。不引入 monorepo。

```
ellie/
├── docs/                        # 项目文档（已有）
├── scripts/migrate/             # Phase 1: 迁移脚本（已有）
├── src/                         # 应用代码
│   ├── app/
│   │   ├── layout.tsx           # 根 Layout: AuthProvider + 字体 + 主题
│   │   ├── login/page.tsx       # 登录页
│   │   ├── (forum)/             # 论坛 Route Group（→ 04d）
│   │   │   ├── page.tsx         # / — 首页（论坛版块列表）
│   │   │   └── ...
│   │   ├── (admin)/             # Admin Route Group（→ 04c）
│   │   │   └── ...
│   │   └── api/                 # API Routes
│   │       ├── auth/[...nextauth]/route.ts
│   │       ├── v1/              # 论坛 API
│   │       └── admin/           # Admin API
│   │
│   ├── models/                  # Model 层（04a 定义）
│   ├── viewmodels/              # ViewModel 层（04c/04d 各自定义）
│   ├── data/                    # 数据层（04a 定义接口）
│   │   ├── mock/                # Mock 数据
│   │   ├── repositories/        # Repository 接口 + 实现
│   │   └── index.ts             # 工厂
│   │
│   ├── components/
│   │   ├── ui/                  # shadcn/ui 原子组件（共享）
│   │   ├── layout/              # 布局组件（共享）
│   │   ├── forum/               # 论坛组件（→ 04d）
│   │   └── admin/               # Admin 组件（→ 04c）
│   │
│   ├── lib/
│   │   ├── utils.ts             # cn(), formatDate()
│   │   ├── palette.ts           # 设计 token
│   │   └── constants.ts         # 全局常量
│   │
│   ├── hooks/                   # 共享 hooks
│   │   ├── useIsMobile.ts
│   │   ├── useTheme.ts
│   │   └── useDebounce.ts
│   │
│   ├── auth.ts                  # NextAuth 配置
│   └── proxy.ts                 # Next.js 16 proxy
│
├── tests/
│   ├── unit/                    # L1（models/ viewmodels/ components/）
│   └── integration/             # L2（api/）
│
├── public/
│   └── smileys/                 # Discuz Smiley 表情图片（04e）
│
├── next.config.ts
├── tailwind.css                 # Tailwind v4 + 设计 token
├── components.json              # shadcn/ui
├── package.json                 # 在现有基础上扩展
├── tsconfig.json
└── biome.json                   # 已有
```

---

## MVVM 分层

```
┌──────────────────────────────────────────────────┐
│  View (app/**/*.tsx + components/**)              │
│  纯展示，消费 ViewModel 返回的数据                  │
│  禁止直接调用 data layer                           │
└───────────────────┬──────────────────────────────┘
                    │ 调用 hooks
┌───────────────────▼──────────────────────────────┐
│  ViewModel (viewmodels/*.ts)                     │
│  React hooks — 组装 Model 函数 + Repository 数据   │
│  管理 loading/error/pagination 状态               │
└───────────────────┬──────────────────────────────┘
                    │ 调用 repository + model
┌───────────────────▼──────────────────────────────┐
│  Model (models/*.ts) — 04a 定义                   │
│  纯函数 + 类型，0 依赖，可独立 UT                    │
└───────────────────────────────────────────────────┘
                    │
┌───────────────────▼──────────────────────────────┐
│  Data Layer (data/**) — 04a 定义接口               │
│  Repository 接口 + Mock/API 实现                   │
└───────────────────────────────────────────────────┘
```

### ViewModel 模式

所有 ViewModel 遵循相同的 hook 签名模式：

```typescript
function useXxxViewModel(params) {
  const repo = useRepository();   // 从 data layer 获取
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // fetch → transform via model functions → set

  return {
    /* 展示数据（已经过 model 函数变换） */,
    loading,
    error,
    /* 动作函数（调用 repository 写入方法） */,
    refetch,
  };
}
```

### Contract 先行原则

**在写任何 View 组件之前，必须先完成并测试：**

1. `models/types.ts` + `models/permission.ts` — L1 测试覆盖
2. `data/repositories/types.ts` — 接口定义
3. Mock 实现 — 满足接口
4. Auth 接口 — login/logout/getSession 的类型签名

---

## 认证方案

### 演进路径

```
当前阶段（原型）:
  Browser → Next.js API Routes → NextAuth Credentials → JWT cookie
  Auth source of truth: NextAuth（Mock 用户数据）

Phase 2（Worker 就绪后）:
  Browser → Next.js proxy → Worker API → JWT + KV session
  Auth source of truth: Worker（D1 用户表）
  NextAuth 完全移除
```

**当前阶段只有一个 auth source：NextAuth。** 不存在两套认证并存的情况。

### 路由守卫（Proxy）

Next.js 16 使用 `proxy.ts` 替代 `middleware.ts`：

```
公开路由（无需认证）:
  /
  /forums/**
  /threads/**
  /users/**
  /digest
  /login
  /api/v1/** (读操作)

认证路由（需登录）:
  /threads/new
  /api/v1/** (写操作 — 在 route handler 中检查)

管理路由（需 role ∈ {Admin, SuperMod}）:
  /admin/**
  /api/admin/**
```

### API 路由边界

| 前缀 | 用途 | 认证 |
|------|------|------|
| `/api/v1/forums` | 版块列表、详情 | 公开 |
| `/api/v1/threads` | 帖子列表、详情、发帖 | 读公开，写需登录 |
| `/api/v1/posts` | 回复列表、发回复 | 读公开，写需登录 |
| `/api/v1/users` | 用户资料 | 公开 |
| `/api/v1/moderation` | 版主操作 | role ∈ {1, 2, 3} |
| `/api/admin/*` | 管理后台 | role ∈ {1, 2} |

---

## 设计系统

### 配色

延续同济网蓝灰色调（`#336699` + `#444` + `#E5EDF2`），升级为 CSS variable token：

```css
/* tailwind.css */
:root {
  /* 品牌色 */
  --color-primary: 210 60% 40%;          /* 源自 #336699 */
  --color-primary-foreground: 0 0% 100%;
  /* 语义色 */
  --color-background: 0 0% 100%;
  --color-foreground: 0 0% 27%;          /* #444 */
  --color-muted: 0 0% 40%;              /* #666 */
  --color-muted-foreground: 0 0% 60%;   /* #999 */
  --color-card: 210 20% 97%;
  --color-secondary: 210 15% 94%;       /* #F2F2F2 */
  --color-accent: 210 30% 90%;          /* #E5EDF2 */
  --color-border: 210 10% 80%;          /* #CDCDCD */
  --color-destructive: 12 70% 63%;
  --color-warning: 27 85% 58%;
  --color-success: 142 60% 45%;
  /* 圆角 */
  --radius-card: 14px;
  --radius-widget: 10px;
  --radius: 0.75rem;
}
.dark {
  --color-background: 220 15% 10%;
  --color-foreground: 0 0% 90%;
  --color-card: 220 15% 14%;
  --color-secondary: 220 15% 18%;
  --color-primary: 210 70% 55%;
  --color-border: 220 15% 25%;
}
```

### 3 层亮度体系

| 层 | Token | 用途 |
|----|-------|------|
| L0 | `--color-background` | 页面最外层底色 |
| L1 | `--color-card` | 内容面板（圆角卡片） |
| L2 | `--color-secondary` | 嵌套卡片（如表格行交替色） |

用亮度差异表达层级，不依赖 border。

### 字体

| 用途 | 字体栈 |
|------|--------|
| 正文 | Inter, 'Microsoft YaHei', system-ui, sans-serif |
| 标题 | 'DM Sans', 'Microsoft YaHei', sans-serif |
| 代码 | 'JetBrains Mono', 'Cascadia Code', monospace |

### 响应式断点

| 断点 | 论坛（04d） | Admin（04c） |
|------|------------|-------------|
| Mobile (<768px) | 单列, 汉堡菜单 | Sidebar overlay 抽屉 |
| Tablet (768-1024px) | 导航折叠 | Sidebar collapsed (68px) |
| Desktop (>1024px) | 全功能布局 | Sidebar expanded (260px) |

### 暗黑模式

- **三态切换**：light → dark → system（循环）
- **持久化**：`localStorage("theme")`
- **防闪**：`<head>` 内联 script 在首帧前设置 `.dark` class
- **CSS**：`:root` light tokens, `.dark` 覆盖
- **系统偏好**：监听 `prefers-color-scheme` 变更事件

### 共享布局组件

| 组件 | 用途 | 使用方 |
|------|------|-------|
| `ThemeToggle` | 三态主题切换 | 04c + 04d |
| `Breadcrumbs` | 面包屑导航 | 04c + 04d |
| `Pagination` | Keyset 分页控件 | 04c + 04d |
| `UserAvatar` | 用户头像（R2 路径） | 04c + 04d |
| `SearchBar` | 搜索输入框 | 04d（可复用到 04c） |

---

## 六维质量体系

三层测试（L1/L2/L3）+ 两道门控（G1/G2）+ 一道隔离（D1），最终目标 **Tier S**（六维全绿）。Mock 阶段 D1=N/A，封顶 Tier B；Phase 2 接入 D1 后升级。

### 维度定义与目标

| 维度 | 工具 | 目标 | 运行时机 |
|------|------|------|---------|
| **L1 Unit** | bun test | 分层覆盖率（见下方） | pre-commit <30s |
| **L2 Integration** | bun test, 真 HTTP | 100% API 端点覆盖 | pre-push <3min |
| **L3 E2E** | Playwright | 关键路径覆盖 | CI / 按需 |
| **G1 Static** | Biome strict | 0 error, 0 warning | pre-commit |
| **G2 Security** | osv-scanner + gitleaks | 无漏洞、无泄露 | pre-push |
| **D1 Isolation** | Mock 阶段 N/A → Phase 2 独立 `-test` 资源 | Mock 阶段缺失，Tier 封顶 B | L2/L3 连接 |

### L1 覆盖率分层目标

不同代码层的可测试性差异显著，使用单一覆盖率指标不合理。按模块分层设定：

| 代码层 | 目录 | 覆盖率目标 | 理由 |
|--------|------|-----------|------|
| **Model 纯函数** | `src/models/` | **≥95%** | 零依赖纯函数，100% 可测，是系统正确性的基石 |
| **Repository 接口 + Mock** | `src/data/` | **≥95%** | Contract 实现，必须严格验证 |
| **共享工具** | `src/lib/` | **≥95%** | sanitize、formatDate、cn() 等基础工具 |
| **ViewModel hooks** | `src/viewmodels/` | **≥90%** | mock Repository 后可测，但含异步状态管理，允许边界场景豁免 |
| **业务组件** | `src/components/forum/`, `admin/` | **≥80%** | 含交互逻辑的组件需测试，但 DOM 断言有成本 |
| **UI 薄壳** | `src/app/**/page.tsx`, `layout.tsx` | **豁免** | 仅组合子组件，无独立逻辑，强制覆盖无收益 |
| **UI 原子组件** | `src/components/ui/` | **豁免** | shadcn/ui copy-paste 组件，由上游保证质量 |

**全局覆盖率门槛**：≥90%（bun test --coverage，豁免目录通过 coverage 配置排除）。

**与 Doc01 的关系**：Doc01 迁移脚本为纯逻辑代码，L1 ≥95%。前端项目含 UI 层，全局目标降至 ≥90%，但纯逻辑层（models/data/lib）保持 ≥95% 与 Doc01 一致。

### 测试分层详情

| 层 | 目录 | 测试对象 | 验证手段 |
|----|------|---------|---------|
| L1 | `tests/unit/models/` | permission.ts, pagination.ts, thread.ts, forum.ts 等纯函数 | 直接调用，断言返回值 |
| L1 | `tests/unit/data/` | Mock Repository 实现是否满足接口 contract | mock 数据 → 调用 → 断言结果符合 PaginatedResult |
| L1 | `tests/unit/lib/` | sanitize, formatDate, attachmentUrl, decodeHighlight | 边界值测试 |
| L1 | `tests/unit/viewmodels/` | ViewModel hooks 的数据变换、状态管理 | mock Repository → renderHook → 断言 |
| L1 | `tests/unit/components/` | 业务组件渲染、交互 | mock ViewModel → render → 断言 DOM |
| L2 | `tests/integration/api/` | API Route Handlers（`/api/v1/*`, `/api/admin/*`） | 真 HTTP 请求（run-e2e.ts 自动启停 dev server） |
| L3 | `tests/e2e/` | 浏览器端到端流程 | Playwright：登录 → 浏览版块 → 查看帖子 → 发帖 → 管理后台 |

### Hook 映射

| Hook | 执行内容 | 时限 |
|------|---------|------|
| **pre-commit** | `lint-staged` (biome check --staged) + `bun test --coverage` (L1) | <30s |
| **pre-push** | Full L1 + L2 (真 HTTP) + G2 (osv-scanner + gitleaks) | <3min |
| **CI / 按需** | L3 (Playwright) | 无限制 |

### D1 测试隔离演进

| 阶段 | 隔离策略 | 说明 |
|------|---------|------|
| **当前（Mock 原型）** | N/A | 所有数据来自内存 Mock，无外部资源 → D1 缺失，**Tier 封顶 B** |
| **Phase 2（Worker 就绪后）** | 独立 `-test` 后缀资源 | `ellie-db-test` D1 + `ellie-test` R2 + `ellie-test` KV |

Phase 2 隔离三重验证：
1. **构建期绑定验证**：`verify-test-bindings.ts` 解析 wrangler.toml `[env.test]`，校验所有 binding 名称含 `-test` 后缀
2. **运行时资源名校验**：测试 setup 中检查 `RESOURCE_ENV === "test"`，不匹配则 throw
3. **测试数据标记表**：测试 D1 含 `_test_marker` 表 (key=env, value=test)，reset 前先验证标记

### Tier 判定

| Tier | 条件 |
|------|------|
| **S** | L1 + L2 + L3 + G1 + G2 + D1 全部达标（六维全绿） |
| **A** | L1 + L2 + G1 + D1 达标 + 其余至少一项 |
| **B** | L1 + G1 达标（基础门控） |
| **C** | L1 或 G1 任一不达标 |

> D1 是 Tier A 的必要条件——没有测试隔离的项目最高只能评 B。

---

## 实施顺序

> **当前仓库状态**：`package.json` 仅包含迁移脚本和 Biome/Bun 类型依赖。以下 Step 1 脚手架步骤会引入 Next.js 全套前端依赖。
>
> **核心原则**：质量体系从第一步就建立，每一步都伴随对应的测试和门控。不存在"先写代码、最后补测试"的阶段。

### Step 1：脚手架 + 质量基础设施

**产出**：可运行的空壳项目 + 六维质量体系骨架（G1 + L1 + G2 三维立即生效）

| 原子化提交 | 内容 | 质量状态 |
|-----------|------|---------|
| `feat: init next.js 16 project with bun` | Next.js 16 + TypeScript strict + Bun | — |
| `feat: add tailwind v4 + design tokens` | Tailwind CSS v4 + `tailwind.css` 设计 token + 暗黑模式变量 | — |
| `feat: add shadcn/ui base components` | shadcn/ui init + Button/Card/Badge 等基础组件 | — |
| `chore: setup husky + lint-staged + biome strict` | Husky pre-commit (G1: biome check) + pre-push 骨架 | **G1 生效** |
| `chore: setup bun test + coverage config` | bun test 配置 + coverage 排除规则（page.tsx/layout.tsx/ui/） + pre-commit 加入 L1 | **L1 生效**（0 测试 = 100%） |
| `chore: setup g2 security scanning` | pre-push 加入 osv-scanner + gitleaks | **G2 生效** |

> **Step 1 结束时**：pre-commit = G1 + L1，pre-push = G2。Tier B 已达成（L1 + G1 达标）。

### Step 2：Contract 层（models + data 接口）+ L1 ≥95%

**产出**：04a 的全部类型定义、权限函数、Repository 接口，L1 测试锁定

**前置**：Step 1

| 原子化提交 | 内容 | 测试 |
|-----------|------|------|
| `feat: add core type definitions` | `models/types.ts` — 所有 enum + interface | L1: 类型导出正确性（编译即验证） |
| `feat: add permission model + tests` | `models/permission.ts` + `tests/unit/models/permission.test.ts` | L1: ≥95%，全量 role × status × action 组合 |
| `feat: add thread model functions + tests` | `models/thread.ts` (getThreadBadges, decodeHighlight) + tests | L1: ≥95%，所有 special/sticky/digest 组合 |
| `feat: add forum model functions + tests` | `models/forum.ts` (buildForumTree, filterVisibleForums) + tests | L1: ≥95%，空数组/单层/三层嵌套 |
| `feat: add pagination utilities + tests` | `models/pagination.ts` (cursor encode/decode) + tests | L1: ≥95% |
| `feat: add shared lib utilities + tests` | `lib/utils.ts`, `lib/attachment.ts` (attachmentUrl, thumbnailUrl, sanitize) + tests | L1: ≥95% |
| `feat: add repository interfaces` | `data/repositories/types.ts` — 全部 Repository 接口 | 编译验证 |

> **Step 2 结束时**：models/ + lib/ 覆盖率 ≥95%，Contract 通过 L1 测试锁定。

### Step 3：Mock 数据层 + L1 ≥95%

**产出**：Repository Mock 实现 + Auth Mock，数据可驱动 UI

**前置**：Step 2

| 原子化提交 | 内容 | 测试 |
|-----------|------|------|
| `feat: add mock data sets` | `data/mock/users.ts`, `forums.ts`, `threads.ts`, `posts.ts`, `attachments.ts` | — |
| `feat: add mock forum repository + tests` | `data/repositories/forum.repository.ts` + tests | L1: ≥95%，listAll/getById/update |
| `feat: add mock thread repository + tests` | `data/repositories/thread.repository.ts` + tests | L1: ≥95%，list/search/create/delete/mod 操作 |
| `feat: add mock post repository + tests` | `data/repositories/post.repository.ts` + tests | L1: ≥95%，list by threadId/authorId |
| `feat: add mock user repository + tests` | `data/repositories/user.repository.ts` + tests | L1: ≥95%，list/search/filter/setStatus/setRole |
| `feat: add mock attachment repository + tests` | `data/repositories/attachment.repository.ts` + tests | L1: ≥95% |
| `feat: add repository factory` | `data/index.ts` — createRepositories() | — |
| `feat: add auth mock (nextauth credentials)` | `auth.ts` + mock user 验证 | L1: login success/failure |

> **Step 3 结束时**：data/ 覆盖率 ≥95%，Repository Contract 完全可验证。

### Step 4：共享布局组件 + L1 ≥80%

**产出**：论坛 + Admin 共用的布局和 UI 组件

**前置**：Step 1

| 原子化提交 | 内容 | 测试 |
|-----------|------|------|
| `feat: add theme toggle (light/dark/system)` | ThemeToggle + useTheme hook + FOUC 防闪 script | L1: useTheme hook 状态切换 |
| `feat: add breadcrumbs component` | Breadcrumbs 通用组件 | L1: 渲染 + 层级正确性 |
| `feat: add keyset pagination component` | ForumPagination + usePagination hook | L1: hook 的 loadMore/loadPrev/reset |
| `feat: add user avatar component` | UserAvatar (R2 path → img) | L1: 有头像/无头像/fallback |
| `feat: add responsive hooks` | useIsMobile + useDebounce | L1: ≥95%（纯 hook） |

### Step 5：Admin 后台 + ViewModel L1 ≥90%

**产出**：04c 全部功能模块

**前置**：Step 3 + Step 4

| 原子化提交 | 内容 | 测试 |
|-----------|------|------|
| `feat: add admin layout (sidebar + header)` | AdminLayout + AdminSidebar | L1: sidebar 折叠/展开状态 |
| `feat: add dashboard viewmodel + page` | useDashboardViewModel + StatCard + ChartWidgets + admin/page.tsx | L1 ≥90%: ViewModel 数据聚合逻辑 |
| `feat: add user management viewmodel + page` | useUserManagementViewModel + UserTable + admin/users/page.tsx | L1 ≥90%: 筛选/搜索/ban/unban/roleChange |
| `feat: add content moderation viewmodel + page` | useContentModerationViewModel + ContentTable + admin/content/page.tsx | L1 ≥90%: tab 切换/筛选/删除 |
| `feat: add forum management viewmodel + page` | useForumManagementViewModel + ForumTree + admin/forums/page.tsx | L1 ≥90%: 树构建/编辑/隐藏/排序 |
| `feat: add admin auth guard` | (admin)/layout.tsx 权限检查 + resolveAdmin() | L1: canAccessAdmin 各角色组合 |

### Step 6：论坛前端 + ViewModel L1 ≥90%

**产出**：04d 全部功能

**前置**：Step 3 + Step 4

| 原子化提交 | 内容 | 测试 |
|-----------|------|------|
| `feat: add forum layout (topbar + navbar + footer)` | ForumLayout + TopBar + ForumNavbar + SiteFooter | L1: 导航渲染 |
| `feat: add forum list page` | useForumListViewModel + ForumGroup + ForumCard + (forum)/page.tsx | L1 ≥90%: 树过滤/隐藏版块 |
| `feat: add thread list page` | useThreadListViewModel + ThreadList + ThreadItem + ThreadBadge + forums/[id]/page.tsx | L1 ≥90%: 排序/筛选/分页/badge |
| `feat: add thread detail page` | useThreadDetailViewModel + PostCard + UserCard + AttachmentResolver + threads/[id]/page.tsx | L1 ≥90%: 附件分组/权限判断/mod actions |
| `feat: add post editor (tiptap)` | usePostEditorViewModel + PostEditor + EmojiPicker | L1 ≥90%: submit/canSubmit/validation |
| `feat: add user profile page` | useUserProfileViewModel + users/[id]/page.tsx | L1 ≥90%: tab 切换/分页 |
| `feat: add search page` | useSearchViewModel + search/page.tsx | L1 ≥90%: titlePrefix/authorName 切换 |
| `feat: add digest page` | useDigestListViewModel + digest/page.tsx | L1: 列表加载 |
| `feat: add login page` | useAuthViewModel + login/page.tsx | L1: login/logout/error states |
| `feat: add proxy route guard` | proxy.ts — 公开/认证/管理路由分类 | L1: 路由匹配逻辑 |

### Step 7：L2 API 集成测试

**产出**：100% API 端点覆盖

**前置**：Step 5 + Step 6（+ API Routes 已在执行计划 4.7 中实现）

> **关于 API Route Handler**：本文档 Step 1-6 聚焦 Model/ViewModel/组件层，API Route Handler（`app/api/v1/*`、`app/api/admin/*`、`app/api/auth/[...nextauth]`）的实现步骤在 [04-application §4.7](./04-application.md) 中单列。Route Handler 是 L2 集成测试的被测对象，必须在 Step 7 之前完成。

| 原子化提交 | 内容 | 测试 |
|-----------|------|------|
| `test: add api test infrastructure` | `tests/integration/setup.ts` — run-e2e.ts 自动启停 dev server（端口 13000） | — |
| `test: add forum api integration tests` | GET /api/v1/forums 全量 + getById | L2: 真 HTTP，断言 JSON 结构 |
| `test: add thread api integration tests` | GET/POST/DELETE /api/v1/threads + search | L2: CRUD + 权限拒绝 |
| `test: add post api integration tests` | GET/POST/DELETE /api/v1/posts + /api/v1/posts/:id | L2: 分页 + 权限 |
| `test: add user profile api tests` | GET /api/v1/users + GET /api/v1/users/:id | L2: 公开资料搜索 + 筛选 |
| `test: add moderation api integration tests` | /api/v1/moderation 端点 | L2: 版主操作 + 权限拒绝 |
| `test: add admin api integration tests` | /api/admin/* 端点 | L2: 管理操作 + 权限守卫 403 |
| `test: add nextauth integration tests` | POST /api/auth/callback/credentials + POST /api/auth/signout + GET /api/auth/session | L2: 成功/失败/session 状态 |

> **Step 7 结束时**：L1 + L2 + G1 + G2 全部达标。D1=N/A，**Tier B（Mock 阶段上限）**。

### Step 8：L3 E2E + 高级功能

**产出**：关键路径 E2E 覆盖 + 04e 选取功能

**前置**：Step 7

| 原子化提交 | 内容 | 测试 |
|-----------|------|------|
| `test: add playwright e2e setup` | Playwright 配置 + 端口 23000 | — |
| `test: add e2e critical path` | 登录 → 浏览版块 → 查看帖子 → 发帖 → 回帖 | L3 |
| `test: add e2e admin path` | 登录 Admin → 仪表盘 → 用户管理 → 封禁 | L3 |
| `test: add e2e theme + responsive` | 暗黑模式切换 + mobile 导航 | L3 |
| `feat: add vote poll mock ui (04e)` | VotePoll mock 交互 UI（投票/查看结果） | L1: 投票状态切换 |
| `feat: add smiley renderer (04e)` | /smileys/ 图片兼容渲染 | L1 |

> **注意**：ThreadBadge special types 已在 Step 2（model 层 getThreadBadges）和 Step 6（组件层 ThreadBadge）中完成，此处不再重复。
>
> **Step 8 结束时**：L1 + L2 + L3 + G1 + G2 五维达标，D1=N/A。**Tier B（Mock 阶段上限）**。Phase 2 接入真实 D1 后可升级至 Tier S。

### 质量体系演进时间线

```
Step 1 ─────────────────────────────────────── G1 + L1(空) + G2 → Tier B
Step 2 ─── models/ ≥95% ─────────────────────── L1 有效 → Tier B
Step 3 ─── data/ ≥95% ──────────────────────── L1 全层 → Tier B
Step 4-6 ── viewmodels/ ≥90%, components/ ≥80% ── L1 全覆盖 → Tier B
Step 7 ─── L2 100% API ─────────────────────── + L2 → Tier B ★
Step 8 ─── L3 关键路径 ─────────────────────── + L3 → Tier B ★
```

> ★ Step 7/8 实际已达到 L1+L2+L3+G1+G2 五维全绿，但 D1=N/A（Mock 阶段无真实数据库隔离），根据 Tier 判定规则封顶 Tier B。Phase 2 接入真实 D1 后，五维基础已就绪，可直接升级至 Tier A/S。

> Step 5 和 Step 6 可并行开展，两者共享 Step 3（数据层）和 Step 4（布局）。
