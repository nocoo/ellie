# 12 — 站内信系统

> 用户间私信功能的数据库设计、Worker API、前端页面。
>
> **前置依赖**：02（数据库设计）、04g（用户认证）、08a（功能设置）

---

## 1. 功能范围

### 1.1 本次实现

| 功能 | 说明 |
|------|------|
| 发送站内信 | 用户可向其他用户发送私信 |
| 收信箱 | 查看收到的站内信列表 |
| 发信箱 | 查看已发送的站内信列表 |
| 查看详情 | 阅读单条站内信内容 |
| 标记已读 | 打开站内信时自动标记已读 |
| 删除站内信 | 用户可删除自己收/发的站内信 |

### 1.2 不在本次范围

| 功能 | 说明 |
|------|------|
| 会话模式 | 不实现类似微信的对话聚合，保持传统信件列表模式 |
| 群发消息 | 不支持一次发送给多人 |
| 附件 | 站内信不支持附件 |
| 系统通知 | 系统消息走单独的通知系统（未来实现） |
| 黑名单 | 不支持屏蔽特定用户的消息 |

### 1.3 术语统一

**全站统一使用"站内信"**：

| 位置 | 当前 | 改为 |
|------|------|------|
| 页面 title | `消息` | `站内信` |
| 面包屑 | `通知 > 消息` | `站内信` |
| 侧边栏标题 | `通知` | `站内信` |
| 按钮 | `发消息` | `发站内信` |

**图标**：统一使用 `Mail`（信封图标）。

---

## 2. 数据库设计

### 2.1 messages 表

```sql
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_id INTEGER NOT NULL,
    sender_name TEXT NOT NULL,
    receiver_id INTEGER NOT NULL,
    receiver_name TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    sender_deleted INTEGER NOT NULL DEFAULT 0,
    receiver_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
```

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | INTEGER PK | 自增主键 |
| `sender_id` | INTEGER | 发送者 UID |
| `sender_name` | TEXT | 发送者用户名（冗余，避免 JOIN） |
| `receiver_id` | INTEGER | 接收者 UID |
| `receiver_name` | TEXT | 接收者用户名（冗余） |
| `subject` | TEXT | 主题（可空，默认空字符串） |
| `content` | TEXT | 正文内容 |
| `is_read` | INTEGER | 0=未读，1=已读 |
| `sender_deleted` | INTEGER | 发送者是否删除（0/1） |
| `receiver_deleted` | INTEGER | 接收者是否删除（0/1） |
| `created_at` | INTEGER | 发送时间（Unix 时间戳） |

**设计决策**：

- **软删除**：发送者和接收者各自独立删除，只有双方都删除后才可物理清理
- **冗余用户名**：避免列表查询时 JOIN users 表
- **无会话概念**：每条消息独立，不聚合为对话

### 2.2 索引

```sql
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id, receiver_deleted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id, sender_deleted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(receiver_id, is_read, receiver_deleted);
```

### 2.3 Schema 文件更新

在 `packages/db/src/schema.ts` 的 `TABLES` 和 `INDEXES` 中追加 `messages`。

---

## 3. 权限设计

### 3.1 发送权限

用户必须满足**所有**以下条件才能发送站内信：

| # | 条件 | 检查方式 |
|---|------|---------|
| 1 | 已登录 | JWT 鉴权 |
| 2 | 账号状态正常 | `users.status >= 0`（非封禁/禁言） |
| 3 | 符合新用户限制 | 与发帖限制相同（见 §3.2） |
| 4 | 收信人存在 | `receiver_id` 在 users 表中存在 |
| 5 | 不能发给自己 | `sender_id != receiver_id` |

### 3.2 新用户限制（复用 features.posting 设置）

站内信发送与发帖使用相同的限制规则：

| 设置 key | 说明 |
|---------|------|
| `features.posting.enabled` | 总开关，关闭则不检查限制 |
| `features.posting.min_registration_days` | 注册满 N 天才能发送 |
| `features.posting.require_email_verified` | 需要邮箱验证（预留，当前无邮箱验证功能） |
| `features.posting.require_avatar` | 需要设置头像 |

**实现**：抽取 `checkPostingPermission(env, user)` 公共函数，供发帖和发站内信复用。

### 3.3 阅读权限

- 只能查看自己发送或接收的站内信
- 只能删除自己一方的记录（软删除）

---

## 4. Worker API

### 4.1 鉴权模型说明

**重要**：Worker 所有 `/api/v1/*` 端点都需要同时满足两层鉴权：

1. **API Key 层**：`X-API-Key` 头部必须包含有效的 Key A
2. **JWT 层**：需要用户身份的端点，`Authorization: Bearer <jwt>` 头部必须包含有效的 Worker JWT

**调用链路**：

```
浏览器 → Next.js Proxy Route → Worker
         (自动注入 X-API-Key)   (校验 Key + JWT)
```

浏览器**永远不能**直接调用 Worker。Next.js Proxy Route 负责：
- 从 NextAuth session 中提取 Worker JWT
- 注入 `X-API-Key`（Key A，服务端环境变量）
- 转发请求到 Worker

**Credentials 用户限制**：站内信功能仅对 `provider === "credentials"` 的用户可用。Google OAuth 用户访问 `/messages` 页面时，前端需要显示"请使用论坛账号登录"的提示。

### 4.2 端点列表

| # | Method | Path | 鉴权 | 说明 |
|---|--------|------|------|------|
| #70 | `GET` | `/api/v1/messages` | Key A + JWT | 获取站内信列表 |
| #71 | `GET` | `/api/v1/messages/unread-count` | Key A + JWT | 获取未读数量 |
| #72 | `GET` | `/api/v1/messages/:id` | Key A + JWT | 获取单条站内信详情 |
| #73 | `POST` | `/api/v1/messages` | Key A + JWT | 发送站内信 |
| #74 | `DELETE` | `/api/v1/messages/:id` | Key A + JWT | 删除站内信 |
| #75 | `GET` | `/api/v1/users/search` | Key A | 用户名搜索（自动补全用） |

### 4.3 #70 GET /api/v1/messages

**Query 参数**：

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `box` | string | `inbox` | `inbox`=收信箱，`outbox`=发信箱 |
| `limit` | number | 20 | 每页数量，最大 100 |
| `cursor` | string | - | 分页游标 |

**响应**：

```json
{
  "data": [
    {
      "id": 1,
      "senderId": 100,
      "senderName": "alice",
      "receiverId": 200,
      "receiverName": "bob",
      "subject": "关于您的帖子",
      "preview": "您好，想请教一下...",
      "isRead": false,
      "createdAt": 1712345678
    }
  ],
  "meta": {
    "timestamp": 1712345700000,
    "requestId": "uuid-xxx",
    "nextCursor": "xxx",
    "unreadCount": 5
  }
}
```

**说明**：
- `preview`：内容截取前 100 字符
- `unreadCount`：仅 inbox 返回

### 4.4 #71 GET /api/v1/messages/unread-count

**响应**：

```json
{
  "data": {
    "count": 5
  },
  "meta": {
    "timestamp": 1712345700000,
    "requestId": "uuid-xxx"
  }
}
```

### 4.5 #72 GET /api/v1/messages/:id

**行为**：
- 返回完整消息内容
- 如果是收信人查看，自动标记为已读

**响应**：

```json
{
  "data": {
    "id": 1,
    "senderId": 100,
    "senderName": "alice",
    "receiverId": 200,
    "receiverName": "bob",
    "subject": "关于您的帖子",
    "content": "完整内容...",
    "isRead": true,
    "createdAt": 1712345678
  },
  "meta": {
    "timestamp": 1712345700000,
    "requestId": "uuid-xxx"
  }
}
```

### 4.6 #73 POST /api/v1/messages

**请求体**：

```json
{
  "receiverId": 200,
  "subject": "可选主题",
  "content": "消息内容"
}
```

**验证**：
1. `receiverId` 必填，必须是有效用户
2. `content` 必填，长度 1-10000 字符
3. `subject` 可选，长度 0-100 字符
4. 检查发送权限（§3.1）
5. 敏感词过滤（复用 `applyCensorFilter`）

**响应**：201 Created

```json
{
  "data": {
    "id": 123,
    "receiverId": 200,
    "receiverName": "bob",
    "subject": "可选主题",
    "createdAt": 1712345678
  },
  "meta": {
    "timestamp": 1712345700000,
    "requestId": "uuid-xxx"
  }
}
```

### 4.7 #74 DELETE /api/v1/messages/:id

**行为**：
- 发送者调用：设置 `sender_deleted = 1`
- 接收者调用：设置 `receiver_deleted = 1`
- 只能删除自己参与的消息

**响应**：200 OK

```json
{
  "data": {
    "deleted": true,
    "id": 123
  },
  "meta": {
    "timestamp": 1712345700000,
    "requestId": "uuid-xxx"
  }
}
```

### 4.8 #75 GET /api/v1/users/search

**用途**：写站内信时的收信人自动补全。

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `q` | string | ✅ | 搜索关键词，最少 2 字符 |
| `limit` | number | ❌ | 返回数量，默认 10，最大 20 |

**响应**：

```json
{
  "data": [
    { "id": 100, "username": "alice" },
    { "id": 101, "username": "alice_test" }
  ],
  "meta": {
    "timestamp": 1712345700000,
    "requestId": "uuid-xxx"
  }
}
```

**说明**：
- 按 `username LIKE 'keyword%'` 前缀匹配
- 只返回 status >= 0 的正常用户
- 不需要 JWT（公开端点，但需要 Key A）

### 4.9 文件位置

| 文件 | 说明 |
|------|------|
| `apps/worker/src/handlers/message.ts` | 5 个 message handler 函数 |
| `apps/worker/src/handlers/user.ts` | 追加 `search` handler |
| `apps/worker/src/lib/postingPermission.ts` | 发帖/发信权限检查公共函数 |

### 4.10 路由注册

在 `apps/worker/src/index.ts` 中：

```
Public routes (#2-#11)
  ↓
#75  GET    /api/v1/users/search           ← 新增（公开，仅 Key A）
  ↓
#12  GET    /api/v1/users/:id              ← 现有
  ↓
Auth routes (#12-#15)
  ↓
#70  GET    /api/v1/messages               ← 新增
#71  GET    /api/v1/messages/unread-count  ← 新增（放在 :id 之前）
#72  GET    /api/v1/messages/:id           ← 新增
#73  POST   /api/v1/messages               ← 新增
#74  DELETE /api/v1/messages/:id           ← 新增
  ↓
Other routes...
```

---

## 5. Next.js 数据链路

### 5.1 Proxy Routes

由于浏览器需要调用这些 API，需要创建 proxy routes：

| Next.js Route | 方法 | 说明 |
|---------------|------|------|
| `/api/v1/messages` | GET | 列表（`forumApi.getAuth`） |
| `/api/v1/messages` | POST | 发送（`forumApi.postAuth`） |
| `/api/v1/messages/unread-count` | GET | 未读数（`forumApi.getAuth`） |
| `/api/v1/messages/[id]` | GET | 详情（`forumApi.getAuth`） |
| `/api/v1/messages/[id]` | DELETE | 删除（`forumApi.deleteAuth`） |
| `/api/v1/users/search` | GET | 用户搜索（`forumApi.get`，无需 JWT） |

**文件**：
- `apps/web/src/app/api/v1/messages/route.ts` — GET（`forumApi.getAuth`）、POST（`forumApi.postAuth`）
- `apps/web/src/app/api/v1/messages/unread-count/route.ts` — GET（`forumApi.getAuth`）
- `apps/web/src/app/api/v1/messages/[id]/route.ts` — GET（`forumApi.getAuth`）、DELETE（`forumApi.deleteAuth`）
- `apps/web/src/app/api/v1/users/search/route.ts` — GET（`forumApi.get`，无需 JWT）

### 5.2 Proxy 实现模式

**重要**：现有 `authFetch()`/`authPatch()` 函数仅封装 POST/PATCH 方法。对于 GET/DELETE，需要直接使用 `forumApi.getAuth()`/`forumApi.deleteAuth()` + 手动获取 JWT。

**错误处理**：`forumApi.*Auth()` 方法在非 2xx 响应时会抛出 `ForumApiError`，必须 try/catch 并透传 Worker 的 HTTP 状态码和错误信息。

**GET 端点**（使用 `forumApi.getAuth`）：

```ts
// apps/web/src/app/api/v1/messages/route.ts
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApi, ForumApiError } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const jwt = await getWorkerJwt();
  if (!jwt) {
    return NextResponse.json(
      { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
      { status: 401 }
    );
  }
  
  try {
    const url = new URL(request.url);
    const result = await forumApi.getAuth<MessagesResponse>(
      `/api/v1/messages`,
      jwt,
      Object.fromEntries(url.searchParams)
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ForumApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500 }
    );
  }
}
```

**POST 端点**（不使用 `authFetch`，需要透传业务错误状态码）：

`authFetch()` 会丢失 Worker 的原始 HTTP 状态码，不适合需要区分 400/403/404 等业务错误的场景。站内信发送需要手动实现。

> **设计决策**：此实现放弃了 `authFetch()` 内置的 TOKEN_EXPIRED 自动刷新重试能力。
> 若用户长时间停留在发信页面后 JWT 过期，发送失败后需要用户手动重试。
> 权衡考量：准确的业务错误状态码（400/403/404）对用户体验更重要，且消息发送失败可简单重试。

```ts
// apps/web/src/app/api/v1/messages/route.ts (POST handler)
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApi, ForumApiError } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const jwt = await getWorkerJwt();
  if (!jwt) {
    return NextResponse.json(
      { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const result = await forumApi.postAuth<CreateMessageResponse>(
      "/api/v1/messages",
      body,
      jwt
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ForumApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500 }
    );
  }
}
```

**DELETE 端点**（使用 `forumApi.deleteAuth`）：

```ts
// apps/web/src/app/api/v1/messages/[id]/route.ts
import { getWorkerJwt } from "@/lib/forum-auth";
import { forumApi, ForumApiError } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const jwt = await getWorkerJwt();
  if (!jwt) {
    return NextResponse.json(
      { error: { code: "NOT_AUTHENTICATED", message: "Not authenticated" } },
      { status: 401 }
    );
  }
  
  try {
    const { id } = await params;
    const result = await forumApi.deleteAuth<DeleteResponse>(
      `/api/v1/messages/${id}`,
      undefined,  // 无 body，传 undefined 避免发送 JSON
      jwt
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ForumApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500 }
    );
  }
}
```

**不需要 JWT 的端点**（使用 `forumApi.get`）：

```ts
// apps/web/src/app/api/v1/users/search/route.ts
import { forumApi, ForumApiError } from "@/lib/forum-api";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const result = await forumApi.get<UserSearchResponse>(
      `/api/v1/users/search`,
      Object.fromEntries(url.searchParams)
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ForumApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      { status: 500 }
    );
  }
}
```

### 5.3 ViewModel

**`apps/web/src/viewmodels/forum/messages.ts`**（改造现有文件）：

| 导出 | 说明 |
|------|------|
| `Message` | 站内信类型定义 |
| `MessageListItem` | 列表项（含 preview） |
| `useMessages(box)` | React hook，获取消息列表 |
| `useUnreadCount()` | React hook，获取未读数 |
| `sendMessage(payload)` | 发送站内信 |
| `deleteMessage(id)` | 删除站内信 |
| `searchUsers(query)` | 搜索用户（自动补全） |
| `SIDEBAR_ITEMS` | 侧边栏菜单定义 |

---

## 6. 前端页面

### 6.1 页面结构

```
/messages                → 收信箱（默认）
/messages?box=outbox     → 发信箱
/messages/:id            → 站内信详情
/messages?to=123         → 收信箱 + 自动打开写信弹窗（预填收信人）
```

**注意**：使用 `?to=123` query param + 弹窗模式，而非独立的 `/messages/compose` 页面。这与现有入口（`user-popover.tsx`、`post-sidebar.tsx` 中的 `/messages?to=${user.id}`）保持兼容。

### 6.2 页面鉴权

`/messages*` 页面需要 credentials 用户登录。需要区分三种情况：
1. 未登录 → 跳转登录页
2. Google OAuth 登录（无 Worker JWT）→ 显示提示
3. Credentials 登录 → 正常渲染

**问题**：现有 `getCurrentForumUser()` 对 Google 用户返回 null，无法区分"未登录"和"Google 登录"。

**解决方案**：
1. 新增 `getSessionProvider()` 函数（在 `forum-auth.ts` 中）
2. 在 `messages/layout.tsx` 中统一做鉴权守卫，子页面无需重复

```ts
// apps/web/src/lib/forum-auth.ts 新增
/** Get current session provider, or null if not logged in */
export async function getSessionProvider(): Promise<string | null> {
  const token = await getSessionToken();
  if (!token) return null;
  return (token.provider as string) ?? null;
}
```

**鉴权方案**：

App Router 的 layout 无法直接获取当前 URL pathname。采用分层方案：

1. **未登录跳转**：在 `proxy.ts` 中处理，可保留完整目标 URL
2. **Google OAuth 提示**：在 layout 中处理（需要 proxy 对 `/messages*` 特殊放行）

**Step 1：新增 `isMessagesRoute()` 函数**

站内信路由需要特殊处理（Google OAuth 用户放行到 layout），不能混入通用的 `isForumAuthRoute()`：

```ts
// apps/web/src/proxy.ts - 新增函数
/** Routes that need credentials but allow Google OAuth to reach layout for notice */
export function isMessagesRoute(pathname: string): boolean {
  return pathname === "/messages" || pathname.startsWith("/messages/");
}
```

**Step 2：修改 `resolveProxyAction()` 完整逻辑**

保持 `/threads/new` 原有逻辑不变，单独处理 `/messages*`：

```ts
// apps/web/src/proxy.ts - 完整修改

// 1. 修改返回类型，支持动态 redirect 路径
export function resolveProxyAction(
  nextUrl: URL,  // 改为传入完整 URL 对象
  isLoggedIn: boolean,
  email?: string | null,
  provider?: string | null,
  requireLogin = false,
): string {
  const pathname = nextUrl.pathname;

  // Always-public routes (login, register, api/auth) are never blocked
  if (isAlwaysPublicRoute(pathname)) {
    // Authenticated admin on admin login page -> redirect to admin dashboard
    if (pathname === "/admin/login" && isLoggedIn && isAdmin(email)) return "redirect:/admin";

    // Credentials users already have a forum session — redirect away from auth pages
    if (
      (pathname === "/login" || pathname === "/register") &&
      isLoggedIn &&
      provider === "credentials"
    ) {
      return "redirect:/";
    }

    return "next";
  }

  // If require_login is enabled, all forum content requires authentication
  if (requireLogin && isPublicRoute(pathname) && !isLoggedIn) {
    return "redirect:/login";
  }

  if (isPublicRoute(pathname)) {
    return "next";
  }

  // Messages routes: special handling - Google OAuth users reach layout for notice
  if (isMessagesRoute(pathname)) {
    if (!isLoggedIn) {
      // 未登录 → 跳转登录，带完整目标 URL
      const target = pathname + nextUrl.search;
      return `redirect:/login?redirect=${encodeURIComponent(target)}`;
    }
    // Google OAuth 用户放行到 layout，由 layout 显示 CredentialsOnlyNotice
    // Credentials 用户正常放行
    return "next";
  }

  // Forum auth routes (e.g., /threads/new): require credentials provider
  // Google OAuth users have no Worker JWT, cannot use these features
  if (isForumAuthRoute(pathname)) {
    if (!isLoggedIn || provider !== "credentials") return "redirect:/login";
    return "next";
  }

  // Admin page routes require admin whitelist check
  if (isAdminRoute(pathname)) {
    if (!isLoggedIn) return "redirect:/admin/login";
    if (!isAdmin(email)) return "redirect:/admin/login";
    return "next";
  }

  // Other non-public routes: require login
  if (!isLoggedIn) return "redirect:/login";

  return "next";
}
```

**注意**：`isForumAuthRoute()` 保持原样（只包含 `/threads/new`），不添加 `/messages*`。站内信由新增的 `isMessagesRoute()` 单独处理。

**Step 3：修改 `proxy()` 函数的调用点**

```ts
// apps/web/src/proxy.ts - proxy() 函数修改

export async function proxy(request: NextRequest) {
  const requireLogin = await getRequireLogin();

  const authHandler = await auth((req) => {
    const session = req.auth;
    const provider = session?.user ? (session.user as { provider?: string }).provider : undefined;
    
    // 改为传入完整 nextUrl 对象
    const action = resolveProxyAction(
      req.nextUrl,  // 原来是 req.nextUrl.pathname
      !!session,
      session?.user?.email,
      provider,
      requireLogin,
    );

    if (action === "next") return NextResponse.next();
    const target = action.replace("redirect:", "");
    return NextResponse.redirect(buildRedirectUrl(req, target));
  });

  return authHandler(request, {} as never);
}
```

**Step 4：Layout 处理 Google OAuth 用户**

```tsx
// apps/web/src/app/(forum)/messages/layout.tsx
import { getSessionProvider } from "@/lib/forum-auth";
import { CredentialsOnlyNotice } from "@/components/forum/credentials-only-notice";
import type { ReactNode } from "react";

export default async function MessagesLayout({ children }: { children: ReactNode }) {
  const provider = await getSessionProvider();
  
  // 未登录用户已被 proxy.ts 拦截跳转，这里 provider 必不为 null
  // 但为安全起见仍做检查（理论上不会到达）
  if (!provider) {
    return null;
  }
  
  // Google OAuth 用户 → 显示提示
  if (provider !== "credentials") {
    return <CredentialsOnlyNotice feature="站内信" />;
  }
  
  // Credentials 用户 → 渲染子页面
  return <>{children}</>;
}
```

这样：
- `/threads/new`：保持原逻辑，Google OAuth 用户被 proxy 拦截跳转到 `/login`
- `/messages*`：Google OAuth 用户放行到 layout，显示 `CredentialsOnlyNotice`

### 6.3 改造现有页面

**`apps/web/src/app/(forum)/messages/layout.tsx`**（新建）：

- 统一鉴权守卫（见 §6.2）

**`apps/web/src/app/(forum)/messages/page.tsx`**：

- 改为动态数据获取（移除 mock 数据）
- metadata title 改为"站内信"
- 无需单独做鉴权（layout 已处理）

**`apps/web/src/components/forum/messages-page.tsx`**：

- 现有导出 `MessagesPage` 改名为 `MessagesPageClient`（供 page.tsx 导入）
- 侧边栏精简为：收信箱、发信箱
- 移除"我的帖子""坛友互动"等无关项
- 标题改为"站内信"
- 添加"写站内信"按钮（触发弹窗）
- 检测 `?to=123` 参数，自动打开写信弹窗

### 6.4 新增组件

| 文件 | 说明 |
|------|------|
| `messages/layout.tsx` | 鉴权守卫 layout |
| `messages/[id]/page.tsx` | 站内信详情页（无需单独鉴权） |
| `compose-message-dialog.tsx` | 写站内信弹窗（含用户名自动补全） |
| `credentials-only-notice.tsx` | "请使用论坛账号登录"提示组件 |

### 6.5 UI 布局

#### 收/发信箱

```
┌─────────────────────────────────────────────────────────┐
│  首页 > 站内信                                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐  ┌─────────────────────────────────────┐ │
│  │ 站内信    │  │ 收信箱 | 发信箱     [写站内信]      │ │
│  │          │  ├─────────────────────────────────────┤ │
│  │ 📧 收信箱 │  │ 💡 您有 2 条未读站内信                │ │
│  │ 📤 发信箱 │  ├─────────────────────────────────────┤ │
│  │          │  │ ☐ [头像] alice 发来:               │ │
│  └──────────┘  │      关于您的帖子                    │ │
│                │      您好，想请教一下...              │ │
│                │      2024-04-04 10:30     共1条     │ │
│                ├─────────────────────────────────────┤ │
│                │ ☐ [头像] bob 发来:                  │ │
│                │      (无主题)                        │ │
│                │      谢谢分享，非常有帮助...          │ │
│                │      2024-04-03 15:20     共1条     │ │
│                └─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

#### 写站内信弹窗

```
┌─────────────────────────────────────────────────────────┐
│  写站内信                                           [×] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  收信人: [用户名输入 ▼]  ← 输入时显示自动补全下拉         │
│          alice ✓                                        │
│                                                         │
│  主题:   [可选主题输入框]                               │
│                                                         │
│  内容:                                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  │  (文本输入区)                                    │   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│                            [取消]  [发送]               │
└─────────────────────────────────────────────────────────┘
```

**用户名自动补全**：
- 输入 >= 2 字符时触发搜索
- 调用 `/api/v1/users/search?q=xxx`
- 显示匹配的用户列表供选择
- 选择后记录 `receiverId`

### 6.6 Header 未读提示

在 `forum-header.tsx` 的站内信图标上显示未读角标：

```tsx
<Link href="/messages" title="站内信">
  <div className="relative">
    <Mail className="h-4 w-4" />
    {unreadCount > 0 && (
      <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-2xs flex items-center justify-center">
        {unreadCount > 99 ? "99+" : unreadCount}
      </span>
    )}
  </div>
</Link>
```

**注意**：未读数仅对 credentials 用户显示，Google OAuth 用户不调用 unread-count API。

---

## 7. 实现步骤

按依赖顺序，每步一个原子化 commit：

| Step | 任务 | 关键文件 |
|------|------|---------|
| 1 | DB schema 更新 | `packages/db/src/schema.ts` |
| 2 | 发帖权限检查函数抽取 | `apps/worker/src/lib/postingPermission.ts` |
| 3 | Worker 用户搜索 handler | `apps/worker/src/handlers/user.ts` |
| 4 | Worker message handlers | `apps/worker/src/handlers/message.ts` |
| 5 | Worker 路由注册 | `apps/worker/src/index.ts` |
| 6 | Proxy 增加 `/messages*` 路由守卫 | `apps/web/src/proxy.ts`（新增 `isMessagesRoute()` + `resolveProxyAction` 改传 `nextUrl`） |
| 7 | 新增 `getSessionProvider()` 函数 | `apps/web/src/lib/forum-auth.ts` |
| 8 | Next.js proxy routes | `apps/web/src/app/api/v1/messages/`, `users/search/` |
| 9 | ViewModel 改造 | `apps/web/src/viewmodels/forum/messages.ts` |
| 10 | CredentialsOnlyNotice 组件 | `apps/web/src/components/forum/credentials-only-notice.tsx` |
| 11 | Messages layout（Google OAuth 提示） | `apps/web/src/app/(forum)/messages/layout.tsx` |
| 12 | 写站内信弹窗 | `compose-message-dialog.tsx` |
| 13 | 消息列表页改造 | `messages-page.tsx`（导出改名为 `MessagesPageClient`）、`messages/page.tsx` |
| 14 | 消息详情页 | `messages/[id]/page.tsx` |
| 15 | Header 未读角标 | `forum-header.tsx` |
| 16 | 术语统一 & 清理 | 各处"消息"改为"站内信" |

```
Step 1 → Step 2 → Step 3 → Step 4 → Step 5 ─┐
                                              ├→ Step 6 → Step 7 → Step 8 → Step 9 → Step 10 → Step 11 → Step 12 → Step 13 → Step 14 → Step 15 → Step 16
```

---

## 8. 验证清单

- [ ] D1 migration 成功：messages 表 + 索引创建
- [ ] 用户搜索：`/api/v1/users/search?q=ali` 返回匹配用户
- [ ] 发送站内信：正常用户可以发送
- [ ] 发送权限：封禁用户无法发送（403）
- [ ] 发送权限：新用户限制生效（注册天数、头像）
- [ ] 发送验证：不能发给自己（400）
- [ ] 发送验证：收信人不存在（400）
- [ ] 敏感词过滤：包含禁词的内容被过滤或拒绝
- [ ] 收信箱列表：只显示自己收到的、未删除的
- [ ] 发信箱列表：只显示自己发送的、未删除的
- [ ] 消息详情：只能查看自己参与的消息
- [ ] 自动已读：收信人打开详情后 is_read 变为 1
- [ ] 删除消息：发送者删除后自己看不到，接收者仍可见
- [ ] 未读数量：正确统计 receiver_id=me AND is_read=0 AND receiver_deleted=0
- [ ] Header 角标：credentials 用户有未读数时显示红点
- [ ] Google OAuth 用户：访问 /messages 显示提示，不调用消息 API
- [ ] 现有入口兼容：`/messages?to=123` 正确打开写信弹窗
- [ ] 术语检查：全站"站内信"命名统一
- [ ] `bun run typecheck` 通过
- [ ] `bun run test` 无回归

---

## 9. 后续工作

| 功能 | 说明 |
|------|------|
| 系统通知 | 回复提醒、@提及、管理通知等走单独的 notifications 表 |
| 批量操作 | 批量删除、批量标记已读 |
| 搜索 | 按发送人、内容搜索站内信 |
| 黑名单 | 屏蔽特定用户的消息 |
