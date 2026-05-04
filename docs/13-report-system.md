# 13 — 举报功能

> 用户举报**主题 / 回帖 / 用户**的前端入口、用户端 API、管理后台列表与处理界面。
>
> **前置依赖**：02（数据库设计，reports 表已存在）、05（Worker API）、10（管理后台）

---

## 0. 设计决策

| # | 问题 | 决策 | 说明 |
|---|------|------|------|
| 1 | 范围 | **支持 thread / post / user** | E 批已扩展，post 为最初实现的类型 |
| 2 | 举报理由 | **只允许预设值** | 不支持自定义补充说明，避免结构化数据丢失 |
| 3 | 跳转元数据 | **联表查** | Admin API 用类型守卫的 LEFT JOIN 补齐 thread_id / target_title / target_name |
| 4 | 单条删除 | **用 batch-delete** | 前端传 `[id]` 单元素数组 |
| 5 | 处理人身份 | **handler_id + handler_name** | resolve/dismiss 时由 admin session 写入；revert to pending 时清空 |
| 6 | 人机验证 | **复用 Cap.js** | 使用现有 CapWidget 组件，前端校验通过后提交 |
| 7 | 自我举报 | **UI 隐藏 + Worker 兜底** | 前端按钮在 `currentUserId === authorId` 时不渲染；Worker 仍以 `CANNOT_REPORT_SELF` 守门 |

---

## 1. 现状分析

### 1.1 已有实现

| 组件 | 状态 | 说明 |
|------|------|------|
| `reports` 表 | ✅ 已存在 | schema.ts 已定义 |
| Admin API | ✅ 类型感知 | 类型守卫 LEFT JOIN 补齐 `thread_id` / `target_title` / `target_name` |
| 用户端举报 API | ✅ 三类型 | `POST /api/v1/reports` 支持 `type ∈ {thread, post, user}` |
| 前端举报入口 | ✅ 三入口 | 帖子操作栏 / 主题头部 / 个人页 |
| Admin 举报管理页 | ✅ 类型筛选 | `/admin/reports` 含 类型 / 状态 双 filter，detail 类型感知 |

### 1.2 当前能力边界

| 功能 | 说明 |
|------|------|
| 用户举报 API | `POST /api/v1/reports`，body `{ type: 'thread'\|'post'\|'user', targetId, reason }` |
| 发帖权限检查 API | `GET /api/v1/posting-permission`，前端用于弹窗 Step 1 |
| 主题 / 回帖 / 用户 举报入口 | `ThreadReportButton`（thread header）/ `ReportDialog`（post-card）/ `UserReportButton`（profile hero） |
| 举报弹窗 | 三步校验：权限检查 → Cap.js 验证 → 选择预设理由；类型感知文案（标题 / 错误提示） |
| Admin API JOIN | type-guarded LEFT JOIN：post→`posts.thread_id` + `threads.subject`，thread→`threads.subject`，user→`users.username` |
| Admin 举报列表 | 按 类型 / 状态 / 举报人 筛选 |
| Admin 举报处理 | 标记已处理 / 驳回 / 还原为待处理；跳转到对应 admin 实体页（thread 或 user） |

> Audit Logs（admin 操作日志）由 F 批负责，不在本批范围。

---

## 2. 数据库（复用现有）

`reports` 表已存在于 `packages/db/src/schema.ts`：

```sql
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('thread', 'post', 'user')),
    target_id INTEGER NOT NULL,
    reporter_id INTEGER NOT NULL,
    reporter_name TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending'
           CHECK(status IN ('pending', 'resolved', 'dismissed')),
    handler_id INTEGER,
    handler_name TEXT NOT NULL DEFAULT '',
    handled_at INTEGER,
    created_at INTEGER NOT NULL
);
```

**字段说明**：

| 字段 | 说明 |
|------|------|
| `type` | 举报类型：`thread` / `post` / `user` |
| `target_id` | 被举报对象 ID（threads.id / posts.id / users.id，按 type 解释） |
| `reporter_id` | 举报人 UID |
| `reason` | 举报理由（预设值，不支持自定义） |
| `status` | `pending`=待处理，`resolved`=已处理，`dismissed`=已驳回 |
| `handler_id` | 固定为 0（admin 无数值 ID） |
| `handler_name` | 处理人名称（从 admin session 取） |
| `handled_at` | 处理时间 |

---

## 3. 权限设计

### 3.1 举报权限（后端校验）

用户必须满足**所有**以下条件才能举报：

| # | 条件 | 检查方式 |
|---|------|---------|
| 1 | 已登录 | JWT 鉴权 |
| 2 | 账号状态正常 | `users.status >= 0` |
| 3 | 能够发帖 | 复用 `checkPostingPermission()` |
| 4 | 不能举报自己的内容 | `resolved.authorId != reporter_id`（thread.author_id / post.author_id / user.id 三者由 Worker 解析） |
| 5 | 目标存在 | 类型对应的实体存在（user 还需 `status != -99`） |

**注意**：Cap.js 验证仅在前端进行（与登录/注册一致），后端不校验 capToken。

### 3.2 举报流程（前端门槛）

点击"举报"按钮后，弹窗内按顺序校验：

```
┌─────────────────────────────────────────────────┐
│  举报内容                                   [×] │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │  ✓ 检查发帖权限...                      │   │
│  │  ○ 人机验证                             │   │
│  │  ○ 选择举报理由                         │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```

| Step | 校验项 | 失败处理 |
|------|--------|----------|
| 1 | 发帖权限检查 | 显示具体限制原因（新用户/禁言等），禁用后续步骤 |
| 2 | Cap.js 人机验证 | 显示 CapWidget，通过后继续；未配置则跳过 |
| 3 | 选择举报理由 | 必须选择一个预设理由才能提交 |

**弹窗 UI**：

```
┌─────────────────────────────────────────────────┐
│  举报内容                                   [×] │
├─────────────────────────────────────────────────┤
│                                                 │
│  Step 1: 检查权限                               │
│  ┌─────────────────────────────────────────┐   │
│  │ ✓ 您有权限举报此对象                    │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Step 2: 人机验证                               │
│  ┌─────────────────────────────────────────┐   │
│  │ [      CapWidget 验证组件      ]        │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│  Step 3: 选择举报理由                           │
│  ┌─────────────────────────────────────────┐   │
│  │ ○ 垃圾广告                              │   │
│  │ ○ 违规内容                              │   │
│  │ ○ 人身攻击                              │   │
│  │ ○ 虚假信息                              │   │
│  │ ○ 侵权内容                              │   │
│  │ ○ 其他                                  │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│                        [取消]  [提交举报]       │
└─────────────────────────────────────────────────┘
```

**提交按钮状态**：
- 权限检查失败 → 禁用，显示原因
- Cap.js 未通过 → 禁用（未配置时跳过此检查）
- 未选择理由 → 禁用
- 全部通过 → 可点击

### 3.3 重复举报限制

- 同一用户对同一对象（按 `type + target_id` 区分），24 小时内只能举报一次
- 检查：`SELECT 1 FROM reports WHERE reporter_id=? AND type=? AND target_id=? AND created_at > ?`

---

## 4. Worker API

### 4.1 用户端端点

| # | Method | Path | Handler | 说明 |
|---|--------|------|---------|------|
| #75 | `POST` | `/api/v1/reports` | `create` | 提交举报（thread / post / user） |
| #76 | `GET` | `/api/v1/posting-permission` | `checkPermission` | 检查发帖权限（举报弹窗 Step 1） |

### 4.2 #75 POST /api/v1/reports

**鉴权**：JWT（Key A）

**请求体**：

```json
{
  "type": "post",
  "targetId": 12345,
  "reason": "垃圾广告"
}
```

**字段验证**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | `thread` / `post` / `user` 三选一 |
| `targetId` | number | ✅ | 被举报对象 ID（按 `type` 解释：thread→主题 ID；post→帖子 ID；user→用户 ID） |
| `reason` | string | ✅ | 必须是预设值之一 |

**注意**：Cap.js 验证在前端完成，后端不校验（与登录/注册行为一致）。

**预设举报理由**：

```ts
const REPORT_REASONS = [
  "垃圾广告",
  "违规内容",
  "人身攻击",
  "虚假信息",
  "侵权内容",
  "其他"
] as const;
```

**响应**：201 Created

```json
{
  "data": {
    "id": 1,
    "type": "post",
    "targetId": 12345,
    "reason": "垃圾广告",
    "createdAt": 1712345678
  }
}
```

**错误码**：

| 错误 | HTTP | 说明 |
|------|------|------|
| `UNAUTHORIZED` | 401 | 未登录 |
| `FORBIDDEN` | 403 | 无权限（无法发帖） |
| `INVALID_REQUEST` | 400 | 参数错误、type 不在 `thread/post/user`、reason 不在预设列表 |
| `TARGET_NOT_FOUND` | 404 | 举报对象不存在或不可见 |
| `CANNOT_REPORT_SELF` | 400 | 不能举报自己（自己的主题/帖子/账号） |
| `DUPLICATE_REPORT` | 400 | 24 小时内重复举报 |

### 4.3 #76 GET /api/v1/posting-permission

**鉴权**：JWT（Key A）

**用途**：前端举报弹窗 Step 1 调用，检查当前用户是否有发帖权限。

**响应**：200 OK

```json
{
  "data": {
    "allowed": true
  }
}
```

或（无权限时）：

```json
{
  "data": {
    "allowed": false,
    "reason": "您的账号注册未满 24 小时，暂时无法操作"
  }
}
```

**错误码**：

| 错误 | HTTP | 说明 |
|------|------|------|
| `UNAUTHORIZED` | 401 | 未登录 |

### 4.4 Admin 端点

| # | Method | Path | Handler | 状态 |
|---|--------|------|---------|------|
| #35 | `GET` | `/api/admin/reports` | `list` | ✅ 已联表 |
| #36 | `GET` | `/api/admin/reports/:id` | `getById` | ✅ 已联表 |
| #37 | `PATCH` | `/api/admin/reports/:id` | `update` | ✅ 已有 |
| #38 | `POST` | `/api/admin/reports/batch-delete` | `batchDelete` | ✅ 已有 |

**联表内容**：list 和 getById 按 `type` 联表查询，返回每种类型对应的元数据：

```sql
-- post   → 取 posts.thread_id 作为 threadId、对应 thread.subject 作为 target_title
-- thread → 直接取 threads.id 作为 threadId、threads.subject 作为 target_title
-- user   → 取 users.username 作为 target_name
SELECT r.*,
       CASE WHEN r.type='post'   THEN p.thread_id
            WHEN r.type='thread' THEN t.id END                        AS thread_id,
       CASE WHEN r.type='thread' THEN t.subject
            WHEN r.type='post'   THEN tp.subject END                  AS target_title,
       CASE WHEN r.type='user'   THEN u.username END                  AS target_name
FROM reports r
LEFT JOIN posts   p  ON r.type='post'   AND r.target_id = p.id
LEFT JOIN threads tp ON r.type='post'   AND p.thread_id = tp.id
LEFT JOIN threads t  ON r.type='thread' AND r.target_id = t.id
LEFT JOIN users   u  ON r.type='user'   AND r.target_id = u.id
```

**返回字段新增**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `threadId` | number \| null | `post`→所属 parent thread id；`thread`→target thread id；`user`→null |
| `targetTitle` | string \| null | thread / post 的主题标题 |
| `targetName` | string \| null | user 的 username |

### 4.5 文件位置

| 文件 | 说明 |
|------|------|
| `apps/worker/src/handlers/report.ts` | 新建，用户端 create + checkPermission handler |
| `apps/worker/src/handlers/admin/report.ts` | 改造 list/getById 联表查询 |

### 4.6 路由注册

在 `apps/worker/src/index.ts` 中：

```
Auth routes (#12-#15)
  ↓
#75  POST   /api/v1/reports              ← 新增
#76  GET    /api/v1/posting-permission   ← 新增
  ↓
Messages routes (#70-#74)
  ...
```

---

## 5. Next.js 数据链路

### 5.1 Proxy Routes

| Next.js Route | 方法 | 代理到 |
|---------------|------|--------|
| `/api/v1/reports` | POST | Worker `/api/v1/reports` |
| `/api/v1/posting-permission` | GET | Worker `/api/v1/posting-permission` |
| `/api/admin/reports` | GET | Worker `/api/admin/reports` |
| `/api/admin/reports/[id]` | GET, PATCH | Worker `/api/admin/reports/:id` |
| `/api/admin/reports/batch-delete` | POST | Worker `/api/admin/reports/batch-delete` |

**PATCH 处理人信息**：Next.js proxy 从 session 获取当前 admin 名称，自动补齐 `handlerName` 字段（`handlerId` 固定为 0）。

**文件**：
- `apps/web/src/app/api/v1/reports/route.ts` — POST
- `apps/web/src/app/api/v1/posting-permission/route.ts` — GET（新增）
- `apps/web/src/app/api/admin/reports/route.ts` — GET
- `apps/web/src/app/api/admin/reports/[id]/route.ts` — GET, PATCH（补齐处理人）
- `apps/web/src/app/api/admin/reports/batch-delete/route.ts` — POST

### 5.2 ViewModel

**`apps/web/src/viewmodels/forum/report.ts`**（新建）：

| 导出 | 说明 |
|------|------|
| `REPORT_REASONS` | 预设举报理由常量 |
| `ReportPayload` | 举报请求类型 |
| `checkReportPermission()` | 检查发帖权限 |
| `submitReport(payload)` | 提交举报 |

**`apps/web/src/viewmodels/admin/reports.ts`**（新建）：

| 导出 | 说明 |
|------|------|
| `Report` | 举报记录类型（含 threadId） |
| `ReportListParams` | 列表查询参数 |
| `fetchReports(params)` | 获取举报列表 |
| `updateReportStatus(id, status)` | 更新举报状态 |
| `batchDeleteReports(ids)` | 批量删除（单条删除传 `[id]`） |

---

## 6. 前端 — 用户端

### 6.1 帖子操作栏改造

**文件**：`apps/web/src/components/forum/post-action-bar.tsx`

在操作栏右侧（编辑/删除按钮之前或之后）添加"举报"按钮，targetType 固定为 `post`：

```
┌─────────────────────────────────────────────────────────┐
│ [回复]                          [编辑] [删除] [举报] │
└─────────────────────────────────────────────────────────┘
```

**显示条件**：
- 用户已登录
- 不是自己的帖子

### 6.1.1 主题头部入口

**文件**：`apps/web/src/components/forum/thread-report-button.tsx`

主题详情页头部右侧渲染"举报主题"按钮，targetType=`thread`，targetId=`thread.id`。

**显示条件**：
- 用户已登录
- 不是主题作者

### 6.1.2 用户主页入口

**文件**：`apps/web/src/components/forum/user-report-button.tsx`

个人主页 hero 区渲染"举报用户"按钮，targetType=`user`，targetId=`user.id`。

**显示条件**：
- 用户已登录
- 不是本人主页

### 6.2 举报弹窗

**文件**：`apps/web/src/components/forum/report-dialog.tsx`（新建）

弹窗打开后，按顺序执行三步校验：

**Step 1: 权限检查**（自动执行）

调用 `/api/v1/posting-permission` 检查用户是否有发帖权限：
- ✓ 通过 → 显示绿色勾，进入 Step 2
- ✗ 失败 → 显示红色叉和具体原因，禁用后续步骤

**Step 2: Cap.js 验证**

显示 CapWidget 组件（复用 `NEXT_PUBLIC_CAP_API_ENDPOINT`）：
- ✓ 通过 → 显示绿色勾，进入 Step 3
- ✗ 失败 → 显示重试按钮
- 如果 `NEXT_PUBLIC_CAP_API_ENDPOINT` 未配置，自动跳过此步

**Step 3: 选择理由**

显示预设理由列表（radio）：
- 必须选择一个才能提交

**完整 UI（全部通过）**：

```
┌─────────────────────────────────────────────────┐
│  举报内容                                   [×] │
├─────────────────────────────────────────────────┤
│                                                 │
│  ✓ 权限检查通过                                │
│                                                 │
│  ✓ Cap.js 验证通过                             │
│                                                 │
│  请选择举报理由：                               │
│                                                 │
│  ○ 垃圾广告                                    │
│  ○ 违规内容                                    │
│  ○ 人身攻击                                    │
│  ○ 虚假信息                                    │
│  ○ 侵权内容                                    │
│  ○ 其他                                        │
│                                                 │
│                        [取消]  [提交举报]       │
└─────────────────────────────────────────────────┘
```

**权限检查失败时**：

```
┌─────────────────────────────────────────────────┐
│  举报内容                                   [×] │
├─────────────────────────────────────────────────┤
│                                                 │
│  ✗ 权限检查未通过                              │
│                                                 │
│    您的账号注册未满 24 小时，暂时无法举报。    │
│                                                 │
│                                      [关闭]     │
└─────────────────────────────────────────────────┘
```

**提交按钮状态**：
- 权限检查失败 → 不显示提交按钮
- Cap.js 未通过 → 禁用（未配置时跳过此检查）
- 未选择理由 → 禁用
- 全部通过 → 可点击

### 6.3 Props 传递

`PostCard` → `PostActionBar`：新增 `onReport` prop

```tsx
interface PostActionBarProps {
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;  // 新增
  canEdit?: boolean;
  canDelete?: boolean;
  showReport?: boolean;   // 新增：已登录且非自己帖子
}
```

---

## 7. 前端 — 管理后台

### 7.1 导航配置

**文件**：`apps/web/src/lib/navigation.ts`

1. 在 `ROUTE_LABELS` 追加：

```ts
reports: "举报管理",
```

2. 在 `NAV_GROUPS`"安全管理"组追加：

```ts
{ href: "/admin/reports", label: "举报管理", icon: "Flag" }
```

### 7.2 举报列表页

**文件**：`apps/web/src/app/(admin)/admin/reports/page.tsx`

```
┌─────────────────────────────────────────────────────────────┐
│  举报管理                                                    │
│  处理用户提交的举报（主题 / 帖子 / 用户）                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  筛选: [全部状态 ▼]  [全部类型 ▼]                [刷新]     │
│                                                              │
├──────┬────┬──────┬────────────┬────────┬──────────┬───────┤
│  ☐  │ ID │ 类型 │ 举报对象    │ 举报人 │ 理由     │ 状态  │
├──────┼────┼──────┼────────────┼────────┼──────────┼───────┤
│  ☐  │ 1  │ 帖子 │ 主题标题... │ alice  │ 垃圾广告 │ 待处理│
│  ☐  │ 2  │ 主题 │ 主题标题... │ bob    │ 人身攻击 │ 已处理│
│  ☐  │ 3  │ 用户 │ @carol      │ dave   │ 违规     │ 已驳回│
└──────┴────┴──────┴────────────┴────────┴──────────┴───────┘
│                                                              │
│  [批量删除]                              < 1 2 3 ... 10 >   │
└─────────────────────────────────────────────────────────────┘
```

**列说明**：

| 列 | 说明 |
|----|------|
| 类型 | `thread` / `post` / `user` 徽标 |
| 举报对象 | 按 type 渲染：thread/post → `target_title`，跳转 `/admin/threads/{threadId 或 target_id}`；user → `@target_name`，跳转 `/admin/users/{target_id}` |
| 举报人 | 可点击，跳转到 `/admin/users/:id` |
| 理由 | 显示 reason 字段（预设值） |
| 状态 | 待处理（黄）/已处理（绿）/已驳回（灰） |

**筛选项**：
- 状态：全部 / 待处理 / 已处理 / 已驳回
- 类型：全部 / 主题 / 帖子 / 用户

### 7.3 举报详情/处理

点击行展开或弹窗显示详情：

```
┌─────────────────────────────────────────────────┐
│  举报详情 #1                                [×] │
├─────────────────────────────────────────────────┤
│                                                 │
│  类型：帖子 / 主题 / 用户                       │
│  举报对象：<target_title 或 @target_name> [查看 →] │
│  举报人：alice (UID: 100)  [查看 →]            │
│  举报理由：垃圾广告                             │
│  举报时间：2026-04-04 10:30:00                 │
│                                                 │
│  当前状态：待处理                               │
│                                                 │
│              [标记已处理]  [驳回举报]  [删除]   │
└─────────────────────────────────────────────────┘
```

**操作按钮**：
- **标记已处理**：设置 status=resolved
- **驳回举报**：设置 status=dismissed
- **删除**：调用 batch-delete 传 `[id]`

**跳转链接**（admin 内部跳转，不跳前台）：
- `type=thread`：`/admin/threads/{target_id}`
- `type=post`：`/admin/threads/{threadId}`（目前没有 stable 的 post anchor，跳到所属主题详情）
- `type=user`：`/admin/users/{target_id}`
- 举报人：`/admin/users/{reporterId}`

### 7.4 文件结构

```
apps/web/src/
├── app/(admin)/admin/reports/
│   └── page.tsx              # 举报列表页
├── components/admin/
│   └── reports-table.tsx     # 举报表格组件
└── viewmodels/admin/
    └── reports.ts            # ViewModel
```

---

## 8. 实现步骤

按依赖顺序，每步一个原子化 commit：

| Step | 任务 | 关键文件 |
|------|------|---------|
| 1 | Worker 用户举报 handler（含 posting-permission） | `apps/worker/src/handlers/report.ts` |
| 2 | Worker 路由注册 | `apps/worker/src/index.ts` |
| 3 | Admin handler 改造（联表查 threadId） | `apps/worker/src/handlers/admin/report.ts` |
| 4 | Next.js proxy routes（用户端，含 posting-permission） | `apps/web/src/app/api/v1/reports/`, `posting-permission/` |
| 5 | Next.js proxy routes（Admin，补齐处理人） | `apps/web/src/app/api/admin/reports/` |
| 6 | 用户端 ViewModel | `apps/web/src/viewmodels/forum/report.ts` |
| 7 | 举报弹窗组件 | `apps/web/src/components/forum/report-dialog.tsx` |
| 8 | PostActionBar 改造 | `post-action-bar.tsx`, `post-card.tsx` |
| 9 | Admin ViewModel | `apps/web/src/viewmodels/admin/reports.ts` |
| 10 | Admin 导航配置 | `apps/web/src/lib/navigation.ts` |
| 11 | Admin 举报列表页 | `apps/web/src/app/(admin)/admin/reports/page.tsx` |
| 12 | Admin 表格组件 | `apps/web/src/components/admin/reports-table.tsx` |

```
Step 1 → Step 2 → Step 3 → Step 4 → Step 5
                              ↓
                    Step 6 → Step 7 → Step 8
                              ↓
                    Step 9 → Step 10 → Step 11 → Step 12
```

---

## 9. 验证清单

### 用户端

- [ ] 举报按钮：已登录用户可见（非自己的对象）
- [ ] 举报按钮：未登录用户不可见
- [ ] 举报按钮：自己的主题/帖子/账号不显示举报按钮
- [ ] 举报弹窗 Step 1：权限检查（发帖权限）
- [ ] 举报弹窗 Step 1：新用户/禁言用户显示具体限制原因
- [ ] 举报弹窗 Step 2：Cap.js 验证（未配置则跳过）
- [ ] 举报弹窗 Step 3：必须选择预设理由才能提交
- [ ] 举报提交：成功后显示提示信息
- [ ] 举报提交：reason 必须是预设值之一
- [ ] 重复举报：24 小时内重复举报显示友好提示（按 type+target_id 去重）
- [ ] 类型支持：thread / post / user 三类型均可提交

### 管理后台

- [ ] 导航：显示"举报管理"入口
- [ ] 列表：正确显示所有举报记录（含 类型 列与 类型 筛选）
- [ ] 列表：thread/post 显示 target_title，user 显示 @target_name
- [ ] 筛选：状态筛选 + 类型筛选正常工作
- [ ] 分页：分页正常工作
- [ ] 详情：点击可查看举报详情
- [ ] 跳转：thread/post 跳 `/admin/threads/:id`，user 跳 `/admin/users/:id`
- [ ] 处理：标记已处理/驳回正常，handler_name 正确记录
- [ ] 删除：调用 batch-delete 传 `[id]` 正常

### 通用

- [ ] `bun run typecheck` 通过
- [ ] `bun run test` 无回归
- [ ] Worker 部署后 API 正常

---

## 10. 后续工作

| 功能 | 说明 |
|------|------|
| 举报通知 | 举报提交后通知管理员（站内信/邮件） |
| 一键处理 | 处理举报时可选直接删除/隐藏被举报对象 |
| 举报统计 | Dashboard 显示待处理举报数量、按类型分布 |
| 举报历史 | 用户个人中心查看自己的举报记录 |
