# 04c — Worker API 设计

> Cloudflare Worker 作为 API 中间层，前端不直接访问 D1。

## 概述

Ellie Worker 是基于 Cloudflare Workers 的边缘 API 层，作为前端与 D1 数据库之间的中间件。所有数据库操作都通过 Worker 进行，确保：
- 统一的认证和授权
- 边缘计算的低延迟
- D1 数据库的安全隔离
- API 限流和防护

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

## 技术栈

| 层 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 运行时 | Cloudflare Workers | latest | 边缘计算，全球分布式 |
| 数据库 | Cloudflare D1 | - | SQLite 兼容，通过 env.DB 绑定 |
| 部署 | wrangler | ^3.114 | `wrangler dev` / `wrangler deploy` |
| 类型 | @cloudflare/workers-types | ^4.202 | TypeScript 类型定义 |
| 路由 | 手动路由 | - | 轻量级，无额外依赖 |

## 项目结构

```
apps/worker/
├── src/
│   ├── index.ts              # Worker 入口，路由分发
│   ├── lib/
│   │   └── env.ts            # Env 类型定义
│   ├── middleware/
│   │   ├── cors.ts           # CORS 处理
│   │   ├── auth.ts           # JWT 认证中间件
│   │   ├── rate-limit.ts     # 速率限制
│   │   └── error.ts          # 错误处理
│   ├── handlers/
│   │   ├── forum.ts          # 版块相关 API
│   │   ├── thread.ts         # 主题相关 API
│   │   ├── post.ts           # 帖子相关 API
│   │   ├── user.ts           # 用户相关 API
│   │   ├── auth.ts           # 认证 API（登录/注册）
│   │   └── admin.ts          # 管理 API
│   ├── services/
│   │   ├── d1.ts             # D1 查询封装
│   │   ├── cache.ts          # KV 缓存服务
│   │   └── log.ts            # 日志服务
│   └── types/
│       ├── api.ts            # API 类型定义
│       └── errors.ts         # 错误类型
├── tests/
│   ├── unit/                 # L1 单元测试
│   │   ├── services/
│   │   ├── middleware/
│   │   └── handlers/
│   └── integration/          # L2 集成测试
│       └── api.test.ts
├── wrangler.toml             # Wrangler 配置
├── package.json
└── tsconfig.json
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

### 公开 API（无需认证）

#### Forum（版块）

| 方法 | 路径 | 说明 | 查询 |
|------|------|------|------|
| GET | /api/v1/forums | 获取所有版块列表 | - |
| GET | /api/v1/forums/:id | 获取单个版块详情 | - |

**响应示例：**
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
- `cursor`: string - 分页游标
- `sort`: "latest" \| "newest" \| "hot" - 排序方式

#### Post（帖子）

| 方法 | 路径 | 说明 | 查询参数 |
|------|------|------|---------|
| GET | /api/v1/posts | 获取帖子列表 | `threadId`, `limit`, `cursor` |
| GET | /api/v1/posts/:id | 获取单个帖子详情 | - |

#### User（用户）

| 方法 | 路径 | 说明 | 查询参数 |
|------|------|------|---------|
| GET | /api/v1/users/:id | 获取用户公开信息 | - |

### 认证 API（需要 JWT）

#### Auth（认证）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | /api/v1/auth/login | 用户登录 | `{ username, password }` |
| POST | /api/v1/auth/register | 用户注册 | `{ username, email, password }` |
| POST | /api/v1/auth/refresh | 刷新 Token | `{ refreshToken }` |
| POST | /api/v1/auth/logout | 登出 | - |

**登录响应：**
```json
{
  "data": {
    "token": "jwt_token",
    "refreshToken": "refresh_token",
    "user": {
      "id": 1,
      "username": "admin",
      "role": 1
    }
  }
}
```

#### Thread（主题）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | /api/v1/threads | 创建主题 | `{ forumId, subject, content }` |

#### Post（帖子）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| POST | /api/v1/posts | 发布回复 | `{ threadId, content }` |

### 管理 API（需要 Admin 权限）

| 方法 | 路径 | 说明 | 请求体 |
|------|------|------|--------|
| PATCH | /api/admin/forums/:id | 更新版块 | `{ name?, description?, status? }` |
| DELETE | /api/admin/users/:id | 删除用户 | - |
| PATCH | /api/admin/threads/:id | 管理主题 | `{ sticky?, digest?, closed? }` |
| DELETE | /api/admin/posts/:id | 删除帖子 | - |

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

export async function authMiddleware(
  request: Request,
  env: Env,
): Promise<JwtPayload | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  // TODO: 验证 JWT 签名
  // 使用 Workers KV 存储 JWT secret
  const secret = env.JWT_SECRET;

  try {
    const payload = verifyJwt(token, secret) as JwtPayload;
    return payload;
  } catch {
    return null;
  }
}
```

### 速率限制

```typescript
// middleware/rate-limit.ts
export async function rateLimitMiddleware(
  request: Request,
  env: Env,
): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = `ratelimit:${ip}`;

  const limit = 100; // 每 10 分钟 100 次请求
  const window = 600; // 10 分钟

  const current = await env.KV.get(key);
  const count = current ? Number.parseInt(current) : 0;

  if (count >= limit) {
    return false;
  }

  await env.KV.put(key, String(count + 1), { expirationTtl: window });
  return true;
}
```

---

## 服务层设计

### D1 服务

```typescript
// services/d1.ts
export class D1Service {
  constructor(private db: D1Database) {}

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      const bindStmt = params.reduce(
        (stmt, param) => stmt.bind(param as string | number),
        stmt,
      );
      const result = await bindStmt.all();
      return result.results as T[];
    }
    const result = await stmt.all();
    return result.results as T[];
  }

  async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results[0] || null;
  }

  async exec(sql: string, params?: unknown[]): Promise<void> {
    const stmt = this.db.prepare(sql);
    if (params && params.length > 0) {
      const bindStmt = params.reduce(
        (stmt, param) => stmt.bind(param as string | number),
        stmt,
      );
      await bindStmt.run();
    } else {
      await stmt.run();
    }
  }
}
```

### 缓存服务

```typescript
// services/cache.ts
export class CacheService {
  constructor(private kv: KVNamespace) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this kv.get(key, "json");
    return value as T | null;
  }

  async set(key: string, value: unknown, ttl?: number): Promise<void> {
    await this.kv.put(key, JSON.stringify(value), {
      expirationTtl: ttl,
    });
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}
```

---

## 六维质量体系实施

### L1 单元测试

**目标：** 分层覆盖率 ≥ 95%

| 模块 | 测试内容 | 工具 |
|------|---------|------|
| `services/d1.ts` | D1 查询封装 | bun test |
| `middleware/auth.ts` | JWT 验证逻辑 | bun test |
| `middleware/rate-limit.ts` | 速率限制逻辑 | bun test |
| `handlers/*` | 各 handler 函数 | bun test + mock D1 |

**示例：**
```typescript
// tests/unit/services/d1.test.ts
import { describe, it, expect } from "bun:test";
import { D1Service } from "../../src/services/d1";

describe("D1Service", () => {
  it("should query forums successfully", async () => {
    const mockDb = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [] }),
        }),
      }),
    } as unknown as D1Database;

    const service = new D1Service(mockDb);
    const result = await service.query("SELECT * FROM forums");

    expect(result).toEqual([]);
  });
});
```

### L2 集成测试

**目标：** 100% API 端点覆盖

| 测试内容 | 工具 |
|---------|------|
| API 端点测试 | bun test + Miniflare |
| 真实 D1 交互 | Miniflare D1 模拟 |

**示例：**
```typescript
// tests/integration/api.test.ts
import { describe, it, expect } from "bun:test";
import { Worker } from "miniflare";

describe("API Integration", () => {
  it("GET /api/v1/forums returns forums", async () => {
    const worker = new Worker({
      modules: true,
      scriptPath: "./src/index.ts",
      d1Databases: ["DB"],
      d1Persist: false,
    });

    const res = await worker.fetch("http://localhost/api/v1/forums");
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.data).toBeArray();
  });
});
```

### L3 端到端测试

**目标：** 关键路径覆盖

| 测试场景 | 工具 |
|---------|------|
| 用户登录 → 发帖 → 回帖 | Playwright |
| 管理员 → 封禁用户 | Playwright |
| 速率限制触发 | Playwright |

### G1 静态分析

**目标：** 0 error, 0 warning

```bash
# .biomerc
{
  "linter": {
    "recommended": true,
    "rules": {
      "style": {
        "noNonNullAssertion": "warn",
        "noImplicitAnyLet": "warn",
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

### Phase 2: 公开 API

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 6 | `feat(worker): add d1 service layer` | D1 服务封装、类型定义 | **L1: 100%** |
| 7 | `feat(worker): add forums API` | GET /api/v1/forums, GET /api/v1/forums/:id | **L1+L1: 100%** |
| 8 | `feat(worker): add threads API` | GET /api/v1/threads, GET /api/v1/threads/:id | **L1+L1: 100%** |
| 9 | `feat(worker): add posts API` | GET /api/v1/posts, GET /api/v1/posts/:id | **L1+L1: 100%** |
| 10 | `feat(worker): add users API` | GET /api/v1/users/:id | **L1+L1: 100%** |

### Phase 3: 认证系统

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 11 | `feat(worker): add jwt auth middleware` | JWT 验证、payload 类型 | **L1: 100%** |
| 12 | `feat(worker): add auth endpoints` | POST /api/v1/auth/login, /register, /refresh | **L1+L2: 100%** |
| 13 | `feat(worker): add rate limiting middleware` | KV 速率限制 | **L1+L2: 100%** |
| 14 | `test(worker): add integration tests with miniflare` | Miniflare 配置、L2 测试 | **L1+L2+L1: 100%** |

### Phase 4: 受保护的 API

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 15 | `feat(worker): add create thread endpoint` | POST /api/v1/threads | **L1+L2: 100%** |
| 16 | `feat(worker): add create post endpoint` | POST /api/v1/posts | **L1+L2: 100%** |

### Phase 5: 管理 API

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 17 | `feat(worker): add admin forum update` | PATCH /api/admin/forums/:id | **L1+L2: 100%** |
| 18 | `feat(worker): add admin user delete` | DELETE /api/admin/users/:id | **L1+L2: 100%** |
| 19 | `feat(worker): add admin thread moderation` | PATCH /api/admin/threads/:id | **L1+L2: 100%** |

### Phase 6: 优化和完善

| 编号 | 提交信息 | 内容 | 质量状态 |
|------|---------|------|---------|
| 20 | `feat(worker): add kv cache service` | KV 缓存服务、热点数据缓存 | **L1+L2: 100%** |
| 21 | `test(worker): add e2e tests with playwright` | E2E 测试场景 | **L1+L2+L3: 覆盖** |
| 22 | `perf(worker): add request logging` | 请求日志、性能监控 | **L1+L2: 100%** |

---

## 部署配置

### 环境变量

```toml
# wrangler.toml
[vars]
ENVIRONMENT = "production"
JWT_SECRET = "..."
ALLOWED_ORIGINS = "https://ellie.nocoo.cloud"
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

## 性能优化

### 1. 边缘缓存

```typescript
// 使用 Cache API 缓存热门版块
export async function getCachedForums(env: Env): Promise<Forum[]> {
  const cache = caches.default;
  const cacheKey = "forums:list";

  let response = await cache.match(cacheKey);
  if (!response) {
    const forums = await fetchForumsFromD1(env);
    response = new Response(JSON.stringify(forums), {
      headers: { "Content-Type": "application/json" },
      // 缓存 5 分钟
    });
    await cache.put(cacheKey, response.clone(), { expirationTtl: 300 });
  }

  return response.json();
}
```

### 2. 批量查询

```typescript
// 减少往返次数，合并查询
export async function getThreadWithFirstPost(
  threadId: number,
  env: Env,
): Promise<ThreadWithFirstPost> {
  const result = await env.DB.prepare(`
    SELECT
      t.*,
      p.id as first_post_id,
      p.content as first_post_content
    FROM threads t
    LEFT JOIN posts p ON p.thread_id = t.id AND p.is_first = 1
    WHERE t.id = ?
  `).bind(threadId).first();

  return result as unknown as ThreadWithFirstPost;
}
```

### 3. 索引优化

确保 D1 表有以下索引（已在迁移时创建）：

```sql
-- 论坛查询
CREATE INDEX idx_threads_forum ON threads(forum_id, last_post_at DESC);
CREATE INDEX idx_posts_thread ON posts(thread_id, created_at);

-- 用户查询
CREATE INDEX idx_threads_author ON threads(author_id);
CREATE INDEX idx_posts_author ON posts(author_id);
```

---

## 安全考虑

1. **CORS 白名单**：只允许信任的域名访问
2. **JWT 签名验证**：使用 HS256 算法，secret 存储在 Workers KV
3. **速率限制**：每个 IP 每 10 分钟 100 次请求
4. **SQL 注入防护**：使用参数化查询
5. **输入验证**：验证所有输入参数
6. **敏感数据脱敏**：用户密码、邮箱等敏感信息不返回

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
  // 发送到日志服务（如 Cloudflare Analytics）
  console.log(JSON.stringify(entry));
}
```

### 性能监控

```typescript
// 记录请求耗时
const startTime = Date.now();
const response = await handler(request, env);
const duration = Date.now() - startTime;

logRequest({
  level: "info",
  timestamp: Date.now(),
  requestId: crypto.randomUUID(),
  path: url.pathname,
  method: request.method,
  status: response.status,
  duration,
});
```
