# 13 — 举报功能

> 用户举报**帖子**的前端入口、用户端 API、管理后台列表与处理界面。
>
> **前置依赖**：02（数据库设计，reports 表已存在）、05（Worker API）、10（管理后台）

---

## 0. 设计决策

| # | 问题 | 决策 | 说明 |
|---|------|------|------|
| 1 | 本期范围 | **只做 post 举报** | thread/user 举报留后续迭代 |
| 2 | 举报理由 | **只允许预设值** | 不支持自定义补充说明，避免结构化数据丢失 |
| 3 | 跳转元数据 | **联表查** | Admin API 查询时 JOIN posts/threads 补齐 thread_id |
| 4 | 单条删除 | **用 batch-delete** | 前端传 `[id]` 单元素数组 |
| 5 | 处理人身份 | **只记录 name** | handler_id 固定为 0，handler_name 从 session 取 |

---

## 1. 现状分析

### 1.1 已有实现

| 组件 | 状态 | 说明 |
|------|------|------|
| `reports` 表 | ✅ 已存在 | schema.ts 已定义 |
| Admin API | ⚠️ 需改造 | 需联表补齐 thread_id 用于跳转 |
| 用户端举报 API | ❌ 缺失 | 无 `/api/v1/reports` 端点 |
| 前端举报入口 | ❌ 缺失 | 帖子操作栏无举报按钮 |
| Admin 举报管理页 | ❌ 缺失 | 无 `/admin/reports` 页面 |

### 1.2 本次实现

| 功能 | 说明 |
|------|------|
| 用户举报 API | 创建举报（POST `/api/v1/reports`），仅支持 `type=post` |
| 帖子举报入口 | 帖子操作栏右侧添加"举报"按钮 |
| 举报弹窗 | 选择举报理由 + 可选补充说明（拼入 reason） |
| Admin API 改造 | 联表查询补齐 thread_id |
| Admin 举报列表 | 查看所有举报，按状态筛选 |
| Admin 举报处理 | 标记已处理/驳回，跳转查看被举报帖子 |

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
| `type` | 举报类型：本期只支持 `post` |
| `target_id` | 被举报帖子 ID（posts.id） |
| `reporter_id` | 举报人 UID |
| `reason` | 举报理由（预设值，不支持自定义） |
| `status` | `pending`=待处理，`resolved`=已处理，`dismissed`=已驳回 |
| `handler_id` | 固定为 0（admin 无数值 ID） |
| `handler_name` | 处理人名称（从 admin session 取） |
| `handled_at` | 处理时间 |

---

## 3. 权限设计

### 3.1 举报权限

用户必须满足**所有**以下条件才能举报：

| # | 条件 | 检查方式 |
|---|------|---------|
| 1 | 已登录 | JWT 鉴权 |
| 2 | 账号状态正常 | `users.status >= 0` |
| 3 | 符合新用户限制 | 复用 `checkPostingPermission()` |
| 4 | 不能举报自己的帖子 | `post.author_id != reporter_id` |
| 5 | 帖子存在 | 被举报的帖子存在 |

### 3.2 重复举报限制

- 同一用户对同一帖子，24 小时内只能举报一次
- 检查：`SELECT 1 FROM reports WHERE reporter_id=? AND type='post' AND target_id=? AND created_at > ?`

---

## 4. Worker API

### 4.1 用户端端点

| # | Method | Path | Handler | 说明 |
|---|--------|------|---------|------|
| #75 | `POST` | `/api/v1/reports` | `create` | 提交帖子举报 |

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
| `type` | string | ✅ | 本期只接受 `post` |
| `targetId` | number | ✅ | 被举报帖子 ID |
| `reason` | string | ✅ | 必须是预设值之一 |

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
| `FORBIDDEN` | 403 | 无权限（新用户限制等） |
| `INVALID_REQUEST` | 400 | 参数错误、type 不是 post、reason 不在预设列表 |
| `TARGET_NOT_FOUND` | 404 | 举报的帖子不存在 |
| `CANNOT_REPORT_SELF` | 400 | 不能举报自己的帖子 |
| `DUPLICATE_REPORT` | 400 | 24 小时内重复举报 |

### 4.3 Admin 端点

| # | Method | Path | Handler | 状态 |
|---|--------|------|---------|------|
| #35 | `GET` | `/api/admin/reports` | `list` | ⚠️ 需改造 |
| #36 | `GET` | `/api/admin/reports/:id` | `getById` | ⚠️ 需改造 |
| #37 | `PATCH` | `/api/admin/reports/:id` | `update` | ✅ 已有 |
| #38 | `POST` | `/api/admin/reports/batch-delete` | `batchDelete` | ✅ 已有 |

**改造内容**：list 和 getById 需联表查询，返回 `threadId` 用于跳转：

```sql
SELECT r.*, p.thread_id
FROM reports r
LEFT JOIN posts p ON r.type = 'post' AND r.target_id = p.id
```

**返回字段新增**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `threadId` | number \| null | 帖子所属主题 ID，用于跳转 `/threads/{threadId}#post-{targetId}` |

### 4.4 文件位置

| 文件 | 说明 |
|------|------|
| `apps/worker/src/handlers/report.ts` | 新建，用户端 create handler |
| `apps/worker/src/handlers/admin/report.ts` | 改造 list/getById 联表查询 |

### 4.5 路由注册

在 `apps/worker/src/index.ts` 中：

```
Auth routes (#12-#15)
  ↓
#75  POST   /api/v1/reports   ← 新增
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
| `/api/admin/reports` | GET | Worker `/api/admin/reports` |
| `/api/admin/reports/[id]` | GET, PATCH | Worker `/api/admin/reports/:id` |
| `/api/admin/reports/batch-delete` | POST | Worker `/api/admin/reports/batch-delete` |

**PATCH 处理人信息**：Next.js proxy 从 session 获取当前 admin 名称，自动补齐 `handlerName` 字段（`handlerId` 固定为 0）。

**文件**：
- `apps/web/src/app/api/v1/reports/route.ts` — POST
- `apps/web/src/app/api/admin/reports/route.ts` — GET
- `apps/web/src/app/api/admin/reports/[id]/route.ts` — GET, PATCH（补齐处理人）
- `apps/web/src/app/api/admin/reports/batch-delete/route.ts` — POST

### 5.2 ViewModel

**`apps/web/src/viewmodels/forum/report.ts`**（新建）：

| 导出 | 说明 |
|------|------|
| `REPORT_REASONS` | 预设举报理由常量 |
| `ReportPayload` | 举报请求类型 |
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

在操作栏右侧（编辑/删除按钮之前或之后）添加"举报"按钮：

```
┌─────────────────────────────────────────────────────────┐
│ [回复]                          [编辑] [删除] [举报] │
└─────────────────────────────────────────────────────────┘
```

**显示条件**：
- 用户已登录
- 不是自己的帖子
- 用户有举报权限（满足新用户限制）

### 6.2 举报弹窗

**文件**：`apps/web/src/components/forum/report-dialog.tsx`（新建）

```
┌─────────────────────────────────────────────────┐
│  举报内容                                   [×] │
├─────────────────────────────────────────────────┤
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
│  补充说明（可选）：                             │
│  ┌─────────────────────────────────────────┐   │
│  │                                         │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
│                        [取消]  [提交举报]       │
└─────────────────────────────────────────────────┘
```

**交互**：
1. 必须选择一个举报理由
2. 补充说明可选，限 500 字符
3. 提交成功显示"举报已提交，我们会尽快处理"
4. 24 小时内重复举报显示友好提示

### 6.3 Props 传递

`PostCard` → `PostActionBar`：新增 `onReport` 和 `canReport` props

```tsx
interface PostActionBarProps {
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onReport?: () => void;  // 新增
  canEdit?: boolean;
  canDelete?: boolean;
  canReport?: boolean;    // 新增
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
│  处理用户举报的帖子                                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  筛选: [全部状态 ▼]                              [刷新]     │
│                                                              │
├──────┬────────┬──────────┬────────┬────────────────┬───────┤
│  ☐  │ ID     │ 举报帖子  │ 举报人  │ 理由           │ 状态  │
├──────┼────────┼──────────┼────────┼────────────────┼───────┤
│  ☐  │ 1      │ #12345   │ alice  │ 垃圾广告       │ 待处理│
│  ☐  │ 2      │ #67890   │ bob    │ 人身攻击       │ 已处理│
│  ☐  │ 3      │ #11111   │ carol  │ 违规内容       │ 已驳回│
└──────┴────────┴──────────┴────────┴────────────────┴───────┘
│                                                              │
│  [批量删除]                              < 1 2 3 ... 10 >   │
└─────────────────────────────────────────────────────────────┘
```

**列说明**：

| 列 | 说明 |
|----|------|
| 举报帖子 | `#target_id`，可点击跳转到 `/threads/{threadId}#post-{targetId}` |
| 举报人 | 可点击，跳转到用户页 |
| 理由 | 显示 reason 字段（预设值） |
| 状态 | 待处理（黄）/已处理（绿）/已驳回（灰） |

**筛选项**：
- 状态：全部 / 待处理 / 已处理 / 已驳回

### 7.3 举报详情/处理

点击行展开或弹窗显示详情：

```
┌─────────────────────────────────────────────────┐
│  举报详情 #1                                [×] │
├─────────────────────────────────────────────────┤
│                                                 │
│  被举报帖子：#12345 [查看 →]                   │
│  举报人：alice (UID: 100)  [查看 →]            │
│  举报理由：垃圾广告                             │
│  举报时间：2024-04-04 10:30:00                 │
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

**跳转链接**：
- 帖子：`/threads/{threadId}#post-{targetId}`（threadId 从 API 返回）
- 用户：`/users/{reporterId}`

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
| 1 | Worker 用户举报 handler | `apps/worker/src/handlers/report.ts` |
| 2 | Worker 路由注册 | `apps/worker/src/index.ts` |
| 3 | Admin handler 改造（联表查 threadId） | `apps/worker/src/handlers/admin/report.ts` |
| 4 | Next.js proxy routes（用户端） | `apps/web/src/app/api/v1/reports/route.ts` |
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

- [ ] 举报按钮：已登录用户可见（非自己的帖子）
- [ ] 举报按钮：未登录用户不可见
- [ ] 举报按钮：自己的帖子不显示举报按钮
- [ ] 举报弹窗：必须选择理由才能提交
- [ ] 举报提交：成功后显示提示信息
- [ ] 举报提交：reason 必须是预设值之一
- [ ] 重复举报：24 小时内重复举报显示友好提示
- [ ] 权限限制：新用户限制生效
- [ ] 权限限制：封禁/禁言用户无法举报
- [ ] 类型限制：只接受 type=post

### 管理后台

- [ ] 导航：显示"举报管理"入口
- [ ] 列表：正确显示所有举报记录
- [ ] 列表：显示 threadId 用于跳转
- [ ] 筛选：状态筛选正常工作
- [ ] 分页：分页正常工作
- [ ] 详情：点击可查看举报详情
- [ ] 跳转：点击举报帖子可跳转到 `/threads/{threadId}#post-{targetId}`
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
| 主题举报 | 支持举报主题（入口、API、后台） |
| 用户举报 | 支持直接举报用户（不依赖具体帖子） |
| 举报通知 | 举报提交后通知管理员（站内信/邮件） |
| 一键处理 | 处理举报时可选直接删除被举报帖子 |
| 举报统计 | Dashboard 显示待处理举报数量 |
| 举报历史 | 用户个人中心查看自己的举报记录 |
