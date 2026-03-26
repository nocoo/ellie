# 04c — Worker API 设计

> Cloudflare Worker 作为 API 中间层，前端不直接访问 D1。

## 架构

```
┌─────────────┐     fetch()     ┌──────────────┐     D1 bind     ┌─────────┐
│  Next.js    │ ───────────────▶│   Worker     │ ──────────────▶│   D1    │
│  (apps/web) │◀─────────────── │  (worker/)   │◀────────────── │ Database │
└─────────────┘    JSON         └──────────────┘    SQLite      └─────────┘
```

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| 运行时 | Cloudflare Workers | 边缘计算，冷启动 ~50ms |
| 数据库 | Cloudflare D1 | SQLite 兼容，通过 env.DB 绑定 |
| 部署 | wrangler | `wrangler dev` / `wrangler deploy` |
| 类型 | @cloudflare/workers-types | TypeScript 类型定义 |

## API 端点

### 公开 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/v1/forums | 获取所有版块 |
| GET | /api/v1/forums/:id | 获取单个版块 |
| GET | /api/v1/threads | 获取主题列表（支持 forumId, limit, cursor） |
| GET | /api/v1/threads/:id | 获取单个主题 |
| GET | /api/v1/posts | 获取帖子列表（支持 threadId, limit） |
| GET | /api/v1/posts/:id | 获取单个帖子 |
| GET | /api/v1/users/:id | 获取用户信息 |

### 认证 API（TODO）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/v1/threads | 创建主题 |
| POST | /api/v1/posts | 发布回复 |

### 管理 API（TODO）

| 方法 | 路径 | 说明 |
|------|------|------|
| PATCH | /api/admin/forums/:id | 更新版块 |
| DELETE | /api/admin/users/:id | 删除用户 |

## 示例请求

```bash
# 获取所有版块
curl https://ellie.nocoo.cloud/api/v1/forums

# 获取主题列表
curl "https://ellie.nocoo.cloud/api/v1/threads?forumId=1&limit=20"

# 获取主题的帖子
curl "https://ellie.nocoo.cloud/api/v1/posts?threadId=123&limit=20"
```

## CORS

所有响应包含 CORS headers：

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

## 本地开发

```bash
cd apps/worker
wrangler dev

# Worker 运行在 http://localhost:8787
```

## D1 绑定

`wrangler.toml` 配置：

```toml
[[d1_databases]]
binding = "DB"
database_name = "ellie-db"
database_id = "<D1_DATABASE_ID>"
```

在 Worker 中通过 `env.DB` 访问：

```typescript
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const stmt = env.DB.prepare("SELECT * FROM forums");
		const result = await stmt.all();
		return Response.json(result.results);
	},
};
```
