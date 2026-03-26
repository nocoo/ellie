# 04c — Worker API 设计

> Cloudflare Worker 作为 API 中间层，前端不直接访问 D1。
>
> **前置依赖**：04a（类型定义和 Repository 接口）、04b（前端架构和认证路径）

## 概述

Ellie Worker 是基于 Cloudflare Workers 的边缘 API 层，作为前端与 D1 数据库之间的中间件。所有数据库操作都通过 Worker 进行，确保：
- 统一的认证和授权
- 边缘计算的低延迟
- D1 数据库的安全隔离
- API 限流和防护

**核心原则**：
1. **共享包优先**：Worker 组合 `@ellie/types`、`@ellie/repositories`，不重复定义类型
2. **Contract 对齐**：API 返回体严格遵循 04a 定义的 `PaginatedResult`、cursor 编码
3. **权限分层**：区分 `/api/v1/moderation`（Mod可用）和 `/api/admin/*`（仅后台）
4. **密码兼容**：支持 Discuz 旧密码验证，登录成功后静默升级为 PBKDF2-SHA256

## 架构

```
┌─────────────┐     fetch()     ┌──────────────┐     D1 bind     ┌─────────┐
│  Next.js    │ ───────────────▶│   Worker     │ ──────────────▶│   D1    │
│  (apps/web) │◀─────────────── │  (worker/)   │◀────────────── │ Database │
└─────────────┘    JSON         └──────────────┘    SQLite      └─────────┘
                                      │
                                      ▼
                               ┌─────────────┐
                               │ Middleware   │
                               │ - Auth        │
                               │ - Rate Limit  │
                               │ - CORS        │
                               │ - Error Log   │
                               └─────────────┘
```

### 与共享包的关系

```
packages/
├── types/           # 共享类型（User, Forum, Thread, Post, PaginatedResult）
├── repositories/    # 共享 Repository 接口 + D1 实现
└── db/              # D1 客户端封装（本地开发用）

apps/worker/
├── src/
│   ├── index.ts         # Worker 入口，路由分发
│   ├── handlers/        # API 路由处理器（组合 @ellie/repositories）
│   ├── middleware/      # 认证/限流/CORS
│   └── lib/
│       ├── env.ts       # Env 类型定义
│       └── password.ts  # Discuz 密码验证 + PBKDF2 升级
└── wrangler.toml
```

**设计决策**：Worker **不**重新定义 types/，直接使用 `@ellie/types` 导出的 `PaginatedResult<T>`、`User`、`Forum` 等。Handler 层负责将 D1 结果转换为 04a 定义的格式。

---

## 技术栈

| 层 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 运行时 | Cloudflare Workers | latest | 边缘计算，全球分布式 |
| 数据库 | Cloudflare D1 | - | SQLite 兼容，通过 env.DB 绑定 |
| 部署 | wrangler | ^3.114 | `wrangler dev` / `wrangler deploy` |
| 类型 | @cloudflare/workers-types | ^4.202 | TypeScript 类型定义 |
| 路由 | 手动路由 | - | 轻量级，无额外依赖 |
| 密码 | Web Crypto API | - | PBKDF2-SHA256（Workers 原生） |

---

## 项目结构

```
apps/worker/
├── src/
│   ├── index.ts              # Worker 入口，路由分发
│   ├── lib/
│   │   ├── env.ts            # Env 类型定义（JWT_SECRET, DB, KV, RATE_LIMITER）
│   │   └── password.ts       # 密码工具：verifyDiscuzPassword, hashPassword, verifyPassword
│   ├── middleware/
│   │   ├── cors.ts           # CORS 处理
│   │   ├── auth.ts           # JWT 认证中间件
│   │   ├── rate-limit.ts     # 速率限制（Durable Object）
│   │   └── error.ts          # 错误处理
│   └── handlers/
│       ├── forum.ts          # 版块相关 API
│       ├── thread.ts         # 主题相关 API
│       ├── post.ts           # 帖子相关 API
│       ├── user.ts           # 用户相关 API
│       ├── auth.ts           # 认证 API（登录/注册）
│       ├── moderation.ts     # 版主操作 API（role ∈ {1,2,3}）
│       └── admin.ts          # 管理 API（role ∈ {1,2}）
├── tests/
│   ├── unit/                 # L1 单元测试
│   │   ├── lib/
│   │   ├── middleware/
│   │   └── handlers/
│   └── integration/          # L2 集成测试
│       └── api.test.ts
├── worker/                   # Durable Object（限流用）
│   └── rate-limiter.ts
├── wrangler.toml             # Wrangler 配置
├── package.json              # 依赖：@ellie/types, @ellie/repositories
└── tsconfig.json             # references to @ellie/types, @ellie/repositories
```

---

## API 设计

### 通用响应格式

**成功响应：**
```json
{
  "data": { /* 业务数据 */ },
  "meta": {
    "timestamp": 1234567890,
    "requestId": "uuid"
  }
}
```

**错误响应：**
```json
{
  "error": {
    "code": "FORUM_NOT_FOUND",
    "message": "Forum not found",
    "details": { }
  }
}
```

### 分页格式（严格对齐 04a）

Worker 返回的分页结果**必须**使用 04a 定义的 `PaginatedResult<T>` 格式：

```typescript
import type { PaginatedResult } from "@ellie/types";

// Handler 返回体
interface ThreadListResponse {
  data: PaginatedResult<Thread>;
  meta: { timestamp: number; requestId: string };
}
```

**Cursor 编码**：使用 04a 定义的 opaque cursor（严格遵循索引排序）：
- `latest` 排序 → `base64(JSON({ sticky, lastPostAt, id }))`  ← 注意含 sticky
- `newest` 排序 → `base64(JSON({ createdAt, id }))`
- `hot` 排序 → `base64(JSON({ replies, id }))`

**SQL 实现**（严格遵循 02 §分页策略，使用 idx_threads_forum 索引）：

```typescript
// Cursor 解析
const cursor = params.cursor ? decodeCursor(params.cursor) : null;

// Thread listing: keyset 分页（而非 OFFSET）
// latest 排序的 cursor: base64(JSON({ sticky, lastPostAt, id }))
// 索引: idx_threads_forum(forum_id, sticky DESC, last_post_at DESC)
const sql = cursor
  ? `WHERE forum_id = ? AND (sticky < ? OR (sticky = ? AND (last_post_at < ? OR (last_post_at = ? AND id < ?))))
     ORDER BY sticky DESC, last_post_at DESC, id DESC LIMIT 20`
  : `WHERE forum_id = ? ORDER BY sticky DESC, last_post_at DESC, id DESC LIMIT 20`;

// 参数绑定
const params = cursor
  ? [forumId, cursor.sticky, cursor.sticky, cursor.lastPostAt, cursor.lastPostAt, cursor.id]
  : [forumId];
```

**Post 分页（基于 position）：**

```typescript
// position cursor: base64(JSON({ position }))
const sql = cursor
  ? `WHERE thread_id = ? AND position > ? ORDER BY position LIMIT 20`
  : `WHERE thread_id = ? ORDER BY position LIMIT 20`;

const params = cursor
  ? [threadId, cursor.position]
  : [threadId];
```

### 错误码定义

| 错误码 | HTTP 状态 | 说明 |
|--------|----------|------|
| `INVALID_REQUEST` | 400 | 请求参数无效 |
| `UNAUTHORIZED` | 401 | 未认证 |
| `FORBIDDEN` | 403 | 无权限 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `INTERNAL_ERROR` | 500 | 服务器错误 |

---

## API 端点

### 基础设施端点

#### Health Check（健康检查）

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | /api/live | 系统健康检查 | 无 |

**设计规范**（来源：Memory 知识库 `label_规范`）：
- 不被登录保护，不被缓存（`Cache-Control: no-store`）
- 探测 D1 连通性（`SELECT 1 AS probe`），轻量快速
- 错误响应中不包含 "ok"（防止 keyword monitor 误判）
- UT 覆盖率 100%

**正常响应（200）：**
```json
{
  "status": "ok",
  "environment": "production",
  "timestamp": 1711540800000,
  "checks": { "d1": "connected" }
}
```

**异常响应（503）：**
```json
{
  "status": "error",
  "environment": "production",
  "timestamp": 1711540800000,
  "checks": { "d1": "unreachable: <error message>" }
}
```

---

### 公开 API（无需认证）

#### Forum（版块）

| 方法 | 路径 | 说明 | 查询 |
|------|------|------|------|
| GET | /api/v1/forums | 获取所有版块列表 | - |
| GET | /api/v1/forums/:id | 获取单个版块详情 | - |

**响应示例：**

> **注意**：论坛列表只有 213 条记录，全量返回，**不使用 PaginatedResult**。

```json
{
  "data": [
    {
      "id": 1,
      "parentId": 0,
      "name": "校园交流",
      "description": "...",
      "icon": "...",
      "displayOrder": 1,
      "threads": 1234,
      "posts": 5678,
      "type": "forum",
      "status": 1,
      "lastThreadId": 456,
      "lastPostAt": 1234567890,
      "lastPoster": "username"
    }
  ]
}
```

#### Thread（主题）

| 方法 | 路径 | 说明 | 查询参数 |
|------|------|------|---------|
| GET | /api/v1/threads | 获取主题列表 | `forumId`, `limit`, `cursor`, `sort` |
| GET | /api/v1/threads/:id | 获取单个主题详情 | - |

**查询参数：**
- `forumId`: number - 版块 ID
- `limit`: number - 每页数量（默认 20，最大 50）
- `cursor`: string - 分页游标（04a opaque cursor）
- `sort`: "latest" \| "newest" \| "hot" - 排序方式

**响应格式（PaginatedResult）：**
```json
{
  "data": {
    "items": [/* Thread[] */],
    "nextCursor": "eyJhYmMiOjEyM30=...",
    "prevCursor": null,
    "total": 1234
  }
}
```

#### Post（帖子）

| 方法 | 路径 | 说明 | 查询参数 |
|------|------|------|---------|
| GET | /api/v1/posts | 获取帖子列表 | `threadId`, `limit`, `cursor` |
| GET | /api/v1/posts/:id | 获取单个帖子详情 | - |

**查询参数：**
- `threadId`: number - 帖子 ID（必需）
- `limit`: number - 每页数量（默认 20，最大 50）
- `cursor`: string - 分页游标（04a opaque cursor，基于 position）

#### User（用户）

| 方法 | 路径 | 说明 | 查询参数 |
|------|------|------|---------|
| GET | /api/v1/users/:id | 获取用户公开信息 | - |

---

### 认证 API

#### Auth（认证）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | /api/v1/auth/login | 用户登录 | `{ username, password }` |
| POST | /api/v1/auth/register | 用户注册 | `{ username, email, password }` |
| POST | /api/v1/auth/refresh | 刷新 Token | `{ refreshToken }` |
| POST | /api/v1/auth/logout | 登出 | - |

**密码验证流程（Discuz 兼容 + PBKDF2-SHA256 升级）：**

```
1. 客户端发送 username + password（明文，HTTPS）
2. Worker 查询 D1 获取 user.password_hash + user.password_salt
3. 验证旧密码：md5(md5(password) + salt) === password_hash
   - 使用纯 JS MD5 实现（crypto-js 或 spark-md5）
4. 验证成功后：
   a. 生成 JWT access token（7天有效期）
   b. 生成 refresh token（随机字符串，存 KV，30天）
   c. 静默升级：PBKDF2-SHA256(password) → 更新 D1
   d. 清除 password_salt
5. 返回 { token, refreshToken, user }
```

**登录响应：**
```json
{
  "data": {
    "token": "jwt_access_token",
    "refreshToken": "kv_stored_refresh_token",
    "user": {
      "id": 1,
      "username": "admin",
      "role": 1
    }
  }
}
```

**密码工具实现（lib/password.ts）：**

```typescript
import { MD5 } from "crypto-js"; // 或使用 spark-md5

// 验证 Discuz 旧密码（使用纯 JS MD5 实现）
export async function verifyDiscuzPassword(
  input: string,
  storedHash: string,
  salt: string,
): Promise<boolean> {
  // Discuz: md5(md5(password) + salt)
  // 注意：是普通 MD5，不是 HMAC-MD5
  const firstMd5 = MD5(input).toString();
  const doubleMd5 = MD5(firstMd5).toString();
  const finalHash = MD5(doubleMd5 + salt).toString();
  return finalHash === storedHash;
}

// PBKDF2-SHA256 哈希（升级目标格式）
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  // 生成随机 salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 派生 256-bit key
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  // 存储格式：base64(salt + hash) = base64(salt) + "." + base64(hash)
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derivedBits)));

  return `${saltB64}.${hashB64}`;
}

// 验证新密码格式
export async function verifyPassword(
  input: string,
  storedHash: string,
): Promise<boolean> {
  const [saltB64, hashB64] = storedHash.split(".");
  const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
  const expectedHash = Uint8Array.from(atob(hashB64), c => c.charCodeAt(0));

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(input),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );

  const derivedArray = new Uint8Array(derivedBits);

  // 常量时间比较
  if (derivedArray.length !== expectedHash.length) return false;
  let match = 0;
  for (let i = 0; i < derivedArray.length; i++) {
    match |= derivedArray[i] ^ expectedHash[i];
  }
  return match === 0;
}
```

**登录 Handler 实现：**

```typescript
export async function login(request: Request, env: Env): Promise<Response> {
  const { username, password } = await request.json() as LoginInput;

  // 查询用户
  const user = await env.DB.prepare(
    "SELECT id, username, password_hash, password_salt, role, status FROM users WHERE username = ?"
  ).bind(username).first();

  if (!user) {
    return errorResponse("INVALID_CREDENTIALS", 401);
  }

  if (user.status !== 0) {
    return errorResponse("USER_BANNED", 403);
  }

  // 验证密码（兼容旧格式）
  let isValid = false;
  if (user.password_salt) {
    // 旧密码：md5(md5(password) + salt)
    isValid = await verifyDiscuzPassword(password, user.password_hash, user.password_salt);
  } else {
    // 新密码：PBKDF2-SHA256
    isValid = await verifyPassword(password, user.password_hash);
  }

  if (!isValid) {
    return errorResponse("INVALID_CREDENTIALS", 401);
  }

  // 生成 token
  const token = await createJwt({ userId: user.id, role: user.role }, env.JWT_SECRET);
  const refreshToken = crypto.randomUUID();

  // 存储 refresh token（KV，30天）
  await env.KV.put(`refresh:${refreshToken}`, String(user.id), {
    expirationTtl: 30 * 24 * 60 * 60,
  });

  // 静默升级密码（如果是旧格式）
  if (user.password_salt) {
    const newHash = await hashPassword(password);
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, password_salt = '' WHERE id = ?"
    ).bind(newHash, user.id).run();
  }

  // 更新最后登录时间
  await env.DB.prepare(
    "UPDATE users SET last_login = ? WHERE id = ?"
  ).bind(Math.floor(Date.now() / 1000), user.id).run();

  return jsonResponse({
    token,
    refreshToken,
    user: { id: user.id, username: user.username, role: user.role },
  });
}
```

---

### 受保护的 API（需要 JWT）

#### Thread（主题）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | /api/v1/threads | 创建主题 | `{ forumId, subject, content }` |

#### Post（帖子）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | /api/v1/posts | 发布回复 | `{ threadId, content }` |

---

### 版主操作 API（role ∈ {1, 2, 3}）

**重要**：`/api/v1/moderation/*` 是给前端版主操作使用的，与 `/api/admin/*` 分离：
- Admin (1) / SuperMod (2)：可访问管理后台 + 论坛前端版主操作
- Mod (3)：仅论坛前端版主操作，**不能**进入管理后台

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| PATCH | /api/v1/moderation/threads/:id/sticky | 设置置顶 | `{ level: "none" \| "forum" \| "global" }` |
| PATCH | /api/v1/moderation/threads/:id/digest | 设置精华 | `{ level: 0 \| 1 \| 2 \| 3 }` |
| PATCH | /api/v1/moderation/threads/:id/close | 锁定/解锁主题 | `{ closed: boolean }` |
| PATCH | /api/v1/moderation/threads/:id/move | 移动主题 | `{ targetForumId: number }` |
| DELETE | /api/v1/moderation/posts/:id | 删除帖子 | - |

**权限检查（middleware/auth.ts）：**

```typescript
export async function moderationMiddleware(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser } | Response> {
  const authResult = await authMiddleware(request, env);
  if (authResult instanceof Response) return authResult;

  const { user } = authResult;
  // Mod (3), SuperMod (2), Admin (1) 都可以进行版主操作
  if (user.role === 0) {
    return errorResponse("FORBIDDEN", 403);
  }

  return { user };
}
```

---

### 管理 API（role ∈ {1, 2}）

**重要**：`/api/admin/*` 仅限 Admin (1) 和 SuperMod (2) 访问，Mod (3) **不能**访问。

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| GET | /api/admin/users | 用户列表（分页、筛选） | `search`, `role`, `status`, `cursor` |
| PATCH | /api/admin/users/:id/status | 设置用户状态 | `{ status: -1 \| 0 }` |
| PATCH | /api/admin/users/:id/role | 设置用户角色 | `{ role: 0 \| 1 \| 2 \| 3 }` |
| DELETE | /api/admin/users/:id | 删除用户 | - |
| PATCH | /api/admin/forums/:id | 更新版块 | `{ name?, description?, status?, displayOrder? }` |
| DELETE | /api/admin/forums/:id | 删除版块 | - |

**权限检查：**

```typescript
export async function adminMiddleware(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser } | Response> {
  const authResult = await authMiddleware(request, env);
  if (authResult instanceof Response) return authResult;

  const { user } = authResult;
  // 仅 Admin (1) 和 SuperMod (2) 可访问管理后台
  if (user.role !== 1 && user.role !== 2) {
    return errorResponse("FORBIDDEN_ADMIN_ONLY", 403);
  }

  return { user };
}
```

---

## 中间件设计

### CORS

```typescript
// middleware/cors.ts
const ALLOWED_ORIGINS = [
  "https://ellie.nocoo.cloud",
  "http://localhost:3000",
];

export function corsHeaders(origin?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}
```

### JWT 认证

```typescript
// middleware/auth.ts
interface JwtPayload {
  userId: number;
  role: number;
  exp: number;
}

// JWT_SECRET 通过 wrangler secret put 管理（不写入版本控制）
export async function authMiddleware(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser } | Response> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return errorResponse("UNAUTHORIZED", 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = verifyJwt(token, env.JWT_SECRET) as JwtPayload;

    // 检查过期
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return errorResponse("TOKEN_EXPIRED", 401);
    }

    return { user: { userId: payload.userId, role: payload.role } };
  } catch {
    return errorResponse("INVALID_TOKEN", 401);
  }
}
```

### 速率限制（Durable Object）

**问题**：KV 是最终一致的，`get → parse → put` 模式在高并发下会漏限流。

**解决方案**：使用 Durable Object 实现强一致性的计数器。

```typescript
// worker/rate-limiter.ts
export class RateLimiter extends DurableObject {
  private state: DurableObjectState;
  private counts: Map<string, { count: number; resetTime: number }>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.counts = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    const limit = Number(url.searchParams.get("limit") || "100");
    const window = Number(url.searchParams.get("window") || "600"); // 10分钟

    const now = Date.now();
    const entry = this.counts.get(key);

    if (!entry || now > entry.resetTime) {
      // 新窗口
      this.counts.set(key, { count: 1, resetTime: now + window * 1000 });
      return Response.json({ allowed: true, remaining: limit - 1 });
    }

    if (entry.count >= limit) {
      return Response.json({ allowed: false, retryAfter: entry.resetTime - now });
    }

    entry.count++;
    return Response.json({ allowed: true, remaining: limit - entry.count });
  }
}
```

```typescript
// middleware/rate-limit.ts
export async function rateLimitMiddleware(
  request: Request,
  env: Env,
): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  // Durable Object 正确调用方式：先获取 stub，再 fetch
  const id = env.RATE_LIMITER.idFromName(ip);
  const stub = env.RATE_LIMITER.get(id);
  const response = await stub.fetch(
    `https://rate-limiter/?key=${ip}&limit=100&window=600`
  );

  const result = await response.json();
  return result.allowed;
}
```

**wrangler.toml 配置：**

```toml
# Durable Object 定义
[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiter"

# Env 类型定义（lib/env.ts）
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
  RATE_LIMITER: DurableObjectNamespace; // 注意是 Namespace，不是 DO 实例
}
```

---

## 六维质量体系实施

### L1 单元测试

**目标：** 分层覆盖率 ≥ 95%

| 模块 | 测试内容 | 工具 |
|------|---------|------|
| `lib/password.ts` | Discuz 密码验证、PBKDF2 哈希 | bun test |
| `middleware/auth.ts` | JWT 验证逻辑、权限检查 | bun test |
| `middleware/rate-limit.ts` | 速率限制逻辑（mock DO） | bun test |
| `handlers/*` | 各 handler 函数 | bun test + mock D1 |

**示例：**
```typescript
// tests/unit/lib/password.test.ts
import { describe, it, expect } from "bun:test";
import { verifyDiscuzPassword, hashPassword, verifyPassword } from "../../src/lib/password";

describe("verifyDiscuzPassword", () => {
  it("should verify old Discuz password format", async () => {
    // md5(md5("password123") + "abcdef")
    const hash = "expected_hash";
    const salt = "abcdef";
    const result = await verifyDiscuzPassword("password123", hash, salt);
    expect(result).toBe(true);
  });

  it("should reject wrong password", async () => {
    const result = await verifyDiscuzPassword("wrong", hash, salt);
    expect(result).toBe(false);
  });
});

describe("hashPassword", () => {
  it("should create PBKDF2 hash that verifies correctly", async () => {
    const hash = await hashPassword("password123");
    const isValid = await verifyPassword("password123", hash);
    expect(isValid).toBe(true);
  });
});
```

### L2 集成测试

**目标：** 100% API 端点覆盖

| 测试内容 | 工具 |
|---------|------|
| API 端点测试 | bun test + Miniflare |
| 真实 D1 交互 | Miniflare D1 模拟 |
| Durable Object 模拟 | Miniflare DO 模拟 |

### L3 端到端测试

**目标：** 关键路径覆盖

| 测试场景 | 工具 |
|---------|------|
| 用户登录 → 发帖 → 回帖 | Playwright |
| 管理员 → 封禁用户 | Playwright |
| 版主 → 置顶主题 | Playwright |
| 速率限制触发 | Playwright |

### G1 静态分析

**目标：** 0 error, 0 warning

```bash
# biome.json
{
  "linter": {
    "recommended": true,
    "rules": {
      "style": {
        "noNonNullAssertion": "error",
        "noImplicitAnyLet": "error",
      }
    }
  }
}
```

### G2 安全扫描

| 扫描类型 | 工具 | 配置 |
|---------|------|------|
| 依赖漏洞 | osv-scanner | `pnpm audit` |
| 密钥泄露 | gitleaks | `.gitleaksignore` |
| 类型安全 | TypeScript strict | `tsconfig.json` |

### D1 测试隔离

```toml
# wrangler.toml (testing)
[[d1_databases]]
binding = "DB"
database_name = "ellie-db-test"
database_id = "<TEST_DB_ID>"
```

---

## 原子化提交计划

### Phase 1: 基础设施

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 1 | `feat(worker): init cloudflare worker project` | 初始化项目结构、配置 wrangler.toml、tsconfig.json | — |
| 2 | `feat(worker): add cors middleware` | CORS 处理中间件 | **G1 生效** |
| 3 | `feat(worker): add error handling middleware` | 统一错误处理、错误码定义 | **G1 生效** |
| 4 | `test(worker): setup bun test and coverage` | 测试配置、coverage 配置 | **L1 管道生效** |
| 5 | `chore(worker): setup g2 security scanning` | osv-scanner + gitleaks 配置 | **G2 生效** |

### Phase 2: 密码系统（高危修复）

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 6 | `feat(worker): add discuz password verification` | `lib/password.ts` verifyDiscuzPassword | **L1: 100%** |
| 7 | `feat(worker): add pbkdf2 password hashing` | `lib/password.ts` hashPassword, verifyPassword | **L1: 100%** |
| 8 | `feat(worker): add jwt create/verify utilities` | HS256 JWT 签名、验证、过期检查 | **L1: 100%** |

### Phase 3: 公开 API

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 9 | `feat(worker): add forums API` | GET /api/v1/forums（全量，无分页）, 使用 @ellie/types | **L1: 100%** |
| 10 | `feat(worker): add threads API with keyset cursor` | GET /api/v1/threads, cursor 编码对齐 04a | **L1: 100%** |
| 11 | `feat(worker): add posts API with position cursor` | GET /api/v1/posts, 基于 position 的 keyset | **L1: 100%** |
| 12 | `feat(worker): add users API` | GET /api/v1/users/:id | **L1: 100%** |

### Phase 4: 认证系统

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 13 | `feat(worker): add login endpoint with password upgrade` | POST /api/v1/auth/login, 静默升级 PBKDF2 | **L1: 100%** |
| 14 | `feat(worker): add jwt auth middleware` | JWT 验证、payload 类型 | **L1: 100%** |
| 15 | `feat(worker): add refresh token flow` | POST /api/v1/auth/refresh, KV 存储 | **L1: 100%** |
| 16 | `feat(worker): add durable object rate limiter` | DO 实现，替换 KV 计数方案 | **L1: 100%** |

### Phase 5: 版主操作 API（高危修复）

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 17 | `feat(worker): add moderation middleware` | role ∈ {1,2,3} 权限检查 | **L1: 100%** |
| 18 | `feat(worker): add moderation endpoints` | PATCH /api/v1/moderation/threads/*, DELETE /posts/* | **L1+L2: 100%** |

### Phase 6: 受保护的 API

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 19 | `feat(worker): add create thread endpoint` | POST /api/v1/threads | **L1+L2: 100%** |
| 20 | `feat(worker): add create post endpoint` | POST /api/v1/posts | **L1+L2: 100%** |

### Phase 7: 管理 API

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 21 | `feat(worker): add admin middleware` | role ∈ {1,2} 权限检查 | **L1: 100%** |
| 22 | `feat(worker): add admin forum management` | PATCH /api/admin/forums/:id | **L1+L2: 100%** |
| 23 | `feat(worker): add admin user management` | PATCH /api/admin/users/:id/* | **L1+L2: 100%** |

### Phase 8: 优化和完善

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 24 | `test(worker): add integration tests with miniflare` | Miniflare 配置、L2 测试 | **L1+L2: 100%** |
| 25 | `test(worker): add e2e tests with playwright` | E2E 测试场景 | **L1+L2+L3: 覆盖** |
| 26 | `perf(worker): add request logging` | 请求日志、性能监控 | **L1+L2: 100%** |

---

## 部署配置

### 环境变量

```toml
# wrangler.toml
[vars]
ENVIRONMENT = "production"
ALLOWED_ORIGINS = "https://ellie.nocoo.cloud"
```

**JWT_SECRET 配置：**

```toml
# 使用 wrangler secret（不写入版本控制）
# wrangler secret put JWT_SECRET
```

### D1 绑定

```toml
[[d1_databases]]
binding = "DB"
database_name = "ellie-db"
database_id = "<D1_DATABASE_ID>"
```

### KV 绑定

```toml
[[kv_namespaces]]
binding = "KV"
id = "<KV_NAMESPACE_ID>"
```

### Durable Object 绑定

Durable Object 绑定配置已在 `middleware/rate-limit.ts` 部分定义，包含完整的 Env 类型说明。

### 自定义域名

```toml
# Custom domain (requires DNS in Cloudflare)
[[routes]]
pattern = "ellie.worker.hexly.ai/*"
```

- 域名绑定通过 Dashboard → Workers → project → Settings → Domains & Routes → Add → Custom Domain
- DNS 已在 Cloudflare 托管时秒级生效
- CORS 白名单已包含 `https://ellie.worker.hexly.ai`

---

## 本地开发

### 启动 Worker

```bash
cd apps/worker
wrangler dev

# Worker 运行在 http://localhost:8787
```

### 运行测试

```bash
# L1 单元测试
cd apps/worker
bun test

# L2 集成测试
bun test tests/integration/
```

### 查看日志

```bash
wrangler tail
```

---

## 安全考虑

1. **CORS 白名单**：只允许信任的域名访问
2. **JWT 签名验证**：使用 HS256 算法，secret 通过 `wrangler secret put` 管理
3. **速率限制**：使用 Durable Object 实现强一致性计数器
4. **SQL 注入防护**：使用参数化查询
5. **输入验证**：验证所有输入参数
6. **敏感数据脱敏**：用户密码、邮箱等敏感信息不返回
7. **密码升级**：Discuz 旧密码登录后自动升级为 PBKDF2-SHA256

---

## 监控和日志

### 结构化日志

```typescript
// services/log.ts
interface LogEntry {
  level: "info" | "warn" | "error";
  timestamp: number;
  requestId: string;
  path: string;
  method: string;
  status: number;
  duration?: number;
  error?: string;
}

export function logRequest(entry: LogEntry): void {
  console.log(JSON.stringify(entry));
}
```

---

## 开放问题澄清

### Q1: Worker 是否为唯一 auth source？

**回答**：是的，Phase 2 后 Worker 成为唯一认证源。

```
当前阶段（原型）:
  Browser → Next.js API Routes → NextAuth Credentials → Mock 用户
  Auth source: NextAuth（临时）

Phase 2（Worker 就绪后）:
  Browser → Next.js proxy → Worker API → D1 用户表
  Auth source: Worker（JWT + KV session）
  NextAuth 完全移除
```

### Q2: packages/repositories / packages/db 是否保留？

**回答**：是的，这些包是正式方向，Worker 组合它们。

```
apps/worker/
├── src/handlers/         # 组合 @ellie/repositories
└── package.json          # 依赖："@ellie/types": "workspace:*"

packages/
├── types/                # 共享类型
├── repositories/         # Repository 接口 + D1 实现
└── db/                   # D1 客户端（本地开发用）
```

Worker 不重新定义 types/，直接使用 `@ellie/types` 导出的 `PaginatedResult<T>`、`User`、`Forum` 等。
