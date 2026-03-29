# 04c — 管理后台

> Admin 控制台的布局、数据层、功能模块和原子化提交计划。
> 基于 Worker API 44 个已部署端点，覆盖全部 7 个实体的完整 CRUD + 自定义操作。
>
> **前置依赖**：04a（类型 + Repository 接口）、04b（架构 + 设计系统）、05（Worker API）

---

## 1. 布局

沿用 AdminLayout + AdminSidebar 响应式 shell，扩展导航项以覆盖全部实体。

```
┌───────────────────────────────────────────────────────┐
│  Sidebar (260px / 68px collapsed)  │  Main Area       │
│                                    │                  │
│  ┌─ Brand ──────────────────────┐  │  ┌─ Header ────┐│
│  │  Ellie Admin    v0.1.0       │  │  │ 页面标题  🌙 ││
│  ├─ Navigation ─────────────────┤  │  ├─────────────┤│
│  │                              │  │  │             ││
│  │  📊 Dashboard                │  │  │  Content    ││
│  │                              │  │  │  bg-card    ││
│  │  ── 内容管理 ──               │  │  │  rounded-20 ││
│  │  👤 Users                    │  │  │             ││
│  │  💬 Threads                  │  │  │             ││
│  │  📝 Posts                    │  │  │             ││
│  │  📂 Forums                   │  │  │             ││
│  │  📎 Attachments              │  │  │             ││
│  │                              │  │  │             ││
│  │  ── 安全管理 ──               │  │  │             ││
│  │  🚫 IP Bans                  │  │  │             ││
│  │  🔤 Censor Words             │  │  │             ││
│  │                              │  │  │             ││
│  ├─ User ───────────────────────┤  │  │             ││
│  │  [avatar] Admin · 登出        │  │  └─────────────┘│
│  └──────────────────────────────┘  │                  │
└───────────────────────────────────────────────────────┘
```

### 1.1 导航分组

> **认证模型**：Admin 身份由 Google OAuth 登录 + `ADMIN_EMAILS` 环境变量白名单（逗号分隔 email，大小写不敏感）定义，与论坛用户完全独立。Admin Console 使用 `ADMIN_API_KEY`（Key B）访问 Worker `/api/admin/*` 端点。所有通过白名单的 Admin 全权相等，不分级。

| 分组 | 项目 | 路由 |
|------|------|------|
| — | Dashboard | `/admin` |
| 内容管理 | Users | `/admin/users` |
| | Threads | `/admin/threads` |
| | Posts | `/admin/posts` |
| | Forums | `/admin/forums` |
| | Attachments | `/admin/attachments` |
| 安全管理 | IP Bans | `/admin/ip-bans` |
| | Censor Words | `/admin/censor-words` |

> **Settings**（系统设置）后置，不纳入本期。

### 1.2 路由结构

```
src/app/(admin)/
├── layout.tsx                          # AdminLayout + 权限守卫
└── admin/
    ├── page.tsx                        # /admin — Dashboard
    ├── users/page.tsx                  # /admin/users
    ├── threads/page.tsx                # /admin/threads
    ├── posts/page.tsx                  # /admin/posts
    ├── forums/page.tsx                 # /admin/forums
    ├── attachments/page.tsx            # /admin/attachments
    ├── ip-bans/page.tsx                # /admin/ip-bans
    └── censor-words/page.tsx           # /admin/censor-words
```

### 1.3 响应式行为（沿用）

- Desktop (>1024px): Sidebar 260px，可折叠到 68px（icon-only）
- Tablet (768–1024px): Sidebar 默认 collapsed (68px)
- Mobile (<768px): Sidebar 隐藏，通过汉堡按钮触发 overlay 抽屉

### 1.4 组件清单

```
src/components/layout/
├── admin-layout.tsx                    # 沿用：Sidebar + Header + Content shell
├── admin-sidebar.tsx                   # 重建：分组导航（内容管理 / 安全管理）

src/components/admin/
├── admin-data-table.tsx                # 新建：通用数据表格（列定义 + 排序 + 选择）
├── admin-pagination.tsx                # 新建：offset 分页控件（page/limit/total）
├── admin-filters.tsx                   # 新建：通用筛选栏（搜索 + 下拉 + 重置）
├── admin-batch-bar.tsx                 # 新建：批量操作浮动栏（选中 N 项 → 操作按钮）
├── admin-confirm-dialog.tsx            # 新建：确认对话框（危险操作二次确认）
├── stat-card.tsx                       # 重建：从 page 内联提取为独立组件
└── [entity]-*.tsx                      # 各实体的专属组件（详见各模块）
```

---

## 2. 数据层：API 代理

### 2.1 架构

```
Browser (Client Component)
  │ fetch("/api/admin/users?page=1")
  ▼
Next.js API Route (/api/admin/users/route.ts)
  │ 读取 Google OAuth session → 验证 email ∈ ADMIN_EMAILS → Key B 直连 Worker
  │ fetch(WORKER_URL + "/api/admin/users?page=1", { headers: { X-API-Key: ADMIN_API_KEY } })
  ▼
Cloudflare Worker (ellie.worker)
  │ 验证 ADMIN_API_KEY (Key B) → 执行 D1 查询
  ▼
D1 Database
```

```
Server Component (page.tsx)
  │ 调用 ViewModel 函数
  ▼
ViewModel (viewmodels/admin/users.ts)
  │ 调用 adminApi.users.list(filters)
  ▼
adminApiClient (lib/admin-api.ts)
  │ fetch(WORKER_URL + path, { headers: { X-API-Key: ADMIN_API_KEY } })
  │ 服务端直连 Worker（无跨域，无代理开销）
  ▼
Cloudflare Worker → D1
```

**两条数据通路**：

| 场景 | 路径 | 说明 |
|------|------|------|
| **Server Component 读数据** | page → ViewModel → adminApiClient → Worker | 服务端直连，无需 Next.js API Route |
| **Client Component 写数据** | button → fetch("/api/admin/*") → API Route → Worker | 浏览器不能直连 Worker（跨域 + 密钥），需代理 |

### 2.2 adminApiClient

```typescript
// lib/admin-api.ts — 服务端 Worker API 客户端
// 仅在 Server Component / API Route 中使用

const WORKER_URL = process.env.WORKER_API_URL!;         // e.g. https://ellie.worker.hexly.ai
const ADMIN_API_KEY = process.env.ADMIN_API_KEY!;        // Key B — Admin 专用密钥，不暴露给浏览器

// 通用 GET/POST/PATCH/DELETE 方法
// 内部自动注入 X-API-Key: ADMIN_API_KEY（仅此一个认证头）
// 调用方（API Route / Server Component）在调用前已验证 Google OAuth session
// 统一解析 { data, meta } 响应格式
// 错误时抛出 typed AdminApiError
```

### 2.3 Next.js API Route 代理约定

每个 API Route 做三件事：
1. **验证 admin** — 调用 `resolveAdmin(session)` 验证 email ∈ `ADMIN_EMAILS`
2. **转发** — 调用 adminApiClient 发往 Worker（仅 `X-API-Key: ADMIN_API_KEY`）
3. **返回** — 透传 Worker 响应（status code + body）

```
src/app/api/admin/
├── stats/route.ts                      # GET → Worker /api/admin/stats
├── users/route.ts                      # GET (list)
├── users/[id]/route.ts                 # GET / PATCH
├── users/[id]/ban/route.ts             # POST → ban
├── users/[id]/nuke/route.ts            # POST → nuke
├── users/batch-status/route.ts         # POST → batchStatus
├── users/batch-role/route.ts           # POST → batchRole
├── threads/route.ts                    # GET (list)
├── threads/[id]/route.ts              # GET / PATCH / DELETE
├── threads/batch-delete/route.ts       # POST
├── threads/batch-move/route.ts         # POST
├── posts/route.ts                      # GET (list)
├── posts/[id]/route.ts               # GET / PATCH / DELETE
├── posts/batch-delete/route.ts         # POST
├── forums/route.ts                     # GET (list) / POST (create)
├── forums/[id]/route.ts              # GET / PATCH / DELETE
├── forums/[id]/merge/route.ts        # POST
├── forums/reorder/route.ts            # POST
├── attachments/route.ts               # GET (list)
├── attachments/[id]/route.ts          # GET / DELETE
├── attachments/batch-delete/route.ts   # POST
├── ip-bans/route.ts                    # GET (list) / POST (create)
├── ip-bans/[id]/route.ts             # GET / PATCH / DELETE
├── ip-bans/batch-delete/route.ts       # POST
├── ip-bans/check-ip/route.ts          # GET
├── censor-words/route.ts              # GET (list) / POST (create)
├── censor-words/[id]/route.ts         # GET / PATCH / DELETE
├── censor-words/batch-delete/route.ts  # POST
└── censor-words/test/route.ts          # POST
```

### 2.4 Auth 传递

```
Browser → Google Sign-In → NextAuth Google Provider
  │
  ▼ NextAuth 设置 HttpOnly + Secure session cookie
浏览器仅持有 session cookie，不持有任何 Worker 凭证
  │
  ▼ 后续请求
          API Route / Server Component
                   │ 读取 NextAuth session → 验证 email ∈ ADMIN_EMAILS
                   │
                   ▼ adminApiClient 发往 Worker
          X-API-Key: <ADMIN_API_KEY>             ← Key B（仅此一个认证头）
                   │
                   ▼
          Worker 验证 Key B → 执行操作（不关心调用者身份）
```

> **架构决策**：Admin 后台使用 **ADMIN_API_KEY（Key B）服务端直连 Worker**，与论坛 API_KEY（Key A）完全隔离。
>
> - 浏览器 **只持有 HttpOnly + Secure 的 session cookie**，不持有 Key B 或任何 Worker 凭证。
> - NextAuth Google Provider 完成前端身份验证，`resolveAdmin(session)` 验证 email ∈ `ADMIN_EMAILS`。
> - `adminApiClient` 仅注入 `X-API-Key: ADMIN_API_KEY`（无 Authorization header）。
> - Worker 仅验证 Key B，不感知 Admin 身份——信任持有 Key B 的调用方。
> - **ADMIN_EMAILS** 和 **AUTH_GOOGLE_ID** 是 Next.js 服务端环境变量（`apps/web/.env.local`），不在 Worker 中。

### 2.5 CSRF 防护

Admin 写操作依赖浏览器携带的 HttpOnly session cookie 命中 Next.js `/api/admin/*` 代理，必须防范跨站请求伪造（CSRF）。

**防护措施（两层）：**

1. **SameSite cookie**：NextAuth session cookie 设置 `SameSite=Lax`（默认）。Lax 模式阻止跨站 POST/PATCH/DELETE 请求携带 cookie，仅允许顶级导航（GET）。
2. **Origin 校验**：每个 `/api/admin/*` 代理 handler 在验证 session 前，检查 `Origin` 或 `Referer` header 是否匹配允许的域名列表。不匹配或缺失时返回 403。

```typescript
// lib/admin-proxy.ts — CSRF 校验（在 session 验证之前）
const ALLOWED_ORIGINS = [
  process.env.AUTH_URL,                        // e.g. https://ellie.dev.hexly.ai
  "http://localhost:3000",                     // 本地开发
].filter(Boolean);

function validateOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin")
    || request.headers.get("Referer");
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => origin.startsWith(allowed!));
}

// 在 createProxyHandler() 中：
// if (request.method !== "GET" && !validateOrigin(request)) {
//   return Response.json({ error: { code: "CSRF_REJECTED", message: "Origin not allowed" } }, { status: 403 });
// }
```

> **设计决策**：SameSite=Lax 已覆盖大部分攻击面，Origin 校验提供纵深防御。不需要前端手动管理 CSRF token——NextAuth CSRF protection 仅作用于 `/api/auth/*` 端点本身，不适用于自定义 API Route。

### 2.6 Next.js 服务端环境变量

Admin Console 所需的环境变量全部配置在 `apps/web/.env`（或 Vercel / Cloudflare Pages 环境变量），不在 Worker 中。

| 变量 | 类型 | 说明 |
|------|------|------|
| `WORKER_API_URL` | URL | Worker 基础 URL（如 `https://ellie.worker.hexly.ai`） |
| `ADMIN_API_KEY` | secret | Key B — `/api/admin/*` 凭证，仅服务端可见 |
| `ADMIN_EMAILS` | secret | 允许登录 Admin 的 email 白名单（逗号分隔，大小写不敏感） |
| `AUTH_GOOGLE_ID` | secret | Google OAuth Client ID（NextAuth Google Provider 配置） |
| `AUTH_GOOGLE_SECRET` | secret | Google OAuth Client Secret（NextAuth Google Provider 配置） |
| `AUTH_SECRET` | secret | NextAuth v5 session 签名密钥（用于加密 JWT cookie） |
| `AUTH_URL` | URL | NextAuth 回调基础 URL（如 `https://ellie.dev.hexly.ai`） |

> **安全要求**：`ADMIN_API_KEY`、`AUTH_GOOGLE_SECRET`、`AUTH_SECRET` 不能出现在客户端 bundle 中。Next.js 中不以 `NEXT_PUBLIC_` 前缀命名即可保证仅服务端可见。

---

## 3. 功能模块

### 3.1 Dashboard（/admin）

**数据源**：`GET /api/admin/stats`（单次调用，Worker 端 batch 9 条 COUNT 查询）

**响应结构**：

```json
{
  "data": {
    "users":   { "total": 1234, "today": 5, "banned": 12 },
    "threads": { "total": 5678, "today": 23 },
    "posts":   { "total": 34567, "today": 89 },
    "forums":  { "total": 213, "hidden": 3 }
  }
}
```

**UI 布局**：

```
┌─ Stats Cards (4列) ──────────────────────────────────┐
│ [Total Users: 1,234] [Total Threads: 5,678]          │
│ [Posts Today: 89]    [Active Forums: 210]             │
└──────────────────────────────────────────────────────┘
┌─ Detail Cards (2列) ─────────────────────────────────┐
│ Users                    │ Content                    │
│ • Total: 1,234           │ • Threads: 5,678           │
│ • Today: 5               │ • Today: 23                │
│ • Banned: 12             │ • Posts: 34,567             │
│                          │ • Today: 89                │
├──────────────────────────┼───────────────────────────┤
│ Forums                   │ Quick Links               │
│ • Total: 213             │ • Manage Users →           │
│ • Hidden: 3              │ • Manage Forums →          │
│                          │ • IP Bans →                │
└──────────────────────────┴───────────────────────────┘
```

> **移除趋势图**：原设计的 7 天趋势图（Recharts）依赖客户端聚合，Stats 端点不提供时序数据。移除趋势图，改为结构化统计卡片。如未来需要趋势数据，在 Worker 新增 `/api/admin/stats/trend` 端点。
>
> **移除"最近列表"**：原设计的最近用户/最近帖子依赖 Repository，改为 Quick Links 导航到对应管理页（按最新排序）。

**ViewModel**：

```typescript
// viewmodels/admin/dashboard.ts
export interface DashboardStats {
  users:   { total: number; today: number; banned: number };
  threads: { total: number; today: number };
  posts:   { total: number; today: number };
  forums:  { total: number; hidden: number };
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  // adminApiClient.get("/api/admin/stats") → data
}
```

**组件**：

| 组件 | 说明 |
|------|------|
| `stat-card.tsx` | 统计卡片（label + value + 可选 sub-items） |

---

### 3.2 Users（/admin/users）

**Worker 端点**：7 个（Admin 权限，Key B）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/users` | 列表（分页 + 筛选） |
| GET | `/api/admin/users/:id` | 详情 |
| PATCH | `/api/admin/users/:id` | 编辑 |
| POST | `/api/admin/users/:id/ban` | 封禁（可选删除内容） |
| POST | `/api/admin/users/:id/nuke` | 核销（封禁+删除全部+清零积分） |
| POST | `/api/admin/users/batch-status` | 批量改状态（≤100） |
| POST | `/api/admin/users/batch-role` | 批量改角色（≤100） |

**列表筛选**：

| 参数 | 列 | 类型 | 说明 |
|------|-----|------|------|
| `username` | `username` | like | 用户名模糊搜索 |
| `email` | `email` | like | 邮箱模糊搜索 |
| `status` | `status` | exact | 0=正常, -1=封禁, -2=归档 |
| `role` | `role` | exact | 0=User, 1=Admin, 2=SuperMod, 3=Mod |

**列表列定义**：

| 列 | 字段 | 说明 |
|-----|------|------|
| ☐ | — | 复选框（批量选择） |
| User | avatar + username | UserAvatar + 名称 |
| Email | email | — |
| Role | role | Badge（Admin/SuperMod/Mod/Member） |
| Status | status | 彩色 Badge（Active 绿/Banned 红/Archived 灰） |
| Posts | posts | 数字 |
| Registered | regDate | 相对时间 |
| Actions | — | 操作下拉菜单 |

**单行操作**（Actions 下拉菜单）：

| 操作 | API 调用 | 确认 | 条件 |
|------|---------|------|------|
| Edit | → 弹窗编辑表单 | — | 始终可用 |
| Ban | `POST /:id/ban` | ⚠️ 确认对话框 | status ≠ Banned |
| Ban + Delete Content | `POST /:id/ban` body:`{deleteContent:true}` | ⚠️ 危险确认 | status ≠ Banned |
| Unban | `PATCH /:id` body:`{status:0}` | — | status = Banned |
| Nuke | `POST /:id/nuke` | ⚠️ 危险确认（输入用户名确认） | 始终可用 |
| Change Role | `PATCH /:id` body:`{role:N}` | — | 始终可用 |

**批量操作**（BatchBar）：

| 操作 | API 调用 | 说明 |
|------|---------|------|
| Set Status | `POST /batch-status` body:`{ids,status}` | 下拉选择目标状态 |
| Set Role | `POST /batch-role` body:`{ids,role}` | 下拉选择目标角色 |

**编辑弹窗字段**：

| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| username | text | 非空，≤50 字符 | Worker 检查唯一性 |
| email | text | 含 `@`，≤255 字符 | — |
| avatar | text | — | 头像 URL |
| status | select | 0 / -1 / -2 | Active / Banned / Archived |
| role | select | 0–3 | User / Admin / SuperMod / Mod |
| credits | number | 整数 | 积分 |

> Worker 自我保护：不能修改自己的 status 和 role（返回 `SELF_BAN` / `SELF_ROLE_CHANGE`）。

**ViewModel**：

```typescript
// viewmodels/admin/users.ts
export interface UserFilters {
  username?: string;
  email?: string;
  status?: number | null;
  role?: number | null;
  page?: number;
  limit?: number;
}

export async function fetchUsers(filters: UserFilters): Promise<PaginatedResult<User>> {
  // adminApiClient.get("/api/admin/users", filters)
}

export async function fetchUser(id: number): Promise<User> {
  // adminApiClient.get(`/api/admin/users/${id}`)
}

export async function updateUser(id: number, data: Partial<UserUpdate>): Promise<User> {
  // adminApiClient.patch(`/api/admin/users/${id}`, data)
}

export async function banUser(id: number, deleteContent?: boolean): Promise<BanResult> {
  // adminApiClient.post(`/api/admin/users/${id}/ban`, { deleteContent })
}

export async function nukeUser(id: number): Promise<NukeResult> {
  // adminApiClient.post(`/api/admin/users/${id}/nuke`)
}

export async function batchSetStatus(ids: number[], status: number): Promise<BatchResult> {
  // adminApiClient.post("/api/admin/users/batch-status", { ids, status })
}

export async function batchSetRole(ids: number[], role: number): Promise<BatchResult> {
  // adminApiClient.post("/api/admin/users/batch-role", { ids, role })
}
```

---

### 3.3 Threads（/admin/threads）

**Worker 端点**：6 个（Admin 权限，Key B）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/threads` | 列表（分页 + 筛选） |
| GET | `/api/admin/threads/:id` | 详情 |
| PATCH | `/api/admin/threads/:id` | 编辑（含移动版块） |
| DELETE | `/api/admin/threads/:id` | 删除（级联删帖 + 更新计数器） |
| POST | `/api/admin/threads/batch-delete` | 批量删除（≤100） |
| POST | `/api/admin/threads/batch-move` | 批量移动到目标版块（≤100） |

**列表筛选**：

| 参数 | 列 | 类型 | 说明 |
|------|-----|------|------|
| `forumId` | `forum_id` | exact (int) | 版块筛选 |
| `authorId` | `author_id` | exact (int) | 作者 ID |
| `authorName` | `author_name` | like | 作者名模糊 |
| `subject` | `subject` | like | 标题模糊搜索 |
| `sticky` | `sticky` | exact (int) | 0=普通, 1–3=置顶级别 |
| `closed` | `closed` | exact (int) | 0=开放, 1=关闭 |
| `digest` | `digest` | exact (int) | 0=普通, 1–3=精华级别 |
| `highlight` | `highlight` | exact (int) | 0=无, >0=高亮色值 |

**列表列定义**：

| 列 | 字段 | 说明 |
|-----|------|------|
| ☐ | — | 复选框 |
| Subject | subject | 标题（可点击查看详情） |
| Author | authorName | — |
| Forum | forumId | Badge 显示版块名称 |
| Replies | replies | 数字 |
| Views | views | 数字 |
| Status | sticky/closed/digest | 多 Badge 组合 |
| Last Post | lastPostAt | 相对时间 |
| Actions | — | 操作下拉菜单 |

**单行操作**：

| 操作 | API 调用 | 确认 | 说明 |
|------|---------|------|------|
| Edit | → 弹窗编辑表单 | — | 编辑标题、属性 |
| Move | `PATCH /:id` body:`{forumId:N}` | — | 版块选择器 |
| Toggle Close | `PATCH /:id` body:`{closed:0或1}` | — | 开启/关闭回复 |
| Set Sticky | `PATCH /:id` body:`{sticky:N}` | — | 置顶级别 0–3 |
| Set Digest | `PATCH /:id` body:`{digest:N}` | — | 精华级别 0–3 |
| Delete | `DELETE /:id` | ⚠️ 确认 | 级联删除所有回帖 |

**批量操作**：

| 操作 | API 调用 | 说明 |
|------|---------|------|
| Batch Delete | `POST /batch-delete` body:`{ids}` | ≤100，级联删帖+更新计数器 |
| Batch Move | `POST /batch-move` body:`{ids,forumId}` | ≤100，版块选择器 |

**编辑弹窗字段**：

| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| subject | text | 非空，≤200 字符 | 帖子标题 |
| sticky | select | 0–3 | 0=普通, 1=版块置顶, 2=全局置顶, 3=超级置顶 |
| digest | select | 0–3 | 0=普通, 1–3=精华级别 |
| closed | toggle | 0 或 1 | 是否关闭回复 |
| highlight | number | ≥0 | 高亮色值 |
| forumId | select | 正整数 | 移动到目标版块 |

**ViewModel**：

```typescript
// viewmodels/admin/threads.ts
export interface ThreadFilters {
  forumId?: number;
  authorId?: number;
  authorName?: string;
  subject?: string;
  sticky?: number;
  closed?: number;
  digest?: number;
  highlight?: number;
  page?: number;
  limit?: number;
}

export async function fetchThreads(filters: ThreadFilters): Promise<PaginatedResult<Thread>> {}
export async function fetchThread(id: number): Promise<Thread> {}
export async function updateThread(id: number, data: Partial<ThreadUpdate>): Promise<Thread> {}
export async function deleteThread(id: number): Promise<DeleteResult> {}
export async function batchDeleteThreads(ids: number[]): Promise<BatchResult> {}
export async function batchMoveThreads(ids: number[], forumId: number): Promise<MoveResult> {}
```

---

### 3.4 Posts（/admin/posts）

**Worker 端点**：5 个（Admin 权限，Key B）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/posts` | 列表（分页 + 筛选） |
| GET | `/api/admin/posts/:id` | 详情 |
| PATCH | `/api/admin/posts/:id` | 编辑内容 |
| DELETE | `/api/admin/posts/:id` | 删除（不允许删主帖） |
| POST | `/api/admin/posts/batch-delete` | 批量删除（≤100，跳过主帖） |

**列表筛选**：

| 参数 | 列 | 类型 | 说明 |
|------|-----|------|------|
| `threadId` | `thread_id` | exact (int) | 按帖子筛选 |
| `authorId` | `author_id` | exact (int) | 作者 ID |
| `authorName` | `author_name` | like | 作者名模糊 |
| `content` | `content` | like | 内容模糊搜索 |

**列表列定义**：

| 列 | 字段 | 说明 |
|-----|------|------|
| ☐ | — | 复选框 |
| Content | content | 截断 100 字符，标记 isFirst |
| Author | authorName | — |
| Thread | threadId | 链接到帖子标题 |
| Forum | forumId | Badge |
| Position | position | 楼层号 |
| Date | createdAt | 相对时间 |
| Actions | — | 操作 |

**单行操作**：

| 操作 | API 调用 | 确认 | 条件 |
|------|---------|------|------|
| Edit Content | `PATCH /:id` body:`{content}` | — | 始终可用 |
| Delete | `DELETE /:id` | ⚠️ 确认 | isFirst=false（主帖不可删） |

> 主帖（`isFirst=true`）的 Delete 按钮禁用，tooltip 提示"请删除整个帖子"。

**批量操作**：

| 操作 | API 调用 | 说明 |
|------|---------|------|
| Batch Delete | `POST /batch-delete` body:`{ids}` | ≤100，自动跳过主帖，返回 `skipped` ID 列表 |

> 批量删除后显示 toast：`"Deleted N posts, M first-posts skipped"`。

**ViewModel**：

```typescript
// viewmodels/admin/posts.ts
export interface PostFilters {
  threadId?: number;
  authorId?: number;
  authorName?: string;
  content?: string;
  page?: number;
  limit?: number;
}

export async function fetchPosts(filters: PostFilters): Promise<PaginatedResult<Post>> {}
export async function fetchPost(id: number): Promise<Post> {}
export async function updatePost(id: number, content: string): Promise<Post> {}
export async function deletePost(id: number): Promise<DeleteResult> {}
export async function batchDeletePosts(ids: number[]): Promise<BatchDeleteResult> {}
// BatchDeleteResult: { deleted: true, count: number, skipped: number[] }
```

---

### 3.5 Forums（/admin/forums）

**Worker 端点**：7 个（Admin 权限，Key B）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/forums` | 列表（非分页，按 parent_id + display_order 排序） |
| GET | `/api/admin/forums/:id` | 详情 |
| POST | `/api/admin/forums` | 创建 |
| PATCH | `/api/admin/forums/:id` | 编辑 |
| DELETE | `/api/admin/forums/:id` | 删除（有帖子时拒绝） |
| POST | `/api/admin/forums/:id/merge` | 合并到目标版块 |
| POST | `/api/admin/forums/reorder` | 批量调整排序（≤200） |

**展示方式**：树形视图（非表格），因为版块有 parent-child 层级。

```
┌─ Category: 综合讨论 ─────────────────────────────┐
│  status: Active  threads: 456  display_order: 1   │
│  [Edit] [Hide] [Delete] [Create Sub-forum]        │
│                                                    │
│  ├─ 灌水区     Active  threads: 234  order: 1     │
│  │  [Edit] [Hide] [Delete] [Merge] [Create Sub]   │
│  │                                                 │
│  ├─ 求助问答   Active  threads: 122  order: 2     │
│  │  [Edit] [Hide] [Delete] [Merge]                 │
│  │                                                 │
│  └─ 新手报到   Hidden  threads: 100  order: 3     │
│     [Edit] [Show] [Delete] [Merge]                 │
└────────────────────────────────────────────────────┘
```

**操作**：

| 操作 | API 调用 | 确认 | 条件 |
|------|---------|------|------|
| Create | `POST /forums` | — | 始终可用（页面顶部按钮） |
| Edit | `PATCH /:id` | — | 内联编辑或弹窗 |
| Hide / Show | `PATCH /:id` body:`{status:0或1}` | — | 切换 |
| Delete | `DELETE /:id` | ⚠️ 确认 | threads=0 时可用；否则 Worker 返回 `FORUM_HAS_THREADS` |
| Merge | `POST /:id/merge` body:`{targetForumId}` | ⚠️ 确认 | 选择目标版块 |
| Reorder | `POST /reorder` body:`{orders}` | — | 修改 displayOrder 后统一提交 |
| Create Sub-forum | `POST /forums` body:`{parentId:N,...}` | — | 在父版块下创建 |

**创建弹窗字段**：

| 字段 | 类型 | 必填 | 默认值 | 校验 |
|------|------|------|--------|------|
| name | text | ✅ | — | 非空，≤100 字符 |
| type | select | — | `"forum"` | ForumType 枚举 |
| parentId | select | — | `0`（顶级） | 父版块选择器 |
| description | textarea | — | `""` | — |
| icon | text | — | `""` | — |
| displayOrder | number | — | `0` | — |
| status | toggle | — | `1` | 0=隐藏, 1=可见 |

**编辑弹窗字段**：同创建，但所有字段可选，至少修改一项。

**合并对话框**：
- 显示源版块信息（名称、帖子数）
- 版块选择器选择目标（排除自身）
- 确认后显示结果：`"Merged: 234 threads, 1,567 posts moved"`

**ViewModel**：

```typescript
// viewmodels/admin/forums.ts
export async function fetchForums(): Promise<Forum[]> {
  // 返回扁平数组，前端构建树（buildForumTree from @ellie/types）
}

export async function fetchForum(id: number): Promise<Forum> {}
export async function createForum(data: CreateForumInput): Promise<Forum> {}
export async function updateForum(id: number, data: Partial<ForumUpdate>): Promise<Forum> {}
export async function deleteForum(id: number): Promise<DeleteResult> {}
export async function mergeForums(sourceId: number, targetId: number): Promise<MergeResult> {}
export async function reorderForums(orders: Array<{id: number; displayOrder: number}>): Promise<void> {}
// MergeResult: { merged: true, sourceForumId, targetForumId, threadsMoved, postsMoved }
```

---

### 3.6 Attachments（/admin/attachments）

**Worker 端点**：4 个（Admin 权限，Key B）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/attachments` | 列表（分页 + 筛选） |
| GET | `/api/admin/attachments/:id` | 详情 |
| DELETE | `/api/admin/attachments/:id` | 删除（仅元数据） |
| POST | `/api/admin/attachments/batch-delete` | 批量删除（≤100） |

> **注意**：附件删除仅清除 D1 元数据记录，不删除实际存储文件。Worker 当前无文件存储集成。

**列表筛选**：

| 参数 | 列 | 类型 | 说明 |
|------|-----|------|------|
| `postId` | `post_id` | exact (int) | 按回帖筛选 |
| `threadId` | `thread_id` | exact (int) | 按帖子筛选 |
| `authorId` | `author_id` | exact (int) | 上传者 |
| `isImage` | `is_image` | exact (bool) | 仅图片 / 仅文件 |

**列表列定义**：

| 列 | 字段 | 说明 |
|-----|------|------|
| ☐ | — | 复选框 |
| Filename | filename | 文件名（图片时显示缩略图 icon） |
| Type | isImage | Badge: Image / File |
| Size | fileSize | 格式化（KB/MB） |
| Dimensions | width | 图片宽度（非图片显示 `—`） |
| Thread | threadId | 链接 |
| Post | postId | 链接 |
| Author | authorId | — |
| Downloads | downloads | 数字 |
| Date | createdAt | 相对时间 |
| Actions | — | Delete 按钮 |

**批量操作**：

| 操作 | API 调用 | 说明 |
|------|---------|------|
| Batch Delete | `POST /batch-delete` body:`{ids}` | ≤100 |

**ViewModel**：

```typescript
// viewmodels/admin/attachments.ts
export interface AttachmentFilters {
  postId?: number;
  threadId?: number;
  authorId?: number;
  isImage?: boolean;
  page?: number;
  limit?: number;
}

export async function fetchAttachments(filters: AttachmentFilters): Promise<PaginatedResult<Attachment>> {}
export async function fetchAttachment(id: number): Promise<Attachment> {}
export async function deleteAttachment(id: number): Promise<DeleteResult> {}
export async function batchDeleteAttachments(ids: number[]): Promise<BatchResult> {}
```

---

### 3.7 IP Bans（/admin/ip-bans）

**Worker 端点**：7 个（Admin 权限，Key B）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/ip-bans` | 列表（分页，默认排除过期） |
| GET | `/api/admin/ip-bans/:id` | 详情 |
| POST | `/api/admin/ip-bans` | 创建（自我封禁保护） |
| PATCH | `/api/admin/ip-bans/:id` | 编辑 |
| DELETE | `/api/admin/ip-bans/:id` | 删除 |
| POST | `/api/admin/ip-bans/batch-delete` | 批量删除（≤100） |
| GET | `/api/admin/ip-bans/check-ip` | IP 检测（exact/CIDR/wildcard） |

**列表特殊行为**：默认排除已过期的封禁（`expires_at IS NULL OR expires_at > now`），通过 `?expired=true` 参数可包含过期项。

**列表筛选**：

| 参数 | 列 | 类型 | 说明 |
|------|-----|------|------|
| `ip` | `ip` | like | IP 模糊搜索 |
| `expired` | — | 特殊 | `true` 包含过期项 |

**列表列定义**：

| 列 | 字段 | 说明 |
|-----|------|------|
| ☐ | — | 复选框 |
| IP | ip | 支持格式：精确 IP / CIDR / 通配符 |
| Reason | reason | 截断显示 |
| Admin | adminName | 操作人 |
| Expires | expiresAt | `null`=永久，否则显示日期 + 是否过期 |
| Created | createdAt | 相对时间 |
| Actions | — | Edit / Delete |

**创建弹窗字段**：

| 字段 | 类型 | 必填 | 校验 | 说明 |
|------|------|------|------|------|
| ip | text | ✅ | 非空，≤45 字符 | 支持 `192.168.1.1`、`10.0.0.0/24`、`10.0.*.*` |
| reason | textarea | — | ≤500 字符 | 封禁原因 |
| expiresAt | datetime | — | number 或 null | null=永久，否则为 Unix 时间戳 |

> Worker 自动填充 `adminId`、`adminName`、`createdAt`。
> Worker 检查重复 IP（`IP_BAN_DUPLICATE`）和自我封禁（`IP_BAN_SELF`，比对 `CF-Connecting-IP`）。

**编辑弹窗字段**：仅 `reason` 和 `expiresAt`（IP 不可修改，需要删除重建）。

**IP 检测工具**：

页面顶部提供一个 "Check IP" 工具：
- 输入框：输入待检测 IP
- 调用 `GET /api/admin/ip-bans/check-ip?ip=xxx`
- 结果显示：
  - 未命中：`✅ Not banned`
  - 命中：`🚫 Banned — matched rule: {ip} (reason: ...)`（显示最高优先级匹配规则）
- 匹配优先级：精确匹配(1000) > CIDR(前缀长度) > 通配符(非通配八位组数)

**ViewModel**：

```typescript
// viewmodels/admin/ip-bans.ts
export interface IpBanFilters {
  ip?: string;
  expired?: boolean;
  page?: number;
  limit?: number;
}

export async function fetchIpBans(filters: IpBanFilters): Promise<PaginatedResult<IpBan>> {}
export async function fetchIpBan(id: number): Promise<IpBan> {}
export async function createIpBan(data: CreateIpBanInput): Promise<IpBan> {}
export async function updateIpBan(id: number, data: UpdateIpBanInput): Promise<IpBan> {}
export async function deleteIpBan(id: number): Promise<DeleteResult> {}
export async function batchDeleteIpBans(ids: number[]): Promise<BatchResult> {}
export async function checkIp(ip: string): Promise<CheckIpResult> {}
// CheckIpResult: { banned: boolean, matchedRule?: IpBan }
```

---

### 3.8 Censor Words（/admin/censor-words）

**Worker 端点**：7 个（Admin 权限，Key B）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/censor-words` | 列表（分页 + 筛选） |
| GET | `/api/admin/censor-words/:id` | 详情 |
| POST | `/api/admin/censor-words` | 创建 |
| PATCH | `/api/admin/censor-words/:id` | 编辑 |
| DELETE | `/api/admin/censor-words/:id` | 删除 |
| POST | `/api/admin/censor-words/batch-delete` | 批量删除（≤100） |
| POST | `/api/admin/censor-words/test` | 测试内容过滤 |

**列表筛选**：

| 参数 | 列 | 类型 | 说明 |
|------|-----|------|------|
| `find` | `find` | like | 关键词模糊搜索 |
| `action` | `action` | exact | `"ban"` 或 `"replace"` |

**列表列定义**：

| 列 | 字段 | 说明 |
|-----|------|------|
| ☐ | — | 复选框 |
| Pattern | find | 关键词/正则（正则以 `/` 包裹高亮） |
| Action | action | Badge: Ban（红）/ Replace（黄） |
| Replacement | replacement | action=ban 时显示 `—` |
| Admin | adminName | 创建人 |
| Created | createdAt | 相对时间 |
| Actions | — | Edit / Delete |

**创建弹窗字段**：

| 字段 | 类型 | 必填 | 校验 | 说明 |
|------|------|------|------|------|
| find | text | ✅ | ≥2 字符 | 纯文本或 `/regex/` 格式 |
| action | select | — | `"ban"` 或 `"replace"` | 默认 `"replace"` |
| replacement | text | — | — | 默认 `"**"`；action=ban 时 Worker 强制清空 |

> Worker 校验：正则语法无效返回 `CENSOR_WORD_INVALID`；重复 find 返回 `CENSOR_WORD_DUPLICATE`。
> Worker 自动填充 `adminId`、`adminName`。

**编辑弹窗字段**：同创建，所有可选。

**内容测试工具**：

页面顶部提供 "Test Content" 工具：
- 文本框：输入待测内容
- 调用 `POST /api/admin/censor-words/test` body:`{content}`
- 结果显示：
  - 无匹配：`✅ Content is clean`
  - 命中 replace：`⚠️ Filtered: "xxx" → 显示替换后文本`
  - 命中 ban：`🚫 Banned: matched rule "xxx"`
- 显示所有命中规则列表

**ViewModel**：

```typescript
// viewmodels/admin/censor-words.ts
export interface CensorWordFilters {
  find?: string;
  action?: "ban" | "replace";
  page?: number;
  limit?: number;
}

export async function fetchCensorWords(filters: CensorWordFilters): Promise<PaginatedResult<CensorWord>> {}
export async function fetchCensorWord(id: number): Promise<CensorWord> {}
export async function createCensorWord(data: CreateCensorWordInput): Promise<CensorWord> {}
export async function updateCensorWord(id: number, data: UpdateCensorWordInput): Promise<CensorWord> {}
export async function deleteCensorWord(id: number): Promise<DeleteResult> {}
export async function batchDeleteCensorWords(ids: number[]): Promise<BatchResult> {}
export async function testContent(content: string): Promise<TestResult> {}
```

---

## 4. 权限守卫

三层守卫，层层递进：

> **当前状态**：骨架阶段仅实现了 `isAdmin(email)` + `resolveAdmin(session)` 函数和基本的 `proxy.ts` 登录检查。但 `proxy.ts` 仅检查 `isLoggedIn`（未验证 email 白名单），`layout.tsx` 也没有 auth guard。proxy + layout 守卫需在 6.1.1 中补齐，API 路由守卫由 6.1.3 的 `createProxyHandler()` 统一处理。

### 4.1 路由层（proxy.ts）— 仅页面路由

```typescript
// proxy.ts 仅保护页面路由（/admin/*），不保护 API 路由
// matcher 排除了 /api/* （除 /api/auth/*），所以 /api/admin/* 不经过 proxy
// /admin/* → 要求 NextAuth Google OAuth session 有效 + email ∈ ADMIN_EMAILS
// 不满足 → 重定向到 /login
```

> **设计决策**：`proxy.ts` matcher 已排除 `/api/*`（`api/(?!auth)`），`/api/admin/*` 路由不经过 proxy。API 路由的 auth guard 完全由 `lib/admin-proxy.ts` 的 `createProxyHandler()` 负责（§4.3）。这是正确的职责分离——proxy 对 API 路由做 redirect 语义不当（应返回 401/403 JSON），且 `createProxyHandler()` 已内置完整的 session + email 白名单验证。

### 4.2 页面层（layout.tsx）

```typescript
// (admin)/layout.tsx — Google OAuth 守卫
export default async function AdminGroupLayout({ children }) {
  const session = await auth();
  const admin = resolveAdmin(session);
  if (!admin) {
    redirect("/login");
  }
  // 将 admin 信息传递给 AppShell（Google email + 头像）
  return <AppShell>{children}</AppShell>;
}
```

> `resolveAdmin(session)` 验证 session 有效且 email 在白名单中。所有 Admin 全权相等，不再区分 role。

### 4.3 API 层（Next.js API Route）

每个 API Route 代理函数：

```typescript
// 读取 session → resolveAdmin(session) 验证 email ∈ ADMIN_EMAILS
// 如果 session 无效或 email 不在白名单 → 返回 401/403
// 否则通过 adminApiClient 转发到 Worker（仅 X-API-Key: ADMIN_API_KEY）
```

### 4.4 侧边栏渲染

所有通过 Google OAuth 白名单的 Admin 可见全部 8 个导航项，不分级。

| 角色 | 可见导航项 |
|------|-----------|
| Admin（白名单 email） | 全部 8 项 |

> 版主（Mod）和超级版主（SuperMod）不进入 Admin Console。内容审核操作通过论坛前端 `/api/v1/moderation/*` 完成（走 Key A + 论坛用户 JWT）。

---

## 5. 共享组件规格

本节定义各模块复用的 Admin 通用组件。

### 5.1 AdminDataTable

基于 shadcn/ui `<Table>` 的通用数据表格，支持列定义、行选择、排序指示。

```typescript
interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
}

interface AdminDataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  selectable?: boolean;           // 显示复选框列
  selectedIds?: Set<number>;
  onSelectChange?: (ids: Set<number>) => void;
  rowKey: (row: T) => number;     // 提取行 ID
  emptyMessage?: string;
}
```

### 5.2 AdminPagination

Offset 分页控件，对齐 Worker 的 `page/limit/total` 分页模式。

```typescript
interface AdminPaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}
// 显示：「Showing 1-20 of 1,234」 + Prev/Next 按钮 + 页码跳转
// limit 固定 20（可从 URL 读取覆盖）
```

### 5.3 AdminFilters

通用筛选栏，接受筛选项定义，输出 URL searchParams。

```typescript
interface FilterDef {
  key: string;
  label: string;
  type: "search" | "select" | "toggle";
  options?: Array<{ value: string; label: string }>;  // for select
}

interface AdminFiltersProps {
  filters: FilterDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onReset: () => void;
}
```

### 5.4 AdminBatchBar

批量操作浮动栏，选中行时从底部滑入。

```typescript
interface BatchAction {
  label: string;
  variant: "default" | "destructive";
  onClick: (ids: number[]) => Promise<void>;
  confirm?: string;  // 非空时弹确认对话框
}

interface AdminBatchBarProps {
  selectedCount: number;
  actions: BatchAction[];
  onClear: () => void;
}
// 显示：「3 items selected」 + 操作按钮 + Clear 按钮
```

### 5.5 AdminConfirmDialog

危险操作二次确认对话框，基于 shadcn/ui `<Dialog>`。

```typescript
interface AdminConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;          // 默认 "Confirm"
  variant?: "default" | "destructive";
  requireInput?: string;          // 非空时要求输入该文本才能确认（用于 Nuke 等）
  onConfirm: () => Promise<void>;
}
```

---

## 6. 原子化提交计划

> **状态标记**：✅ = 已完成并提交，🔲 = 待实现

### 前置：骨架搭建（已完成）

以下 9 个 commit 已在骨架搭建阶段完成并 push：

| # | Commit | 状态 |
|---|--------|------|
| 0.1 | `strip mock auth, forum pages, viewmodels, and @ellie workspace deps` | ✅ |
| 0.2 | `add Google OAuth auth, admin guard, and proxy for admin console` | ✅ |
| 0.3 | `add Google OAuth login page with card design` | ✅ |
| 0.4 | `add AppShell layout with collapsible sidebar and breadcrumbs` | ✅ |
| 0.5 | `add empty admin pages and update root layout title` | ✅ |
| 0.6 | `remove dead useDebounce test from use-responsive test file` | ✅ |
| 0.7 | `switch admin check from Google sub IDs to email-based (match pew)` | ✅ |
| 0.8 | `configure dev server for Caddy reverse proxy and fix route handler export` | ✅ |
| 0.9 | `replicate pew badge card decorations on login page` | ✅ |

**已建立的基础设施**：
- `src/auth.ts` — NextAuth v5 Google OAuth + JWT
- `src/proxy.ts` — 路由守卫（纯函数，可测试）— ⚠️ 仅检查 `isLoggedIn`，待 6.1.1 增加 email 白名单验证
- `src/lib/admin.ts` — `isAdmin(email)` + `resolveAdmin(session)`，基于 `ADMIN_EMAILS`
- `src/lib/navigation.ts` — 导航配置 + 面包屑
- `src/components/layout/` — AppShell + Sidebar + SidebarContext + Breadcrumbs
- `src/app/login/page.tsx` — 完整登录页（pew 风格 badge 卡片）
- `src/app/(admin)/layout.tsx` — 包裹 AppShell（⚠️ 无 auth guard，待 6.1.1 强化）
- 4 个空壳页面：Dashboard / Users / Content / Forums
- 15 个 shadcn/ui 组件 + 2 个 hooks（use-theme, use-is-mobile）
- `.env.local` — AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_URL, AUTH_SECRET, ADMIN_EMAILS

### 依赖关系

```
6.1 权限守卫 + API 代理基础 ──→ 6.2 共享组件 + 侧边栏 ──→ 6.3 Dashboard
                                                      ──→ 6.4 Users
                                                      ──→ 6.5 Threads
                                                      ──→ 6.6 Posts
                                                      ──→ 6.7 Forums
                                                      ──→ 6.8 Attachments
                                                      ──→ 6.9 IP Bans
                                                      ──→ 6.10 Censor Words
                                                      ──→ 6.11 收尾
```

> 6.4–6.10 各实体模块之间无依赖，理论上可并行。建议按此顺序执行，因为 Users 最复杂（可作为模式验证），后续模块复制结构即可加速。

---

### 6.1 权限守卫 + API 代理基础

建立权限守卫和 Next.js → Worker 的数据通路。需先在 `.env.local` 添加 `WORKER_API_URL` 和 `ADMIN_API_KEY`。

> **安全优先**：权限守卫是安全前提条件，必须在任何功能页面之前完成。当前 `proxy.ts` 仅检查 `isLoggedIn`（任何 Google 账号可通过），`layout.tsx` 没有 auth guard——这两个缺口必须首先封堵。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.1.1 | `refactor: strengthen proxy and layout guard with admin whitelist` | 1) `proxy.ts` — 对 `/admin/*` 页面路由增加 `resolveAdmin(session)` 验证 email ∈ ADMIN_EMAILS，不通过则重定向 `/login`（注意：`/api/admin/*` 不经过 proxy，其 auth guard 由 6.1.3 的 `createProxyHandler()` 负责）；2) `(admin)/layout.tsx` — 从 Server Component 调用 `auth()` + `resolveAdmin(session)` 验证 email 白名单，不通过则 `redirect("/login")` | ✅ L1: proxy 白名单拒绝 + layout 重定向 | ✅ |
| 6.1.2 | `feat: add admin api client (server-side)` | `lib/admin-api.ts` — 封装 `WORKER_API_URL` + `ADMIN_API_KEY`（Key B），自动注入 `X-API-Key` header，通用 GET/POST/PATCH/DELETE，统一错误处理 `AdminApiError`，解析 `{ data, meta }` 信封 | ✅ L1: 请求构造 + 错误解析 | ✅ |
| 6.1.3 | `feat: add admin api proxy helpers` | `lib/admin-proxy.ts` — `createProxyHandler()` 工厂函数：读 Google OAuth session → `resolveAdmin()` 验证 email ∈ ADMIN_EMAILS → 构造 headers → 转发 → 透传响应。含 CSRF Origin 校验 | ✅ L1: header 注入 + 错误透传 + CSRF 拒绝 | ✅ |
| 6.1.4 | `feat: add stats api route` | `app/api/admin/stats/route.ts` — 第一个代理端点，验证全链路通畅（auth → proxy → Worker → 响应） | ✅ L1: 代理转发 | ✅ |

---

### 6.2 共享组件 + 侧边栏

提取各模块复用的 Admin 通用组件，同时升级侧边栏导航。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.2.1 | `feat: add admin data table component` | `components/admin/admin-data-table.tsx` — 通用表格（列定义 + 行选择 + 空状态） | ✅ L1: 列渲染 + 选择状态 | ✅ |
| 6.2.2 | `feat: add admin pagination, filters, batch bar, and confirm dialog` | `admin-pagination.tsx`（offset 分页）+ `admin-filters.tsx`（search/select/toggle）+ `admin-batch-bar.tsx`（浮动栏）+ `admin-confirm-dialog.tsx`（危险操作确认，含 requireInput） | ✅ L1: 分页计算 + URL 驱动 | ✅ |
| 6.2.3 | `refactor: expand sidebar nav to 8 items with grouped sections` | 更新 `lib/navigation.ts`（Dashboard + 内容管理 5 项 + 安全管理 2 项）+ 更新 `sidebar.tsx` ICON_MAP（+MessageSquare, Paperclip, ShieldBan, Filter）+ 更新 `ROUTE_LABELS`（+threads, posts, attachments, ip-bans, censor-words） | ✅ L1: 导航项 + active 状态 + 面包屑 | ✅ |
| 6.2.4 | `feat: add stat-card component` | `components/admin/stat-card.tsx` — 独立统计卡片（label + value + 可选 sub-items 列表） | ✅ L1: 渲染 | ✅ |

---

### 6.3 Dashboard

接入 Stats 端点替换空壳。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.3.1 | `feat: rewrite dashboard with stats endpoint` | `viewmodels/admin/dashboard.ts`（`fetchDashboardStats()` 调用 adminApiClient）+ 重写 `admin/page.tsx`（4 StatCards + 2 Detail Cards + Quick Links） | ✅ L1: fetchDashboardStats 解析 | ✅ |

---

### 6.4 Users

完整的用户管理模块。Worker 端点 7 个。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.4.1 | `feat: add user admin api routes` | `app/api/admin/users/route.ts`（GET list）+ `[id]/route.ts`（GET/PATCH）+ `[id]/ban/route.ts`（POST）+ `[id]/nuke/route.ts`（POST）+ `batch-status/route.ts`（POST）+ `batch-role/route.ts`（POST） | ✅ L1: 代理转发 | ✅ |
| 6.4.2 | `feat: add user management viewmodel` | `viewmodels/admin/users.ts` — fetchUsers, fetchUser, updateUser, banUser, nukeUser, batchSetStatus, batchSetRole（共 7 函数） | ✅ L1: 全函数 | ✅ |
| 6.4.3 | `feat: add user management page and components` | 重写 `admin/users/page.tsx`（AdminDataTable + AdminPagination + AdminFilters + AdminBatchBar）+ `components/admin/user-edit-dialog.tsx`（编辑弹窗 6 字段） | ✅ L1: 组件渲染 | ✅ |

---

### 6.5 Threads

帖子管理模块。Worker 端点 6 个。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.5.1 | `feat: add thread admin api routes` | `app/api/admin/threads/route.ts`（GET list）+ `[id]/route.ts`（GET/PATCH/DELETE）+ `batch-delete/route.ts`（POST）+ `batch-move/route.ts`（POST） | ✅ L1: 代理转发 | ✅ |
| 6.5.2 | `feat: add thread management viewmodel and page` | `viewmodels/admin/threads.ts`（6 函数）+ `admin/threads/page.tsx`（8 筛选器、批量删除/移动）+ `components/admin/thread-edit-dialog.tsx` | ✅ L1: VM 函数 + 组件渲染 | ✅ |

---

### 6.6 Posts

回帖管理模块。Worker 端点 5 个。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.6.1 | `feat: add post admin api routes` | `app/api/admin/posts/route.ts`（GET list）+ `[id]/route.ts`（GET/PATCH/DELETE）+ `batch-delete/route.ts`（POST） | ✅ L1: 代理转发 | ✅ |
| 6.6.2 | `feat: add post management viewmodel and page` | `viewmodels/admin/posts.ts`（5 函数）+ `admin/posts/page.tsx`（4 筛选器、批量删除含 skipped 提示）+ `components/admin/post-edit-dialog.tsx` | ✅ L1: VM 函数 + 组件渲染 | ✅ |

> 删除旧 `admin/content/page.tsx`（拆分为 threads + posts）。

---

### 6.7 Forums

版块管理模块。Worker 端点 7 个。树形视图 + merge + reorder。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.7.1 | `feat: add forum admin api routes` | `app/api/admin/forums/route.ts`（GET list / POST create）+ `[id]/route.ts`（GET/PATCH/DELETE）+ `[id]/merge/route.ts`（POST）+ `reorder/route.ts`（POST） | ✅ L1: 代理转发 | ✅ |
| 6.7.2 | `feat: add forum management viewmodel` | `viewmodels/admin/forums.ts` — fetchForums, fetchForum, createForum, updateForum, deleteForum, mergeForums, reorderForums（共 7 函数） | ✅ L1: 全函数 | ✅ |
| 6.7.3 | `feat: add forum management page and components` | 重写 `admin/forums/page.tsx`（树形视图）+ `components/admin/forum-create-dialog.tsx` + `forum-merge-dialog.tsx`，支持 create / edit / delete / merge / reorder / hide / show | ✅ L1: 组件渲染 | ✅ |

---

### 6.8 Attachments

附件管理模块。Worker 端点 4 个（只读 + 删除）。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.8.1 | `feat: add attachment admin api routes` | `app/api/admin/attachments/route.ts`（GET list）+ `[id]/route.ts`（GET/DELETE）+ `batch-delete/route.ts`（POST） | ✅ L1: 代理转发 | ✅ |
| 6.8.2 | `feat: add attachment management viewmodel and page` | `viewmodels/admin/attachments.ts`（4 函数）+ `admin/attachments/page.tsx`（4 筛选器、批量删除） | ✅ L1: VM 函数 + 组件渲染 | ✅ |

---

### 6.9 IP Bans

IP 封禁管理模块。Worker 端点 7 个，含 IP 检测工具。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.9.1 | `feat: add ip-ban admin api routes` | `app/api/admin/ip-bans/route.ts`（GET list / POST create）+ `[id]/route.ts`（GET/PATCH/DELETE）+ `batch-delete/route.ts`（POST）+ `check-ip/route.ts`（GET） | ✅ L1: 代理转发 | ✅ |
| 6.9.2 | `feat: add ip-ban management viewmodel and page` | `viewmodels/admin/ip-bans.ts`（7 函数含 checkIp）+ `admin/ip-bans/page.tsx`（含 IP 检测工具 UI）+ `components/admin/ip-ban-create-dialog.tsx` | ✅ L1: VM 函数 + 组件渲染 | ✅ |

---

### 6.10 Censor Words

敏感词管理模块。Worker 端点 7 个，含内容测试工具。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.10.1 | `feat: add censor-word admin api routes` | `app/api/admin/censor-words/route.ts`（GET list / POST create）+ `[id]/route.ts`（GET/PATCH/DELETE）+ `batch-delete/route.ts`（POST）+ `test/route.ts`（POST） | ✅ L1: 代理转发 | ✅ |
| 6.10.2 | `feat: add censor-word management viewmodel and page` | `viewmodels/admin/censor-words.ts`（7 函数含 testContent）+ `admin/censor-words/page.tsx`（含内容测试工具 UI）+ `components/admin/censor-word-create-dialog.tsx` | ✅ L1: VM 函数 + 组件渲染 | ✅ |

---

### 6.11 收尾

清理废弃代码，最终验证。

| # | Commit | 内容 | 测试 | 状态 |
|---|--------|------|------|------|
| 6.11.1 | `chore: remove deprecated content page stub` | 删除 `admin/content/page.tsx`（已被 threads + posts 替代） | — | ✅ |
| 6.11.2 | `chore: final cleanup and verify all admin endpoints covered` | 验证 44/44 Worker admin 端点全覆盖，清理未使用的 import，更新文档 | — | ✅ |

---

## 7. 提交统计

| Step | 主题 | 提交数 | 累计 | 状态 |
|------|------|--------|------|------|
| 0.x | 骨架搭建（auth/layout/login） | 9 | 9 | ✅ 已完成 |
| 6.1 | 权限守卫 + API 代理基础 | 4 | 13 | ✅ 已完成 |
| 6.2 | 共享组件 + 侧边栏 | 4 | 17 | ✅ 已完成 |
| 6.3 | Dashboard | 1 | 18 | ✅ 已完成 |
| 6.4 | Users | 3 | 21 | ✅ 已完成 |
| 6.5 | Threads | 2 | 23 | ✅ 已完成 |
| 6.6 | Posts | 2 | 25 | ✅ 已完成 |
| 6.7 | Forums | 3 | 28 | ✅ 已完成 |
| 6.8 | Attachments | 2 | 30 | ✅ 已完成 |
| 6.9 | IP Bans | 2 | 32 | ✅ 已完成 |
| 6.10 | Censor Words | 2 | 34 | ✅ 已完成 |
| 6.11 | 收尾 | 2 | **36** | ✅ 已完成 |

> 骨架 9 commits（已完成）+ 功能 27 commits（待实现）= 总计 36 commits。

---

## 8. 复用与重建清单

### 沿用（无需修改）

| 文件 | 说明 |
|------|------|
| `src/auth.ts` | NextAuth v5 Google OAuth + JWT（已完成） |
| `src/proxy.ts` | 路由守卫 — `isPublicRoute()` + `resolveProxyAction()`（已完成） |
| `src/lib/admin.ts` | `isAdmin(email)` + `resolveAdmin(session)` — email 白名单（已完成） |
| `src/lib/utils.ts` | `cn()` — clsx + tailwind-merge |
| `src/components/ui/*` | 15 个 shadcn/ui 原子组件（avatar, badge, button, card, collapsible, dialog, dropdown-menu, input, label, separator, sheet, skeleton, table, tabs, tooltip） |
| `src/components/theme-toggle.tsx` | 主题切换（light/dark/system） |
| `src/components/layout/app-shell.tsx` | AppShell 布局 — 侧边栏 + 浮岛内容 + 面包屑 |
| `src/components/layout/sidebar-context.tsx` | 侧边栏状态 context |
| `src/components/layout/breadcrumbs.tsx` | 面包屑组件 |
| `src/hooks/use-theme.ts` | 三态主题 hook |
| `src/hooks/use-is-mobile.ts` | 移动端检测 hook |
| `src/app/login/page.tsx` | 登录页（pew 风格 badge 卡片，已完成） |

### 需修改

| 文件 | 变更 |
|------|------|
| `src/lib/navigation.ts` | 从 4 项扩展到 8 项（+Threads/Posts/Attachments/IP Bans/Censor Words），分组改为 Dashboard/内容管理/安全管理 |
| `src/components/layout/sidebar.tsx` | ICON_MAP 增加新图标（MessageSquare, Paperclip, ShieldBan, Filter） |
| `src/app/(admin)/layout.tsx` | 添加服务端 auth guard — `auth()` + `resolveAdmin()` + redirect（6.1.1） |

### 新建

| 文件 | 说明 |
|------|------|
| `lib/admin-api.ts` | 服务端 Worker API 客户端（WORKER_API_URL + Key B） |
| `lib/admin-proxy.ts` | API Route 代理工厂函数（含 CSRF 校验） |
| `app/api/admin/**/*.ts` | ~30 个 API Route 代理文件 |
| `viewmodels/admin/dashboard.ts` | Dashboard 数据层 |
| `viewmodels/admin/users.ts` | 用户管理数据层（7 函数） |
| `viewmodels/admin/threads.ts` | 帖子管理数据层（6 函数） |
| `viewmodels/admin/posts.ts` | 回帖管理数据层（5 函数） |
| `viewmodels/admin/forums.ts` | 版块管理数据层（7 函数） |
| `viewmodels/admin/attachments.ts` | 附件管理数据层（4 函数） |
| `viewmodels/admin/ip-bans.ts` | IP 封禁数据层（7 函数含 checkIp） |
| `viewmodels/admin/censor-words.ts` | 敏感词数据层（7 函数含 testContent） |
| `app/(admin)/admin/threads/page.tsx` | 帖子管理页 |
| `app/(admin)/admin/posts/page.tsx` | 回帖管理页 |
| `app/(admin)/admin/attachments/page.tsx` | 附件管理页 |
| `app/(admin)/admin/ip-bans/page.tsx` | IP 封禁管理页 |
| `app/(admin)/admin/censor-words/page.tsx` | 敏感词管理页 |
| `components/admin/admin-data-table.tsx` | 通用数据表格 |
| `components/admin/admin-pagination.tsx` | offset 分页控件 |
| `components/admin/admin-filters.tsx` | 通用筛选栏 |
| `components/admin/admin-batch-bar.tsx` | 批量操作浮动栏 |
| `components/admin/admin-confirm-dialog.tsx` | 危险操作确认 |
| `components/admin/stat-card.tsx` | 统计卡片 |
| `components/admin/user-edit-dialog.tsx` | 用户编辑弹窗 |
| `components/admin/thread-edit-dialog.tsx` | 帖子编辑弹窗 |
| `components/admin/post-edit-dialog.tsx` | 回帖编辑弹窗 |
| `components/admin/forum-create-dialog.tsx` | 版块创建弹窗 |
| `components/admin/forum-merge-dialog.tsx` | 版块合并弹窗 |
| `components/admin/ip-ban-create-dialog.tsx` | IP 封禁创建弹窗 |
| `components/admin/censor-word-create-dialog.tsx` | 敏感词创建弹窗 |

### 删除

| 文件 | 原因 |
|------|------|
| `app/(admin)/admin/content/page.tsx` | 拆分为 threads + posts |

---

## 9. Worker 端点覆盖验证

全部 44 个 Worker admin 端点与前端页面/操作的对应关系：

| # | Worker 端点 | 前端页面 | 前端操作 |
|---|------------|---------|---------|
| 18 | `GET /api/admin/forums` | Forums | 树形列表 |
| 19 | `GET /api/admin/forums/:id` | Forums | 编辑弹窗加载 |
| 20 | `POST /api/admin/forums` | Forums | 创建弹窗提交 |
| 21 | `PATCH /api/admin/forums/:id` | Forums | 编辑弹窗提交 / 显隐切换 |
| 22 | `DELETE /api/admin/forums/:id` | Forums | 删除按钮 |
| 23 | `POST /api/admin/forums/:id/merge` | Forums | 合并弹窗提交 |
| 24 | `POST /api/admin/forums/reorder` | Forums | 排序保存 |
| 25 | `GET /api/admin/threads` | Threads | 列表 |
| 26 | `GET /api/admin/threads/:id` | Threads | 编辑弹窗加载 |
| 27 | `PATCH /api/admin/threads/:id` | Threads | 编辑/移动/置顶/精华/关闭 |
| 28 | `DELETE /api/admin/threads/:id` | Threads | 删除按钮 |
| 29 | `POST /api/admin/threads/batch-delete` | Threads | 批量删除 |
| 30 | `POST /api/admin/threads/batch-move` | Threads | 批量移动 |
| 31 | `GET /api/admin/posts` | Posts | 列表 |
| 32 | `GET /api/admin/posts/:id` | Posts | 编辑弹窗加载 |
| 33 | `PATCH /api/admin/posts/:id` | Posts | 内容编辑 |
| 34 | `DELETE /api/admin/posts/:id` | Posts | 删除按钮 |
| 35 | `POST /api/admin/posts/batch-delete` | Posts | 批量删除 |
| 36 | `GET /api/admin/users` | Users | 列表 |
| 37 | `GET /api/admin/users/:id` | Users | 编辑弹窗加载 |
| 38 | `PATCH /api/admin/users/:id` | Users | 编辑弹窗提交 |
| 39 | `POST /api/admin/users/:id/ban` | Users | 封禁按钮 |
| 40 | `POST /api/admin/users/:id/nuke` | Users | 核销按钮 |
| 41 | `POST /api/admin/users/batch-status` | Users | 批量改状态 |
| 42 | `POST /api/admin/users/batch-role` | Users | 批量改角色 |
| 43 | `GET /api/admin/attachments` | Attachments | 列表 |
| 44 | `GET /api/admin/attachments/:id` | Attachments | 详情查看 |
| 45 | `DELETE /api/admin/attachments/:id` | Attachments | 删除按钮 |
| 46 | `POST /api/admin/attachments/batch-delete` | Attachments | 批量删除 |
| 47 | `GET /api/admin/ip-bans` | IP Bans | 列表 |
| 48 | `GET /api/admin/ip-bans/:id` | IP Bans | 编辑弹窗加载 |
| 49 | `POST /api/admin/ip-bans` | IP Bans | 创建弹窗提交 |
| 50 | `PATCH /api/admin/ip-bans/:id` | IP Bans | 编辑弹窗提交 |
| 51 | `DELETE /api/admin/ip-bans/:id` | IP Bans | 删除按钮 |
| 52 | `POST /api/admin/ip-bans/batch-delete` | IP Bans | 批量删除 |
| 53 | `GET /api/admin/ip-bans/check-ip` | IP Bans | IP 检测工具 |
| 54 | `GET /api/admin/censor-words` | Censor Words | 列表 |
| 55 | `GET /api/admin/censor-words/:id` | Censor Words | 编辑弹窗加载 |
| 56 | `POST /api/admin/censor-words` | Censor Words | 创建弹窗提交 |
| 57 | `PATCH /api/admin/censor-words/:id` | Censor Words | 编辑弹窗提交 |
| 58 | `DELETE /api/admin/censor-words/:id` | Censor Words | 删除按钮 |
| 59 | `POST /api/admin/censor-words/batch-delete` | Censor Words | 批量删除 |
| 60 | `POST /api/admin/censor-words/test` | Censor Words | 内容测试工具 |
| 61 | `GET /api/admin/stats` | Dashboard | 统计卡片 |

**覆盖率：44/44（100%）** — 全部 Worker admin 端点均有对应的前端操作。
