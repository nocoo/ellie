# 应用设计

> Phase 2 开始时细化。以下为架构骨架，确定边界和数据流。

## 整体架构

```
Browser / Client
      │
      ▼
Cloudflare Worker (API + SSR)
      │
      ├─ Cache API (per-PoP edge cache)
      ├─ Workers KV (global K/V: sessions, hot data)
      ├─ D1 (SQLite, read replicas enabled)
      ├─ R2 (avatars, attachments)
      └─ Queue (view count batching, async writes)
```

## API 层（Worker）

### 路由边界

| 前缀 | 用途 | 认证 |
|------|------|------|
| `/api/v1/forums` | 版块列表、版块详情 | 公开 |
| `/api/v1/threads` | 帖子列表、帖子详情、发帖 | 读公开，写需登录 |
| `/api/v1/posts` | 回复列表、发回复 | 读公开，写需登录 |
| `/api/v1/users` | 用户资料、登录、注册 | 资料公开，认证操作需凭证 |
| `/api/v1/attachments` | 附件下载、上传 | 下载公开，上传需登录 |
| `/api/admin/*` | 管理后台 API | 需 role ∈ {1, 2}（admin 或 super-mod） |

### 认证方案

- 登录：验证 DZ 旧密码（`md5(md5(input) + salt)`），成功后 argon2id 重新哈希并清除 salt
- 会话：JWT 存于 HttpOnly cookie，KV 存 session 状态（支持主动吊销）
- 归档用户（`status = -2`）和封禁用户（`status = -1`）禁止登录

### 读写数据链

**读（帖子详情页为例）：**
```
Client → Worker → Cache API (edge hit?) → D1 read replica → response
                                                    ↓
                                              Cache API write-back
```

**写（发回复为例）：**
```
Client → Worker → validate + auth → D1 primary (INSERT post)
                                         ↓
                              Queue: update thread.replies, forum.posts, user.posts
                              Queue: invalidate Cache API keys
```

## 管理后台（Admin）

### 模块

| 模块 | 功能 | 优先级 |
|------|------|--------|
| 仪表盘 | 统计概览（用户数、帖子数、今日活跃） | P0 |
| 用户管理 | 列表、搜索、封禁/解封、角色变更 | P0 |
| 内容审核 | 帖子/回复列表、删除、批量操作 | P0 |
| 版块管理 | 排序、隐藏/显示、编辑描述 | P1 |
| 附件管理 | 存储用量、孤立文件清理 | P2 |

### 技术方案

- 前端：React SPA（或 Next.js 子路径），通过 `/api/admin/*` 与 Worker 交互
- 部署：与论坛 Worker 同一个项目，`/admin` 路径下的静态资源从 R2/KV 提供
- 权限：middleware 检查 JWT 中的 `role IN (1, 2)`（admin=1, super-mod=2）。mod=3 无管理后台权限（仅前台版块管理）

## 论坛前端（BBS）

### 页面模型

| 页面 | 路由 | 数据源 | 缓存策略 |
|------|------|--------|---------|
| 首页 | `/` | threads (latest) | Cache API 1 min |
| 版块列表 | `/forums` | forums (all) | Cache API 5 min |
| 版块帖子列表 | `/forums/:id` | threads (by forum) | Cache API 1 min |
| 帖子详情 | `/threads/:id` | posts (by thread) + attachments | Cache API 1 min |
| 用户主页 | `/users/:id` | user info + threads/posts | Cache API 2 min |
| 精华列表 | `/digest` | threads (digest > 0) | Cache API 5 min |
| 登录/注册 | `/login`, `/register` | — | 不缓存 |

### 分页

所有列表页使用 keyset 分页（详见 02-database-schema.md 性能章节），不使用 OFFSET。

### 技术方案

- Next.js on Cloudflare Workers（`@opennextjs/cloudflare`）
- SSR 首屏 + 客户端导航
- 响应式设计（Mobile first）

## 缓存策略

| 层 | 存储 | TTL | 失效方式 |
|----|------|-----|---------|
| Edge | Cache API | 1-5 min（按页面） | 写操作后 `cache.delete(key)` |
| Global | Workers KV | 30s-24h | 写操作后 `KV.delete(key)` |
| DB | D1 read replica | 自动（最终一致） | Sessions API `first-primary` 保证写后读 |
| File | R2 + CDN | 长期（内容寻址） | 不失效（文件不可变） |

写操作触发的缓存失效通过 Queue 异步执行，不阻塞用户响应。
