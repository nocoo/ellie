# 应用设计（执行计划）

> Phase 3 前端预研与原型设计。本文档是执行入口，包含文档索引、编号提交计划和质量演进时间线。

## 1. 文档结构

| 文档 | 主题 | 说明 |
|------|------|------|
| [04a-data-model](./04a-data-model.md) | MVVM 与数据结构 | 类型定义、权限模型、Repository 接口、内容格式规约 |
| [04b-frontend-architecture](./04b-frontend-architecture.md) | 前端架构选型 | 技术栈、项目结构、MVVM 分层、设计系统、认证方案、质量体系 |
| [04c-admin-console](./04c-admin-console.md) | 管理后台 | Admin 布局、仪表盘/用户管理/内容审核/版块管理 |
| [04d-forum-frontend](./04d-forum-frontend.md) | 论坛前端 | 论坛布局、核心页面、分页策略、搜索、发帖回帖 |
| [04e-advanced-features](./04e-advanced-features.md) | 高级功能 | 特殊帖子类型、富文本编辑器、表情系统、全文搜索、私信 |

### 文档间依赖

```
04a (数据结构)
  │
  ├──→ 04b (架构选型) ──→ 04c (Admin)
  │                   ──→ 04d (论坛)
  │                           │
  └───────────────────────────┴──→ 04e (高级功能)
```

## 2. 定位与约束

**目标**：搭建前端视觉原型（管理后台 + 论坛前端），Mock 数据驱动，不连接真实数据库。

**与其他文档的关系**：
- Doc01 Phase 顺序不变：Phase 2 先建 API + Worker，Phase 3 再建前端
- 本系列是 Phase 3 的**预研与设计**，当前 worktree 只做原型
- Phase 2 Worker API 就绪后，前端通过 Repository 接口切换到真实数据源

**工具链（与 Doc01 一致）**：

| 层 | 工具 | 说明 |
|---|---|---|
| Lint + Format | **Biome** (strict) | 仓库已有 `biome.json`，不引入 ESLint |
| 测试 | **bun test** | L1 + L2 均用 bun test |
| E2E | Playwright | L3 端到端测试 |
| 包管理 | Bun | 单包结构，代码放 `src/` |

---

## 3. 六维质量体系

### 3.1 维度定义

| 维度 | 工具 | 触发时机 | 说明 |
|------|------|---------|------|
| **L1 Unit** | bun test | pre-commit | Model 纯函数 + ViewModel hooks + 组件渲染 |
| **L2 Integration** | bun test (真 HTTP) | pre-push | API 端点测试，自动启停 dev server |
| **L3 E2E** | Playwright | CI | 关键路径：登录→浏览→发帖→回帖→管理 |
| **G1 Static** | Biome strict | pre-commit | `--max-warnings=0` |
| **G2 Security** | osv-scanner + gitleaks | pre-push | 依赖漏洞 + 密钥泄露扫描 |
| **D1 Isolation** | N/A（Mock 阶段） | — | 当前无真实数据库隔离，D1 缺失导致 **Tier 封顶 B**；Phase 2 接入后补齐 |

### 3.2 分层覆盖率目标

| 目录 | 目标 | 理由 |
|------|------|------|
| `models/` | ≥95% | 纯函数，0 依赖，行为必须精确 |
| `data/repositories/` | ≥95% | 数据层 contract 必须可信 |
| `lib/` | ≥95% | 工具函数（attachmentUrl, sanitize 等） |
| `viewmodels/` | ≥90% | 组合 model + repo，需覆盖状态变换 |
| 业务组件（`components/forum/`, `components/admin/`） | ≥80% | 关键交互和条件渲染 |
| UI 壳层（`page.tsx`, `layout.tsx`, `components/ui/`） | 豁免 | shadcn 已验证，壳层无逻辑 |

> **与 Doc01 的覆盖率差异**：Doc01 给 Phase 1 ETL 定 ≥95%，因为迁移工具是纯数据转换。前端 ViewModel/组件层包含大量 UI 状态交互，≥90%/≥80% 是实际可维护的目标。

### 3.3 Tier 判定

| Tier | 条件 |
|------|------|
| **S** | 六维全绿（含 D1） |
| **A** | L1 + L2 + G1 + D1 + 至少一项（L3/G2） |
| **B** | L1 + G1（+ 可选 L2/L3/G2，但无 D1 封顶于此） |
| **C** | L1 或 G1 任一不达标 |

> **Mock 阶段上限**：D1 是 Tier A 的必要条件（见 04b §10）。当前阶段无真实数据库隔离，D1=N/A，因此 **Mock 阶段最高 Tier B**。Phase 2 接入 D1 后方可升级。

### 3.4 Hook 映射

| Hook | 执行内容 | 时间限制 |
|------|---------|---------|
| pre-commit | Biome check (G1) + bun test (L1) | <30s |
| pre-push | L1 + L2 + osv-scanner + gitleaks (G2) | <3min |

---

## 4. 编号执行计划

> **当前仓库状态**：`package.json` 仅包含迁移脚本和 Biome/Bun 类型依赖。Step 4.1 开始引入 Next.js 全套前端依赖。
>
> **核心原则**：质量体系从第一步建立，每一步伴随对应测试和门控。不存在"先写代码、最后补测试"的阶段。

### 依赖关系总览

```
4.1 脚手架 ──→ 4.2 Contract 层 ──→ 4.3 Mock 数据层 ──┬──→ 4.5 Admin 后台
     │                                                │
     └──→ 4.4 共享布局 ─────────────────────────────────┤
                                                      └──→ 4.6 论坛前端
                                                              │
                                          4.3 + 4.5 + 4.6 ──→ 4.7 API Routes
                                                                     │
                                                                     └──→ 4.8 L2 集成测试
                                                                              │
                                                                              └──→ 4.9 L3 E2E + 高级功能
```

> 4.5 和 4.6 可并行开展，共享 4.3（数据层）和 4.4（布局）。4.7 API Routes 实现依赖 4.3（Repository）+ 4.5/4.6（确认页面所需端点）。

---

### 4.1 脚手架 + 质量基础设施

**参考文档**：04b §1 技术栈 + §4 设计系统 + §10 质量体系

**产出**：可运行的空壳项目 + 六维质量体系骨架（G1 + L1 + G2 三维立即生效）

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 4.1.1 | `feat: init next.js 16 project with bun` | Next.js 16 + TypeScript strict + Bun | ✅ |
| 4.1.2 | `feat: add tailwind v4 + design tokens` | Tailwind CSS v4 + `tailwind.css` 设计 token + 暗黑模式变量 | ✅ |
| 4.1.3 | `feat: add shadcn/ui base components` | shadcn/ui init + Button/Card/Badge 等基础组件 | ✅ |
| 4.1.4 | `chore: setup husky + lint-staged + biome strict` | Husky pre-commit (G1: biome check) + pre-push 骨架 | ✅ **G1 生效** |
| 4.1.5 | `chore: setup bun test + coverage config` | bun test 配置 + coverage 排除规则 + pre-commit 加入 L1 | ✅ **L1 管道生效** |
| 4.1.6 | `chore: setup g2 security scanning` | pre-push 加入 osv-scanner + gitleaks | ✅ **G2 生效** |

> **4.1 结束时**：pre-commit = G1 + L1，pre-push = G2。**Tier B 门控骨架就位**（L1 管道空跑，4.2 起产生实际覆盖率）。
>
> **依赖引入时点**（供执行参考）：
> | 依赖 | 引入步骤 | 说明 |
> |------|---------|------|
> | NextAuth | 4.3.8 | auth mock + credentials provider |
> | Tiptap | 4.6.5 | 富文本编辑器 |
> | Recharts / Chart 库 | 4.5.2 | Admin 仪表盘趋势图 |
> | Playwright | 4.9.1 | E2E 测试 |
> | Smiley assets | 4.9.6 | 表情兼容渲染 |

---

### 4.2 Contract 层（models + data 接口）

**参考文档**：04a 全文（类型、权限、Repository 接口、内容格式规约）

**产出**：04a 的全部类型定义、权限函数、Repository 接口，L1 测试锁定

**前置**：4.1

| 编号 | 提交信息 | 内容 | 测试 |
|------|---------|------|------|
| 4.2.1 | `feat: add core type definitions` | `models/types.ts` — 所有 enum + interface | 编译验证 |
| 4.2.2 | `feat: add permission model + tests` | `models/permission.ts` + tests | L1 ≥95%: 全量 role × status × action 组合 |
| 4.2.3 | `feat: add thread model functions + tests` | `models/thread.ts` (getThreadBadges, decodeHighlight) + tests | L1 ≥95%: 所有 special/sticky/digest 组合 |
| 4.2.4 | `feat: add forum model functions + tests` | `models/forum.ts` (buildForumTree, filterVisibleForums) + tests | L1 ≥95%: 空数组/单层/三层嵌套 |
| 4.2.5 | `feat: add pagination utilities + tests` | `models/pagination.ts` (cursor encode/decode) + tests | L1 ≥95% |
| 4.2.6 | `feat: add shared lib utilities + tests` | `lib/utils.ts`, `lib/attachment.ts` (attachmentUrl, thumbnailUrl, sanitize) + tests | L1 ≥95% |
| 4.2.7 | `feat: add repository interfaces` | `data/repositories/types.ts` — 全部 Repository 接口 | 编译验证 |

> **4.2 结束时**：`models/` + `lib/` 覆盖率 ≥95%，Contract 通过 L1 锁定。

---

### 4.3 Mock 数据层

**参考文档**：04a §Repository 接口 + 04b §3 MVVM（Repository 工厂）

**产出**：Repository Mock 实现 + Auth Mock，数据可驱动 UI

**前置**：4.2

| 编号 | 提交信息 | 内容 | 测试 |
|------|---------|------|------|
| 4.3.1 | `feat: add mock data sets` | `data/mock/users.ts`, `forums.ts`, `threads.ts`, `posts.ts`, `attachments.ts` | — |
| 4.3.2 | `feat: add mock forum repository + tests` | `data/repositories/forum.repository.ts` + tests | L1 ≥95%: listAll/getById/update |
| 4.3.3 | `feat: add mock thread repository + tests` | `data/repositories/thread.repository.ts` + tests | L1 ≥95%: list/search/create/delete/mod 操作 |
| 4.3.4 | `feat: add mock post repository + tests` | `data/repositories/post.repository.ts` + tests | L1 ≥95%: list by threadId/authorId |
| 4.3.5 | `feat: add mock user repository + tests` | `data/repositories/user.repository.ts` + tests | L1 ≥95%: list/search/filter/setStatus/setRole |
| 4.3.6 | `feat: add mock attachment repository + tests` | `data/repositories/attachment.repository.ts` + tests | L1 ≥95% |
| 4.3.7 | `feat: add repository factory` | `data/index.ts` — createRepositories() | — |
| 4.3.8 | `feat: add auth mock (nextauth credentials)` | `auth.ts` + mock user 验证 | L1: login success/failure |

> **4.3 结束时**：`data/` 覆盖率 ≥95%，Repository Contract 完全可验证。

---

### 4.4 共享布局组件

**参考文档**：04b §4 设计系统 + §5 响应式（从 basalt/pew 复用的模式）

**产出**：论坛 + Admin 共用的布局和 UI 组件

**前置**：4.1

| 编号 | 提交信息 | 内容 | 测试 |
|------|---------|------|------|
| 4.4.1 | `feat: add theme toggle (light/dark/system)` | ThemeToggle + useTheme hook + FOUC 防闪 script | L1: hook 状态切换 |
| 4.4.2 | `feat: add breadcrumbs component` | Breadcrumbs 通用组件 | L1: 渲染 + 层级正确性 |
| 4.4.3 | `feat: add keyset pagination component` | ForumPagination + usePagination hook | L1: loadMore/loadPrev/reset |
| 4.4.4 | `feat: add user avatar component` | UserAvatar (R2 path → img) | L1: 有头像/无头像/fallback |
| 4.4.5 | `feat: add responsive hooks` | useIsMobile + useDebounce | L1 ≥95% (纯 hook) |

> **4.4 结束时**：共享组件就绪，4.5 和 4.6 可并行开展。

---

### 4.5 管理后台

**参考文档**：04c 全文（Admin 布局、仪表盘、用户/内容/版块管理）

**产出**：04c 全部功能模块

**前置**：4.3 + 4.4

| 编号 | 提交信息 | 内容 | 测试 |
|------|---------|------|------|
| 4.5.1 | `feat: add admin layout (sidebar + header)` | AdminLayout + AdminSidebar | L1: sidebar 折叠/展开 |
| 4.5.2 | `feat: add dashboard viewmodel + page` | useDashboardViewModel + StatCard + ChartWidgets + admin/page.tsx | L1 ≥90%: 数据聚合逻辑 |
| 4.5.3 | `feat: add user management viewmodel + page` | useUserManagementViewModel + UserTable + admin/users/page.tsx | L1 ≥90%: 筛选/搜索/ban/unban/roleChange |
| 4.5.4 | `feat: add content moderation viewmodel + page` | useContentModerationViewModel + ContentTable + admin/content/page.tsx | L1 ≥90%: tab 切换/筛选/物理删除 |
| 4.5.5 | `feat: add forum management viewmodel + page` | useForumManagementViewModel + ForumTree + admin/forums/page.tsx | L1 ≥90%: 树构建/编辑/隐藏/排序 |
| 4.5.6 | `feat: add admin auth guard` | (admin)/layout.tsx 权限检查 + resolveAdmin() | L1: canAccessAdmin 各角色组合 |

> **4.5 结束时**：Admin 后台功能完整，ViewModel L1 ≥90%。

---

### 4.6 论坛前端

**参考文档**：04d 全文（论坛布局、版块/帖子/用户、分页、搜索）

**产出**：04d 全部功能

**前置**：4.3 + 4.4

| 编号 | 提交信息 | 内容 | 测试 |
|------|---------|------|------|
| 4.6.1 | `feat: add forum layout (topbar + navbar + footer)` | ForumLayout + TopBar + ForumNavbar + SiteFooter | L1: 导航渲染 |
| 4.6.2 | `feat: add forum list page` | useForumListViewModel + ForumGroup + ForumCard + (forum)/page.tsx | L1 ≥90%: 树过滤/隐藏版块 |
| 4.6.3 | `feat: add thread list page` | useThreadListViewModel + ThreadList + ThreadItem + ThreadBadge + forums/[id]/page.tsx | L1 ≥90%: 排序/筛选/分页/badge |
| 4.6.4 | `feat: add thread detail page` | useThreadDetailViewModel + PostCard + UserCard + AttachmentResolver + threads/[id]/page.tsx | L1 ≥90%: 附件分组/权限判断/mod actions |
| 4.6.5 | `feat: add post editor (tiptap)` | usePostEditorViewModel + PostEditor + EmojiPicker | L1 ≥90%: submit/canSubmit/validation |
| 4.6.6 | `feat: add user profile page` | useUserProfileViewModel + users/[id]/page.tsx | L1 ≥90%: tab 切换/分页 |
| 4.6.7 | `feat: add search page` | useSearchViewModel + search/page.tsx | L1 ≥90%: titlePrefix/authorName 切换 |
| 4.6.8 | `feat: add digest page` | useDigestListViewModel + digest/page.tsx | L1: 列表加载 |
| 4.6.9 | `feat: add login page` | useAuthViewModel + login/page.tsx | L1: login/logout/error states |
| 4.6.10 | `feat: add proxy route guard` | proxy.ts — 公开/认证/管理路由分类 | L1: 路由匹配逻辑 |

> **4.6 结束时**：论坛前端功能完整，ViewModel L1 ≥90%，业务组件 L1 ≥80%。

---

### 4.7 API Routes 实现

**参考文档**：04b §API 路由边界（/api/v1/*、/api/admin/*、/api/auth/[...nextauth]）

**产出**：所有 API Route Handler，调用 Repository 返回 JSON

**前置**：4.3 + 4.5 + 4.6

> **为什么单独一步**：04b 将 API Routes 列为正式交付物（04b:64-67），Route Handler 是 L2 集成测试的被测对象。页面组件（4.5/4.6）通过 ViewModel → Repository 获取数据，不经过 API Route；但外部消费者和 L2 测试需要真实 HTTP 端点。

| 编号 | 提交信息 | 内容 | 测试 |
|------|---------|------|------|
| 4.7.1 | `feat: add nextauth route handler` | `app/api/auth/[...nextauth]/route.ts` — NextAuth catch-all（credentials provider） | L1: config 验证 |
| 4.7.2 | `feat: add forum api routes` | `app/api/v1/forums/route.ts` + `app/api/v1/forums/[id]/route.ts` | L1: handler 调用 repo |
| 4.7.3 | `feat: add thread api routes` | `app/api/v1/threads/route.ts` + `app/api/v1/threads/[id]/route.ts` — GET/POST/DELETE | L1: CRUD 路由 |
| 4.7.4 | `feat: add post api routes` | `app/api/v1/posts/route.ts` + `app/api/v1/posts/[id]/route.ts` — GET/POST/DELETE | L1: 分页 + 权限守卫 |
| 4.7.5 | `feat: add user profile api route` | `app/api/v1/users/route.ts` + `app/api/v1/users/[id]/route.ts` — 公开资料 | L1: 搜索/筛选 |
| 4.7.6 | `feat: add moderation api routes` | `app/api/v1/moderation/route.ts` — 版主操作 | L1: role ∈ {1,2,3} 守卫 |
| 4.7.7 | `feat: add admin api routes` | `app/api/admin/users/route.ts`, `app/api/admin/content/route.ts`, `app/api/admin/forums/route.ts` | L1: role ∈ {1,2} 守卫 |

> **4.7 结束时**：所有 API 端点实现完毕，L2 集成测试有真实被测对象。

---

### 4.8 L2 集成测试

**参考文档**：04b §10 质量体系（L2 维度规范）

**产出**：100% API 端点覆盖

**前置**：4.7

| 编号 | 提交信息 | 内容 | 测试 |
|------|---------|------|------|
| 4.8.1 | `test: add api test infrastructure` | `tests/integration/setup.ts` — 自动启停 dev server（端口 13000） | — |
| 4.8.2 | `test: add forum api integration tests` | GET /api/v1/forums 全量 + getById | L2: 真 HTTP，断言 JSON 结构 |
| 4.8.3 | `test: add thread api integration tests` | GET/POST/DELETE /api/v1/threads + search | L2: CRUD + 权限拒绝 |
| 4.8.4 | `test: add post api integration tests` | GET/POST/DELETE /api/v1/posts | L2: 分页 + 权限 |
| 4.8.5 | `test: add user profile api tests` | GET /api/v1/users + GET /api/v1/users/:id | L2: 公开资料搜索 + 筛选 |
| 4.8.6 | `test: add moderation api integration tests` | /api/v1/moderation 端点 | L2: 版主操作 + 权限拒绝 |
| 4.8.7 | `test: add admin api integration tests` | /api/admin/* 端点 | L2: 管理操作 + 权限守卫 403 |
| 4.8.8 | `test: add nextauth integration tests` | POST /api/auth/callback/credentials + POST /api/auth/signout + GET /api/auth/session | L2: 成功/失败/session 状态 |

> **4.8 结束时**：L1 + L2 + G1 + G2 全部达标。D1=N/A，**Tier B（Mock 阶段上限）**。

---

### 4.9 L3 E2E + 高级功能

**参考文档**：04e 全文（特殊帖子类型、表情兼容）+ 04b §10（L3 规范）

**产出**：关键路径 E2E 覆盖 + 04e 选取功能

**前置**：4.8

| 编号 | 提交信息 | 内容 | 测试 |
|------|---------|------|------|
| 4.9.1 | `test: add playwright e2e setup` | Playwright 配置 + 端口 23000 | — |
| 4.9.2 | `test: add e2e critical path` | 登录 → 浏览版块 → 查看帖子 → 发帖 → 回帖 | L3 |
| 4.9.3 | `test: add e2e admin path` | 登录 Admin → 仪表盘 → 用户管理 → 封禁 | L3 |
| 4.9.4 | `test: add e2e theme + responsive` | 暗黑模式切换 + mobile 导航 | L3 |
| 4.9.5 | `feat: add vote poll mock ui (04e)` | VotePoll mock 交互 UI（投票/查看结果） | L1: 投票状态切换 |
| 4.9.6 | `feat: add smiley renderer (04e)` | /smileys/ 图片兼容渲染 | L1 |

> **注意**：ThreadBadge special types 已在 4.2.3（model 层 getThreadBadges）和 4.6.3（组件层 ThreadBadge）中完成，此处不再重复。
>
> **4.9 结束时**：L1 + L2 + L3 + G1 + G2 五维达标，D1=N/A。**Tier B（Mock 阶段上限）**。Phase 2 接入真实 D1 后可升级至 Tier S。

---

## 5. 质量演进时间线

```
4.1  脚手架 ────────────────────────── G1 + L1(空) + G2    → Tier B
4.2  Contract 层 ── models/ ≥95% ───── L1 有效              → Tier B
4.3  Mock 数据层 ── data/ ≥95% ─────── L1 全层              → Tier B
4.4  共享布局 ──────────────────────── components ≥80%      → Tier B
4.5  Admin ─── viewmodels/ ≥90% ────── L1 全覆盖            → Tier B
4.6  论坛 ──── viewmodels/ ≥90% ────── L1 全覆盖            → Tier B
4.7  API Routes ── 全端点实现 ──────── L1 route tests       → Tier B
4.8  L2 测试 ── 100% API ─────────── + L2                  → Tier B ★
4.9  L3 E2E ── 关键路径 ──────────── + L3                  → Tier B ★
```

> ★ 4.8/4.9 实际已达到 L1+L2+L3+G1+G2 五维全绿，但 D1=N/A（Mock 阶段无真实数据库隔离），根据 Tier 判定规则 **封顶 Tier B**。Phase 2 接入真实 D1 后，五维基础已就绪，可直接升级至 Tier A/S。

## 6. 提交统计

| Step | 主题 | 提交数 | 累计 |
|------|------|--------|------|
| 4.1 | 脚手架 + 质量基础 | 6 | 6 |
| 4.2 | Contract 层 | 7 | 13 |
| 4.3 | Mock 数据层 | 8 | 21 |
| 4.4 | 共享布局 | 5 | 26 |
| 4.5 | Admin 后台 | 6 | 32 |
| 4.6 | 论坛前端 | 10 | 42 |
| 4.7 | API Routes | 7 | 49 |
| 4.8 | L2 集成测试 | 8 | 57 |
| 4.9 | L3 E2E + 高级功能 | 6 | **63** |

## 7. 端到端验证清单

完成全部 63 个提交后，逐项验证：

- [ ] 论坛首页加载，版块列表正确分组展示
- [ ] 点击版块进入帖子列表，keyset 分页工作正常（向前 + 向后）
- [ ] 点击帖子进入详情，楼层回复正确渲染，附件正确解析
- [ ] 登录 → 发帖 → 回帖 完整流程
- [ ] 投票帖 VotePoll mock UI 展示
- [ ] ThreadBadge 正确渲染 special/sticky/digest 组合
- [ ] Admin 仪表盘统计卡 + 趋势图正确展示
- [ ] Admin 用户管理：搜索 → 封禁 → 角色变更
- [ ] Admin 内容审核：筛选 → 物理删除
- [ ] 暗黑模式切换无闪烁（FOUC 防闪 script 生效）
- [ ] Mobile 端：汉堡菜单/sidebar 抽屉/导航正常
- [ ] API Routes 返回正确 JSON（/api/v1/* + /api/admin/*）
- [ ] NextAuth 登录/登出/session 端点正常
- [ ] 所有 L1 测试通过，分层覆盖率达标
- [ ] 所有 L2 测试通过，API 端点 100% 覆盖
- [ ] Playwright E2E 关键路径通过
- [ ] pre-commit hook 正常拦截（G1 + L1）
- [ ] pre-push hook 正常拦截（L2 + G2）
