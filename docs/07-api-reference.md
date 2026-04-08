# 07 — API 接口参考手册

> 基于实际代码的完整 API 文档。公开端点 22 个 + 管理端点 45 个 = 共 67 个。
>
> **最后更新**：2026-03-29

---

## 目录

- [全局约定](#全局约定)
  - [基础 URL](#基础-url)
  - [认证体系](#认证体系)
  - [通用响应格式](#通用响应格式)
  - [错误码一览](#错误码一览)
  - [数据实体结构](#数据实体结构)
  - [枚举定义](#枚举定义)
- [接口列表](#接口列表)
  - [1. 健康检查](#1-健康检查)
  - [2-3. 版块（公开）](#2-3-版块公开)
  - [4-6. 主题（公开 + 认证）](#4-6-主题公开--认证)
  - [7-9. 帖子（公开 + 认证）](#7-9-帖子公开--认证)
  - [10. 附件（公开）](#10-附件公开)
  - [11. 用户（公开）](#11-用户公开)
  - [11b. 搜索（公开）](#11b-搜索公开)
  - [12-15. 认证](#12-15-认证)
  - [16-17. 用户自助服务](#16-17-用户自助服务)
  - [18-22. 版主操作](#18-22-版主操作)
- [管理端点（#23-#67）](#管理端点2367)
  - [实体总览](#实体总览)
  - [A. Forum 版块（Admin）— #23-#29](#a-forum-版块admin-2329)
  - [B. Thread 主题（Admin）— #30-#35](#b-thread-主题admin-3035)
  - [C. Post 帖子（Admin）— #36-#40](#c-post-帖子admin-3640)
  - [D. User 用户（Admin）— #41-#48](#d-user-用户admin-4148)
  - [E. Attachment 附件（Admin）— #49-#52](#e-attachment-附件admin-4952)
  - [F. IpBan IP 封禁（Admin）— #53-#59](#f-ipban-ip-封禁admin-5359)
  - [G. CensorWord 敏感词（Admin）— #60-#66](#g-censorword-敏感词admin-6066)
  - [H. Stats 站点统计（Admin）— #67](#h-stats-站点统计admin-67)
- [附录](#附录)
  - [测试原则](#测试原则)

---

## 全局约定

### 基础 URL

| 环境 | URL |
|------|-----|
| 生产 | `https://ellie.worker.hexly.ai` |
| 本地开发 | `http://localhost:8787` |

### 认证体系

系统采用双 Key 隔离体系，论坛用户认证与 Admin 路径完全独立：

#### API Key 层（路由隔离）

| Key | 环境变量 | 可访问路由 | 使用者 |
|-----|---------|-----------|--------|
| **Key A** | `API_KEY` | `/api/v1/*` | CLI、Web |
| **Key B** | `ADMIN_API_KEY` | `/api/admin/*` | Admin Console |

所有请求（除 `/api/live`）必须携带 `X-API-Key` header。Key A 不能访问 `/api/admin/*`，Key B 不能访问 `/api/v1/*`。

#### 论坛用户认证（Key A 体系）

| 层级 | 请求头 | 适用范围 |
|------|--------|----------|
| **API Key A** | `X-API-Key: <API_KEY>` | `/api/v1/*` 所有端点 |
| **论坛 JWT** | `Authorization: Bearer <token>` | 写操作、自助服务、版主操作 |
| **角色鉴权** | JWT 内的 `role` 字段 | 版主操作（`/api/v1/moderation/*`） |

**论坛 JWT**：HS256 签名，有效期 7 天。Payload：`{ userId, role, exp, iat }`。

**Refresh Token**：UUID 格式，存储在 KV 中，有效期 30 天，单次使用（旋转机制）。

**角色鉴权说明**（仅用于 `/api/v1/moderation/*`）：
- `withAuth`：仅验证论坛 JWT 有效性，任何已登录用户均可访问
- `withModerator`：要求 `role ∈ {1, 2, 3}`（管理员、超级版主、版主）

#### Admin 认证（Key B 体系）

| 层级 | 请求头 | 适用范围 |
|------|--------|----------|
| **API Key B** | `X-API-Key: <ADMIN_API_KEY>` | `/api/admin/*` 所有端点 |

Worker 对管理端点仅验证 Key B，不验证调用者身份。Admin 身份认证（Google OAuth + `ADMIN_EMAILS` 白名单）在 Next.js 服务端完成，Worker 无感知。

> Admin 身份由 Next.js 服务端的 `ADMIN_EMAILS` 环境变量白名单定义，与论坛用户完全独立。所有 Admin 全权相等，不分级。

#### 管理端点统一认证

所有 `/api/admin/*` 路由仅需通过 Key B 验证：

```
请求 → Key B 验证 → handler
```

Key B 由 Next.js 服务端持有，浏览器不可见。

### 通用响应格式

**成功响应（单体）：**
```json
{
  "data": { ... },
  "meta": {
    "timestamp": 1711612800000,
    "requestId": "550e8400-e29b-41d4-a716-446655440000"
  }
}
```

**成功响应（游标分页 — 公开列表）：**
```json
{
  "data": [ ... ],
  "meta": {
    "timestamp": 1711612800000,
    "requestId": "...",
    "nextCursor": "eyJzdGlja3kiOjAsImxhc3RQb3N0QXQiOjE3MTE1NDA4MDAsImlkIjo0Mn0="
  }
}
```

> `nextCursor` 为 `null` 时表示没有更多数据。

**成功响应（偏移分页 — 管理列表）：**
```json
{
  "data": [ ... ],
  "meta": {
    "timestamp": 1711612800000,
    "requestId": "...",
    "total": 150,
    "page": 1,
    "limit": 20,
    "pages": 8
  }
}
```

**错误响应：**
```json
{
  "error": {
    "code": "INVALID_BODY",
    "message": "Request body is invalid or missing required fields",
    "details": { "message": "具体的错误描述" }
  }
}
```

### 错误码一览

| 错误码 | HTTP 状态 | 描述 |
|--------|----------|------|
| `INVALID_REQUEST` | 400 | 请求参数无效 |
| `INVALID_BODY` | 400 | 请求体无效或缺少必填字段 |
| `CANNOT_DELETE_FIRST_POST` | 400 | 不能删除主楼帖子，请删除整个主题 |
| `BATCH_LIMIT_EXCEEDED` | 400 | 批量操作超过上限 |
| `INVALID_CREDENTIALS` | 401 | 用户名或密码错误 |
| `UNAUTHORIZED` | 401 | 需要认证 |
| `TOKEN_EXPIRED` | 401 | 认证令牌已过期 |
| `INVALID_TOKEN` | 401 | 认证令牌无效 |
| `INVALID_REFRESH_TOKEN` | 401 | 刷新令牌无效或已过期 |
| `WRONG_PASSWORD` | 401 | 当前密码不正确 |
| `FORBIDDEN` | 403 | 拒绝访问 |
| `FORBIDDEN_ADMIN_ONLY` | 403 | 此操作需要 Admin 权限（Key B 无效） |
| `FORBIDDEN_MOD_ONLY` | 403 | 此操作需要版主权限（论坛 JWT role 不满足） |
| `USER_BANNED` | 403 | 用户账号已被封禁 |
| `THREAD_CLOSED` | 403 | 主题已关闭，不接受新回复 |
| `NOT_FOUND` | 404 | 资源不存在 |
| `FORUM_NOT_FOUND` | 404 | 版块不存在 |
| `THREAD_NOT_FOUND` | 404 | 主题不存在 |
| `POST_NOT_FOUND` | 404 | 帖子不存在 |
| `USER_NOT_FOUND` | 404 | 用户不存在 |
| `IP_BAN_NOT_FOUND` | 404 | IP 封禁记录不存在 |
| `CENSOR_WORD_NOT_FOUND` | 404 | 敏感词规则不存在 |
| `FORUM_HAS_THREADS` | 409 | 版块下有主题，不能删除 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |
| `USERNAME_TAKEN` | 409 | 用户名已被占用 |
| `IP_BAN_DUPLICATE` | 409 | 相同 IP 封禁记录已存在 |
| `IP_BAN_SELF` | 400 | 不能封禁自己的 IP |
| `CENSOR_WORD_DUPLICATE` | 409 | 相同敏感词规则已存在 |
| `CENSOR_WORD_INVALID` | 400 | 敏感词规则无效（过短或正则语法错误） |
| `CONTENT_BANNED` | 403 | 内容包含禁止发布的敏感词 |
| `FEATURE_DISABLED` | 503 | 功能已被管理员禁用 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

### 数据实体结构

#### Forum（版块）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 版块 ID |
| `parentId` | number | 父版块 ID（0 为顶级） |
| `name` | string | 版块名称 |
| `description` | string | 版块描述 |
| `icon` | string | 图标 |
| `displayOrder` | number | 排序权重 |
| `threads` | number | 主题数 |
| `posts` | number | 帖子数 |
| `type` | string | 类型：`"group"` / `"forum"` / `"sub"` |
| `status` | number | 状态：`0` 隐藏、`1` 显示 |
| `lastThreadId` | number | 最后主题 ID |
| `lastPostAt` | number | 最后发帖时间（Unix 秒） |
| `lastPoster` | string | 最后发帖人 |

#### Thread（主题）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 主题 ID |
| `forumId` | number | 所属版块 ID |
| `authorId` | number | 作者 ID |
| `authorName` | string | 作者用户名 |
| `subject` | string | 标题 |
| `createdAt` | number | 创建时间（Unix 秒） |
| `lastPostAt` | number | 最后回复时间（Unix 秒） |
| `lastPoster` | string | 最后回复人 |
| `replies` | number | 回复数 |
| `views` | number | 浏览数 |
| `closed` | number | 是否关闭：`0` / `1` |
| `sticky` | number | 置顶级别：`0` 无、`1` 版块、`2` 全局、`3` 分类 |
| `digest` | number | 精华级别：`0`-`3` |
| `special` | number | 特殊类型 |
| `highlight` | number | 高亮标记 |
| `recommends` | number | 推荐数 |

#### Post（帖子）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 帖子 ID |
| `threadId` | number | 所属主题 ID |
| `forumId` | number | 所属版块 ID |
| `authorId` | number | 作者 ID |
| `authorName` | string | 作者用户名 |
| `content` | string | 帖子内容 |
| `createdAt` | number | 创建时间（Unix 秒） |
| `isFirst` | boolean | 是否为主楼 |
| `position` | number | 楼层序号 |

#### User — 三种响应模型

系统根据调用者身份返回不同粒度的用户信息，避免隐私泄露：

**PublicUser** — 公开接口 `GET /api/v1/users/:id` 返回：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 用户 ID |
| `username` | string | 用户名 |
| `avatar` | string | 头像（legacy 字段，返回空字符串；前端通过 `/api/avatar/{id}` 代理获取实际图片） |
| `role` | number | 角色：`0` 普通、`1` 管理员、`2` 超级版主、`3` 版主 |
| `regDate` | number | 注册时间（Unix 秒） |
| `threads` | number | 发帖数 |
| `posts` | number | 回帖数 |

**SelfUser** — 自己的信息 `GET /api/v1/auth/me`、`PATCH /api/v1/users/me` 返回，在 PublicUser 基础上增加：

| 字段 | 类型 | 说明 |
|------|------|------|
| `email` | string | 邮箱 |
| `status` | number | 状态：`0` 正常、`-1` 封禁、`-2` 归档 |
| `lastLogin` | number | 最后登录时间（Unix 秒） |
| `credits` | number | 积分 |

**AdminUser** — 管理端点 `GET /api/admin/users`、`GET /api/admin/users/:id`、`PATCH /api/admin/users/:id` 返回，包含全部字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 用户 ID |
| `username` | string | 用户名 |
| `email` | string | 邮箱 |
| `avatar` | string | 头像（legacy 字段，返回空字符串；前端通过 `/api/avatar/{id}` 代理获取实际图片） |
| `status` | number | 状态：`0` 正常、`-1` 封禁、`-2` 归档 |
| `role` | number | 角色：`0` 普通、`1` 管理员、`2` 超级版主、`3` 版主 |
| `regDate` | number | 注册时间（Unix 秒） |
| `lastLogin` | number | 最后登录时间（Unix 秒） |
| `threads` | number | 发帖数 |
| `posts` | number | 回帖数 |
| `credits` | number | 积分 |

> **安全说明**：`password_hash` 和 `password_salt` 永远不会出现在任何 API 响应中。

#### IpBan（IP 封禁）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 封禁记录 ID |
| `ip` | string | IP 地址或 CIDR（如 `192.168.1.0/24`、`10.0.*.*`） |
| `adminId` | number | 执行封禁的管理员 ID |
| `adminName` | string | 管理员用户名 |
| `reason` | string | 封禁原因 |
| `expiresAt` | number \| null | 过期时间（Unix 秒），`null` 为永久封禁 |
| `createdAt` | number | 创建时间（Unix 秒） |

#### CensorWord（敏感词）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 敏感词 ID |
| `find` | string | 匹配模式（纯文本或 `/regex/` 格式） |
| `replacement` | string | 替换文本，特殊值：`{BANNED}` 表示直接拦截 |
| `action` | string | 动作类型：`"ban"` 拦截、`"replace"` 替换 |
| `adminId` | number | 添加的管理员 ID |
| `adminName` | string | 管理员用户名 |
| `createdAt` | number | 创建时间（Unix 秒） |

#### Attachment（附件）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 附件 ID |
| `threadId` | number | 所属主题 ID |
| `postId` | number | 所属帖子 ID |
| `authorId` | number | 上传者 ID |
| `filename` | string | 文件名 |
| `filePath` | string | 文件路径 |
| `fileSize` | number | 文件大小（字节） |
| `isImage` | boolean | 是否为图片 |
| `width` | number | 图片宽度（像素） |
| `hasThumb` | boolean | 是否有缩略图 |
| `downloads` | number | 下载次数 |
| `createdAt` | number | 上传时间（Unix 秒） |

### 枚举定义

| 枚举 | 值 | 说明 |
|------|---|------|
| `UserRole` | `0` 普通用户、`1` 管理员、`2` 超级版主、`3` 版主 | |
| `UserStatus` | `0` 正常、`-1` 封禁、`-2` 归档 | |
| `StickyLevel` | `0` 无、`1` 版块置顶、`2` 全局置顶、`3` 分类置顶 | |
| `ForumType` | `"group"` 分组、`"forum"` 版块、`"sub"` 子版块 | |

---

## 接口列表

### 1. 健康检查

#### `GET /api/live`

检查系统运行状态和 D1 数据库连通性。

| 属性 | 值 |
|------|---|
| 认证 | 无（不需要 API Key） |
| 缓存 | `Cache-Control: no-store` |

**请求参数**：无

**成功响应（200）：**
```json
{
  "status": "ok",
  "environment": "production",
  "timestamp": 1711612800000,
  "checks": {
    "d1": "connected"
  }
}
```

**异常响应（503）：**
```json
{
  "status": "error",
  "environment": "production",
  "timestamp": 1711612800000,
  "checks": {
    "d1": "unreachable: <错误信息>"
  }
}
```

> **注意**：错误信息中的 "ok" 字样会被替换为 "***"，避免关键词监控误判。

---

### 2-3. 版块（公开）

#### #2 `GET /api/v1/forums`

获取全部版块列表。

| 属性 | 值 |
|------|---|
| 认证 | API Key |
| 分页 | 无（全量返回） |

**请求参数**：无

**成功响应（200）：**
```json
{
  "data": [
    {
      "id": 1,
      "parentId": 0,
      "name": "综合讨论区",
      "description": "...",
      "icon": "",
      "displayOrder": 1,
      "threads": 1500,
      "posts": 23000,
      "type": "forum",
      "status": 1,
      "lastThreadId": 12345,
      "lastPostAt": 1711612800,
      "lastPoster": "testuser"
    }
  ],
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

> 排序规则：按 `display_order` 升序。

---

#### #3 `GET /api/v1/forums/:id`

获取单个版块详情。

| 属性 | 值 |
|------|---|
| 认证 | API Key |
| 路径参数 | `id` — 版块 ID（整数） |

**成功响应（200）：**
```json
{
  "data": {
    "id": 1,
    "parentId": 0,
    "name": "综合讨论区",
    "description": "...",
    "icon": "",
    "displayOrder": 1,
    "threads": 1500,
    "posts": 23000,
    "type": "forum",
    "status": 1,
    "lastThreadId": 12345,
    "lastPostAt": 1711612800,
    "lastPoster": "testuser"
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `FORUM_NOT_FOUND` | 404 | 版块不存在 |

---

### 4-6. 主题（公开 + 认证）

#### #4 `GET /api/v1/threads`

获取主题列表（游标分页）。

| 属性 | 值 |
|------|---|
| 认证 | API Key |
| 分页 | 游标分页（keyset） |

**查询参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `forumId` | integer | 是 | — | 版块 ID |
| `limit` | integer | 否 | 100 | 每页数量，范围 [1, 100] |
| `cursor` | string | 否 | — | 分页游标（Base64 编码） |

**游标格式**：`btoa(JSON.stringify({ sticky: number, lastPostAt: number, id: number }))`

**排序规则**：`sticky DESC, last_post_at DESC, id DESC` — 置顶主题始终排在最前。

**成功响应（200）：**
```json
{
  "data": [
    {
      "id": 100,
      "forumId": 1,
      "authorId": 42,
      "authorName": "testuser",
      "subject": "讨论帖标题",
      "createdAt": 1711612800,
      "lastPostAt": 1711612800,
      "lastPoster": "testuser",
      "replies": 5,
      "views": 200,
      "closed": 0,
      "sticky": 0,
      "digest": 0,
      "special": 0,
      "highlight": 0,
      "recommends": 0
    }
  ],
  "meta": {
    "timestamp": 1711612800000,
    "requestId": "...",
    "nextCursor": "eyJzdGlja3kiOjAsImxhc3RQb3N0QXQiOjE3MTE1NDA4MDAsImlkIjo0Mn0="
  }
}
```

> 无更多数据时，`nextCursor` 字段值为 `null`。

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `INVALID_REQUEST` | 400 | `forumId` 缺失或不是有效整数 |

---

#### #5 `GET /api/v1/threads/:id`

获取单个主题详情。

| 属性 | 值 |
|------|---|
| 认证 | API Key |
| 路径参数 | `id` — 主题 ID（整数） |

**成功响应（200）：**
```json
{
  "data": {
    "id": 100,
    "forumId": 1,
    "authorId": 42,
    "authorName": "testuser",
    "subject": "讨论帖标题",
    "createdAt": 1711612800,
    "lastPostAt": 1711612800,
    "lastPoster": "testuser",
    "replies": 5,
    "views": 200,
    "closed": 0,
    "sticky": 0,
    "digest": 0,
    "special": 0,
    "highlight": 0,
    "recommends": 0
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `THREAD_NOT_FOUND` | 404 | 主题不存在 |

> **特殊行为**：访问时会触发「即发即忘」的浏览数递增（`UPDATE threads SET views = views + 1`），不等待完成。返回的 `views` 是递增前的值。

---

#### #6 `POST /api/v1/threads`

创建新主题。

| 属性 | 值 |
|------|---|
| 认证 | API Key + JWT（`withAuth`） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `forumId` | number | 是 | 必须对应存在的版块 |
| `subject` | string | 是 | 非空，最多 200 字符 |
| `content` | string | 是 | 非空（主楼内容） |

**成功响应（201）：**
```json
{
  "data": {
    "id": 101,
    "forumId": 1,
    "authorId": 42,
    "authorName": "testuser",
    "subject": "新主题标题",
    "createdAt": 1711612800,
    "lastPostAt": 1711612800,
    "lastPoster": "testuser",
    "replies": 0,
    "views": 0,
    "closed": 0,
    "sticky": 0,
    "digest": 0,
    "special": 0,
    "highlight": 0,
    "recommends": 0
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**副作用（原子批量操作）：**
- 插入主题记录
- 插入主楼帖子（`is_first=1, position=1`）
- 更新版块计数（`threads+1`, `posts+1`）和最后发帖信息
- 更新用户计数（`threads+1`, `posts+1`）

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` | 401 | 缺少或无效的 JWT |
| `TOKEN_EXPIRED` | 401 | JWT 已过期 |
| `INVALID_BODY` | 400 | 缺少必填字段、标题超长 |
| `FORUM_NOT_FOUND` | 404 | 版块不存在 |

---

### 7-9. 帖子（公开 + 认证）

#### #7 `GET /api/v1/posts`

获取帖子列表（游标分页）。

| 属性 | 值 |
|------|---|
| 认证 | API Key |
| 分页 | 游标分页（keyset，基于 position） |

**查询参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `threadId` | integer | 是 | — | 主题 ID |
| `limit` | integer | 否 | 100 | 每页数量，范围 [1, 100] |
| `cursor` | string | 否 | — | 分页游标（Base64 编码） |

**游标格式**：`btoa(JSON.stringify({ position: number }))`

**排序规则**：`position ASC` — 按楼层顺序排列。

**成功响应（200）：**
```json
{
  "data": [
    {
      "id": 500,
      "threadId": 100,
      "forumId": 1,
      "authorId": 42,
      "authorName": "testuser",
      "content": "帖子内容...",
      "createdAt": 1711612800,
      "isFirst": true,
      "position": 1
    }
  ],
  "meta": {
    "timestamp": 1711612800000,
    "requestId": "...",
    "nextCursor": "eyJwb3NpdGlvbiI6MjB9"
  }
}
```

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `INVALID_REQUEST` | 400 | `threadId` 缺失或不是有效整数 |

---

#### #8 `GET /api/v1/posts/:id`

获取单个帖子详情。

| 属性 | 值 |
|------|---|
| 认证 | API Key |
| 路径参数 | `id` — 帖子 ID（整数） |

**成功响应（200）：**
```json
{
  "data": {
    "id": 500,
    "threadId": 100,
    "forumId": 1,
    "authorId": 42,
    "authorName": "testuser",
    "content": "帖子内容...",
    "createdAt": 1711612800,
    "isFirst": true,
    "position": 1
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `POST_NOT_FOUND` | 404 | 帖子不存在 |

---

#### #9 `POST /api/v1/posts`

发表回复。

| 属性 | 值 |
|------|---|
| 认证 | API Key + JWT（`withAuth`） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `threadId` | number | 是 | 必须对应存在且未关闭的主题 |
| `content` | string | 是 | 非空 |

**成功响应（201）：**
```json
{
  "data": {
    "id": 501,
    "threadId": 100,
    "forumId": 1,
    "authorId": 42,
    "authorName": "testuser",
    "content": "回复内容...",
    "createdAt": 1711612800,
    "isFirst": false,
    "position": 6
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**副作用（原子批量操作）：**
- 插入帖子（`position` 自动计算为 `MAX(position) + 1`）
- 更新主题（`replies+1`、最后回复信息）
- 更新版块（`posts+1`、最后发帖信息）
- 更新用户（`posts+1`）

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` | 401 | 缺少或无效的 JWT |
| `TOKEN_EXPIRED` | 401 | JWT 已过期 |
| `INVALID_BODY` | 400 | 缺少必填字段 |
| `THREAD_NOT_FOUND` | 404 | 主题不存在 |
| `THREAD_CLOSED` | 403 | 主题已关闭 |

---

### 10. 附件（公开）

#### #10 `GET /api/v1/posts/:id/attachments`

获取指定帖子的附件列表。

| 属性 | 值 |
|------|---|
| 认证 | API Key |
| 路径参数 | `id` — 帖子 ID（整数，从 URL 路径中提取） |
| 分页 | 无（全量返回） |

**成功响应（200）：**
```json
{
  "data": [
    {
      "id": 1,
      "threadId": 100,
      "postId": 500,
      "authorId": 42,
      "filename": "photo.jpg",
      "filePath": "attachments/2024/01/photo.jpg",
      "fileSize": 204800,
      "isImage": true,
      "width": 1920,
      "hasThumb": true,
      "downloads": 15,
      "createdAt": 1711612800
    }
  ],
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

> 排序规则：按 `id` 升序。

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `INVALID_REQUEST` | 400 | 帖子 ID 无效（NaN 或 ≤ 0） |

---

### 11. 用户（公开）

#### #11 `GET /api/v1/users/:id`

获取用户公开信息。

| 属性 | 值 |
|------|---|
| 认证 | API Key |
| 路径参数 | `id` — 用户 ID（整数） |

**成功响应（200）：**
```json
{
  "data": {
    "id": 42,
    "username": "testuser",
    "avatar": "https://...",
    "role": 0,
    "regDate": 1609459200,
    "threads": 15,
    "posts": 230
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

> **返回 PublicUser 模型** — 不包含 `email`、`status`、`lastLogin`、`credits` 等敏感字段。

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `USER_NOT_FOUND` | 404 | 用户不存在 |

> **安全说明**：使用显式列名查询，绝不 `SELECT *`，确保 `password_hash`/`password_salt` 不泄露。

---

### 11b. 搜索（公开）

#### `GET /api/v1/search/threads`

全文搜索主题标题。使用 FTS5 索引，支持中文搜索和多关键词 AND 查询。

| 属性 | 值 |
|------|---|
| 认证 | API Key（可选 JWT 获取更多版块可见性） |

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `q` | string | 是 | 搜索关键词，最少 2 字符。空格分隔的多个关键词执行 AND 查询 |
| `limit` | number | 否 | 返回数量，默认 20，最大 50 |
| `cursor` | string | 否 | Base64 编码的分页游标（用于下一页） |

**成功响应（200）：**

```json
{
  "data": [
    {
      "id": 123456,
      "forumId": 5,
      "authorId": 1001,
      "authorName": "张三",
      "authorAvatar": "",
      "subject": "同济大学2024届毕业典礼",
      "createdAt": 1704067200,
      "lastPostAt": 1704153600,
      "lastPoster": "李四",
      "lastPosterId": 1002,
      "lastPosterAvatar": "",
      "replies": 42,
      "views": 1234,
      "closed": 0,
      "sticky": 0,
      "digest": 0,
      "special": 0,
      "highlight": 0,
      "recommends": 0,
      "typeName": ""
    }
  ],
  "meta": {
    "timestamp": 1704240000000,
    "requestId": "...",
    "nextCursor": "eyJsYXN0UG9zdEF0IjoxNzA0MTUzNjAwLCJpZCI6MTIzNDU2fQ==",
    "total": 183
  }
}
```

**响应字段说明：**

- `data[]` — Thread 对象数组，按 `lastPostAt DESC` 排序
- `meta.nextCursor` — 下一页游标，为 `null` 时表示没有更多结果
- `meta.total` — 总匹配数（仅首页返回，翻页时为 0）

**可见性过滤：**

搜索结果遵循标准可见性规则：
- 主题：`sticky >= 0`（排除隐藏/删除/占位主题）
- 版块：`status = 1` 且用户有权访问的 visibility 级别
- 匿名用户只能搜索到 `public` 版块的主题
- 登录用户可搜索 `public` + `members` 版块
- 版主/管理员可搜索 `staff`/`admin` 版块

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `INVALID_REQUEST` | 400 | 缺少 `q` 参数、查询少于 2 字符、或 cursor 格式无效 |
| `FEATURE_DISABLED` | 503 | 搜索功能已被管理员禁用（`general.search.enabled = false`） |

**使用示例：**

```bash
# 基本搜索
curl -H "X-API-Key: $KEY" "https://api/v1/search/threads?q=毕业"

# 多关键词 AND 搜索
curl -H "X-API-Key: $KEY" "https://api/v1/search/threads?q=同济%20毕业"

# 分页
curl -H "X-API-Key: $KEY" "https://api/v1/search/threads?q=test&cursor=eyJsYXN0..."
```

---

### 12-15. 认证

#### #12 `POST /api/v1/auth/login`

用户登录。

| 属性 | 值 |
|------|---|
| 认证 | API Key（无需 JWT） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 |
|------|------|------|
| `username` | string | 是 |
| `password` | string | 是 |

**成功响应（200）：**
```json
{
  "data": {
    "token": "eyJhbGciOiJIUzI1NiJ9...",
    "refreshToken": "550e8400-e29b-41d4-a716-446655440000",
    "user": {
      "userId": 42,
      "username": "admin",
      "role": 1
    }
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**副作用：**
- **静默密码升级**：如果用户使用 Discuz 旧格式密码（有 `password_salt`），验证成功后自动重新哈希为 PBKDF2-SHA256 格式并清除 `password_salt`
- **最后登录更新**：更新 `users.last_login` 为当前时间戳

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `INVALID_REQUEST` | 400 | 缺少 `username` 或 `password` |
| `INVALID_CREDENTIALS` | 401 | 用户不存在或密码错误 |
| `USER_BANNED` | 403 | 用户已被封禁（`status !== 0`） |

---

#### #13 `POST /api/v1/auth/refresh`

刷新令牌（令牌旋转机制）。

| 属性 | 值 |
|------|---|
| 认证 | API Key（无需 JWT） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 |
|------|------|------|
| `refreshToken` | string | 是 |

**成功响应（200）：**
```json
{
  "data": {
    "token": "<新的 JWT>",
    "refreshToken": "<新的刷新令牌>",
    "user": {
      "userId": 42,
      "username": "admin",
      "role": 1
    }
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

> **令牌旋转**：旧的刷新令牌会从 KV 中删除，同时签发新的。每个刷新令牌只能使用一次。

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `INVALID_REQUEST` | 400 | 缺少 `refreshToken` |
| `INVALID_REFRESH_TOKEN` | 401 | 令牌不在 KV 中（已过期/无效/已使用），或用户已被删除 |
| `USER_BANNED` | 403 | 签发后用户被封禁 |

---

#### #14 `DELETE /api/v1/auth/logout`

登出（销毁刷新令牌）。

| 属性 | 值 |
|------|---|
| 认证 | API Key（无需 JWT） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 |
|------|------|------|
| `refreshToken` | string | 是 |

**成功响应（200）：**
```json
{
  "data": { "loggedOut": true },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

> KV 删除是幂等的 — 即使令牌不存在也会成功返回。

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `INVALID_REQUEST` | 400 | 缺少 `refreshToken` |

---

#### #15 `GET /api/v1/auth/me`

获取当前登录用户信息。

| 属性 | 值 |
|------|---|
| 认证 | API Key + JWT（`withAuth`） |

**请求参数**：无

**成功响应（200）：**
```json
{
  "data": {
    "id": 42,
    "username": "testuser",
    "avatar": "https://...",
    "role": 0,
    "regDate": 1609459200,
    "threads": 15,
    "posts": 230,
    "email": "test@example.com",
    "status": 0,
    "lastLogin": 1711612800,
    "credits": 500
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

> **返回 SelfUser 模型** — 包含 PublicUser 的全部字段，以及 `email`、`status`、`lastLogin`、`credits`。

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` | 401 | 缺少或无效的 JWT |
| `TOKEN_EXPIRED` | 401 | JWT 已过期 |
| `USER_NOT_FOUND` | 404 | JWT 指向已删除的用户 |

---

### 16-17. 用户自助服务

#### #16 `PATCH /api/v1/users/me`

更新自己的资料（邮箱等）。头像通过 `POST /api/v1/upload` 上传，不支持直接 PATCH。

| 属性 | 值 |
|------|---|
| 认证 | API Key + JWT（`withAuth`） |

**请求体（JSON）— 至少提供一个字段：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `email` | string | 否 | 必须包含 `@`，最多 255 字符，非空 |

> **注意**：头像不再通过此端点更新。请使用 `POST /api/v1/upload` 上传头像（见 docs/15-avatar-upload.md）。

**成功响应（200）** — 返回 **SelfUser** 模型：
```json
{
  "data": {
    "id": 42,
    "username": "testuser",
    "avatar": "/api/avatar/42",
    "role": 0,
    "regDate": 1609459200,
    "threads": 15,
    "posts": 230,
    "email": "new@example.com",
    "status": 0,
    "lastLogin": 1711612800,
    "credits": 500
  },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` | 401 | 缺少或无效的 JWT |
| `INVALID_BODY` | 400 | 未提供任何字段，或邮箱格式无效 |
| `USER_NOT_FOUND` | 404 | 用户记录不存在 |

---

#### #17 `POST /api/v1/users/me/password`

修改自己的密码。

| 属性 | 值 |
|------|---|
| 认证 | API Key + JWT（`withAuth`） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `oldPassword` | string | 是 | — |
| `newPassword` | string | 是 | 至少 6 个字符 |

**成功响应（200）：**
```json
{
  "data": { "updated": true },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

> **密码处理**：新密码始终使用 PBKDF2-SHA256 哈希，同时清除 `password_salt`（完成 Discuz 旧格式迁移）。

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` | 401 | 缺少或无效的 JWT |
| `INVALID_BODY` | 400 | 缺少必填字段或新密码不足 6 字符 |
| `WRONG_PASSWORD` | 401 | 旧密码不正确 |
| `USER_NOT_FOUND` | 404 | 用户记录不存在 |

---


### 18-22. 版主操作

> **认证要求**：所有版主端点使用 **Key A + 论坛 JWT**，JWT 内 `role` 必须为 `1`（管理员）、`2`（超级版主）或 `3`（版主）。
>
> **中间件**：`moderationMiddleware` — 先验证 JWT 有效性，再检查角色权限。

#### #18 `PATCH /api/v1/moderation/threads/:id/sticky`

设置主题置顶级别。

| 属性 | 值 |
|------|---|
| 认证 | Key A + JWT（`withModerator`） |
| 路径参数 | `id` — 主题 ID（整数） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `level` | string | 是 | `"none"` / `"forum"` / `"global"` |

**成功响应（200）：**
```json
{
  "data": { "id": 100, "sticky": 1 },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

> `level` 映射：`none` → `0`、`forum` → `1`、`global` → `2`。

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` / `TOKEN_EXPIRED` | 401 | JWT 无效或过期 |
| `FORBIDDEN_MOD_ONLY` | 403 | 角色不满足版主要求 |
| `INVALID_REQUEST` | 400 | 主题 ID 无效 |
| `INVALID_BODY` | 400 | JSON 解析失败或 `level` 值不合法 |
| `THREAD_NOT_FOUND` | 404 | 主题不存在 |

---

#### #19 `PATCH /api/v1/moderation/threads/:id/digest`

设置主题精华级别。

| 属性 | 值 |
|------|---|
| 认证 | Key A + JWT（`withModerator`） |
| 路径参数 | `id` — 主题 ID（整数） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `level` | number | 是 | 整数，0-3 |

**成功响应（200）：**
```json
{
  "data": { "id": 100, "digest": 2 },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` / `TOKEN_EXPIRED` | 401 | JWT 无效或过期 |
| `FORBIDDEN_MOD_ONLY` | 403 | 角色不满足版主要求 |
| `INVALID_REQUEST` | 400 | 主题 ID 无效 |
| `INVALID_BODY` | 400 | JSON 解析失败或 `level` 不是 0-3 整数 |
| `THREAD_NOT_FOUND` | 404 | 主题不存在 |

---

#### #20 `PATCH /api/v1/moderation/threads/:id/close`

关闭或重新开放主题。

| 属性 | 值 |
|------|---|
| 认证 | Key A + JWT（`withModerator`） |
| 路径参数 | `id` — 主题 ID（整数） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `closed` | boolean | 是 | `true` 关闭、`false` 开放 |

**成功响应（200）：**
```json
{
  "data": { "id": 100, "closed": 1 },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

> `closed` 值在数据库中存储为整数：`true` → `1`、`false` → `0`。

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` / `TOKEN_EXPIRED` | 401 | JWT 无效或过期 |
| `FORBIDDEN_MOD_ONLY` | 403 | 角色不满足版主要求 |
| `INVALID_REQUEST` | 400 | 主题 ID 无效 |
| `INVALID_BODY` | 400 | JSON 解析失败或 `closed` 不是 boolean |
| `THREAD_NOT_FOUND` | 404 | 主题不存在 |

---

#### #21 `PATCH /api/v1/moderation/threads/:id/move`

移动主题到另一个版块。

| 属性 | 值 |
|------|---|
| 认证 | Key A + JWT（`withModerator`） |
| 路径参数 | `id` — 主题 ID（整数） |

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `targetForumId` | number | 是 | 正整数，目标版块必须存在 |

**成功响应（200）— 已移动：**
```json
{
  "data": { "id": 100, "forumId": 5, "moved": true },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**成功响应（200）— 目标与当前相同，未移动：**
```json
{
  "data": { "id": 100, "forumId": 5, "moved": false },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**副作用（仅当实际移动时）：**
- 更新主题和所有帖子的 `forum_id`
- 原版块计数递减（`threads-1`, `posts-N`）
- 目标版块计数递增（`threads+1`, `posts+N`）
- 重新计算两个版块的 `lastThreadId`、`lastPostAt`、`lastPoster`

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` / `TOKEN_EXPIRED` | 401 | JWT 无效或过期 |
| `FORBIDDEN_MOD_ONLY` | 403 | 角色不满足版主要求 |
| `INVALID_REQUEST` | 400 | 主题 ID 无效 |
| `INVALID_BODY` | 400 | JSON 解析失败或 `targetForumId` 不是正整数 |
| `THREAD_NOT_FOUND` | 404 | 主题不存在 |
| `INVALID_BODY` | 400 | 目标版块不存在（`"Target forum not found"`） |

---

#### #22 `DELETE /api/v1/moderation/posts/:id`

删除帖子（版主操作）。不能删除主楼帖子。

| 属性 | 值 |
|------|---|
| 认证 | Key A + JWT（`withModerator`） |
| 路径参数 | `id` — 帖子 ID（整数） |

**成功响应（200）：**
```json
{
  "data": { "deleted": true, "id": 500 },
  "meta": { "timestamp": 1711612800000, "requestId": "..." }
}
```

**副作用：**
- 删除帖子记录
- 主题 `replies-1`
- 版块 `posts-1`
- 帖子作者 `posts-1`
- 重新计算版块的 `lastThreadId`、`lastPostAt`、`lastPoster`

**错误响应：**

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `UNAUTHORIZED` / `TOKEN_EXPIRED` | 401 | JWT 无效或过期 |
| `FORBIDDEN_MOD_ONLY` | 403 | 角色不满足版主要求 |
| `INVALID_REQUEST` | 400 | 帖子 ID 无效 |
| `POST_NOT_FOUND` | 404 | 帖子不存在 |
| `CANNOT_DELETE_FIRST_POST` | 400 | 不能删除主楼帖子，请删除整个主题 |

---


## 管理端点（#23-#67）

> 管理 API 按**实体**组织。每个实体遵循统一的 CRUD 模式，特殊操作作为实体的扩展端点。
>
> **认证要求**：所有 `/api/admin/*` 端点使用 **Key B**（`ADMIN_API_KEY`）。Worker 仅验证 Key B，不关心调用者身份。Admin 身份（Google OAuth + 白名单）由 Next.js 服务端确认。所有 Admin 全权相等，不分级。
>
> **通用规则**：
> - 管理列表端点使用**偏移分页**（`page`, `limit`），排序 `id DESC`。**例外**：Forum list 无分页（全量返回），按 `parent_id, display_order` 排序
> - 所有 `PATCH` 为**部分更新** — body 只需包含要修改的字段
> - 所有 `DELETE` 返回 `{ deleted: true, id }`
> - 批量操作上限 100 条。**例外**：Forum reorder 上限 200 项
>
> **批量操作通用约定**：
> - 路径格式：`POST /api/admin/{entity}/batch-{action}`，如 `batch-delete`、`batch-move`、`batch-status`、`batch-role`
> - 请求体：`{ ids: number[], ... }`，`ids` 为必填数组，不得为空，上限 100
> - 批量删除返回：`{ deleted: true, count: number }`（可附带 `skipped` 数组说明跳过的 ID）
> - 批量更新返回：`{ updated: true, count: number }`（或语义化字段如 `moved: true`）
> - CRUD 框架提供 `createBatchDeleteHandler(config)` 工厂函数，实体通过配置 `batchDelete: true` 一行启用；语义化批量操作（move/status/role）在实体配置中单独定义

### 实体总览

| 实体 | 表名 | 认证 | 端点 | CRUD | 特殊操作 |
|------|------|------|------|------|----------|
| **Forum** | `forums` | Key B | #23-#29 | L·R·C·U·D | merge, reorder |
| **Thread** | `threads` | Key B | #30-#35 | L·R·U·D | batch-delete, batch-move |
| **Post** | `posts` | Key B | #36-#40 | L·R·U·D | batch-delete |
| **User** | `users` | Key B | #41-#48 | L·R·U | ban, nuke, batch-status, batch-role, batch-fetch |
| **Attachment** | `attachments` | Key B | #49-#52 | L·R·D | batch-delete |
| **IpBan** | `ip_bans` | Key B | #53-#59 | L·R·C·U·D | check-ip, batch-delete |
| **CensorWord** | `censor_words` | Key B | #60-#66 | L·R·C·U·D | test, batch-delete |
| **Stats** | *(聚合)* | Key B | #67 | R | — |

---

### A. Forum 版块（Admin）— #23-#29

#### #23 `GET /api/admin/forums`

获取全部版块列表（含隐藏版块）。

| 属性 | 值 |
|------|---|
| 认证 | Key B |
| 分页 | 无（全量返回） |

**成功响应（200）**：`{ data: Forum[], meta }` — 排序 `parent_id, display_order`。

---

#### #24 `GET /api/admin/forums/:id`

获取单个版块详情。

| 属性 | 值 |
|------|---|
| 认证 | Key B |
| 错误 | `INVALID_REQUEST`(400)、`FORUM_NOT_FOUND`(404) |

---

#### #25 `POST /api/admin/forums`

创建新版块。

| 属性 | 值 |
|------|---|
| 认证 | Key B |

**请求体：**

| 字段 | 类型 | 必填 | 默认值 | 约束 |
|------|------|------|--------|------|
| `name` | string | 是 | — | 非空，≤ 100 字符 |
| `type` | string | 否 | `"forum"` | `"group"` / `"forum"` / `"sub"` |
| `parentId` | number | 否 | `0` | 非零时父版块必须存在 |
| `description` | string | 否 | `""` | — |
| `icon` | string | 否 | `""` | — |
| `displayOrder` | number | 否 | `0` | — |
| `status` | number | 否 | `1` | `0` 或 `1` |

**成功响应（201）**：`{ data: Forum, meta }`

---

#### #26 `PATCH /api/admin/forums/:id`

更新版块属性。

| 属性 | 值 |
|------|---|
| 认证 | Key B |

**可更新字段**：`name`, `description`, `icon`, `displayOrder`, `status`, `type`, `parentId` — 至少提供一个。

**成功响应（200）**：`{ data: Forum, meta }`

---

#### #27 `DELETE /api/admin/forums/:id`

删除版块。**拒绝删除仍包含主题的版块**。

| 属性 | 值 |
|------|---|
| 认证 | Key B |
| 错误 | `FORUM_HAS_THREADS`(409) — `details: { threadCount }` |

---

#### #28 `POST /api/admin/forums/:id/merge`

将源版块合并到目标版块 — 移动所有主题和帖子，然后删除源版块。

| 属性 | 值 |
|------|---|
| 认证 | Key B |

**请求体**：`{ targetForumId: number }` — 目标版块必须存在，不能与源相同。

**成功响应（200）：**
```json
{
  "data": {
    "merged": true,
    "sourceForumId": 3,
    "targetForumId": 1,
    "threadsMoved": 50,
    "postsMoved": 1200
  }
}
```

**副作用**：更新所有主题/帖子的 `forum_id`，递增目标版块计数，删除源版块。

---

#### #29 `POST /api/admin/forums/reorder`

批量调整版块排序。

| 属性 | 值 |
|------|---|
| 认证 | Key B |

**请求体**：`{ orders: { id: number, displayOrder: number }[] }` — 非空，≤ 200 项。

**成功响应（200）**：`{ data: { updated: true, count: 10 } }`

---

### B. Thread 主题（Admin）— #30-#35

#### #30 `GET /api/admin/threads`

获取主题列表（偏移分页）。

| 属性 | 值 |
|------|---|
| 认证 | Key B |
| 分页 | 偏移分页 |

**筛选参数：**

| 参数 | 类型 | 匹配方式 |
|------|------|----------|
| `forumId` | integer | 精确 |
| `authorId` | integer | 精确 |
| `authorName` | string | LIKE |
| `subject` | string | LIKE |
| `sticky` | integer | 精确 |
| `closed` | integer | 精确 |
| `digest` | integer | 精确 |
| `highlight` | integer | 精确（0=无高亮，非0=有高亮） |

---

#### #31 `GET /api/admin/threads/:id`

获取单个主题详情。

---

#### #32 `PATCH /api/admin/threads/:id`

更新主题属性。**统一的属性修改端点** — 合并了置顶、精华、关闭、高亮、移动、标题编辑。

| 属性 | 值 |
|------|---|
| 认证 | Key B |

**可更新字段：**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `subject` | string | 非空，≤ 200 字符 | 标题 |
| `sticky` | number | 0-3 | 置顶级别 |
| `digest` | number | 0-3 | 精华级别 |
| `closed` | number | 0 或 1 | 关闭/开放 |
| `highlight` | number | ≥ 0 | 高亮样式编码（0=取消） |
| `forumId` | number | 目标版块必须存在 | 移动到目标版块 |

至少提供一个字段。可同时设置多个字段。

**成功响应（200）**：`{ data: Thread, meta }`

**当 `forumId` 存在时的副作用（move）：**
- 更新主题和所有帖子的 `forum_id`
- 原版块计数递减（`threads`, `posts`）
- 目标版块计数递增

---

#### #33 `DELETE /api/admin/threads/:id`

删除主题及其所有帖子。

**成功响应（200）**：`{ data: { deleted: true, id, postsDeleted } }`

**副作用**：删除所有帖子 → 删除主题 → 版块计数递减。

---

#### #34 `POST /api/admin/threads/batch-delete`

批量删除主题。

**请求体**：`{ ids: number[] }` — 非空，≤ 100。

**成功响应（200）**：`{ data: { deleted: true, count } }`

---

#### #35 `POST /api/admin/threads/batch-move`

批量移动主题到指定版块。

**请求体**：`{ ids: number[], forumId: number }` — `ids` ≤ 100，目标版块必须存在。

**成功响应（200）**：`{ data: { moved: true, count, forumId } }`

**副作用**：对每个主题执行与 #32（forumId 字段）相同的 move 逻辑。

---

### C. Post 帖子（Admin）— #36-#40

#### #36 `GET /api/admin/posts`

获取帖子列表（偏移分页）。

| 属性 | 值 |
|------|---|
| 认证 | Key B |
| 分页 | 偏移分页 |

**筛选参数：**

| 参数 | 类型 | 匹配方式 |
|------|------|----------|
| `threadId` | integer | 精确 |
| `authorId` | integer | 精确 |
| `authorName` | string | LIKE |
| `content` | string | LIKE |
| `sort` | string | 排序：`position_asc`（楼层升序）。默认 `id DESC` |

---

#### #37 `GET /api/admin/posts/:id`

获取单个帖子详情。

---

#### #38 `PATCH /api/admin/posts/:id`

编辑帖子内容。

| 属性 | 值 |
|------|---|
| 认证 | Key B |

**请求体**：`{ content: string }` — 非空。

**成功响应（200）**：`{ data: Post, meta }`

---

#### #39 `DELETE /api/admin/posts/:id`

删除帖子。**不能删除主楼**（`is_first=1`）。

| 错误 | 说明 |
|------|------|
| `CANNOT_DELETE_FIRST_POST`(400) | 需删除整个主题 |

**副作用**：主题 `replies-1`，版块 `posts-1`。

---

#### #40 `POST /api/admin/posts/batch-delete`

批量删除帖子。

**请求体**：`{ ids: number[] }` — ≤ 100。

**成功响应（200）**：`{ data: { deleted: true, count, skipped: number[] } }`

> 主楼帖子被**静默跳过**，出现在 `skipped` 数组中。

---

### D. User 用户（Admin）— #41-#48

> **认证说明**：Admin 端点仅通过 Key B 验证，Worker 不感知操作者身份，因此无自操作保护。如需防止误操作（如封禁自己），应在 Next.js 代理层实现。

#### #41 `GET /api/admin/users`

获取用户列表（偏移分页）。

| 属性 | 值 |
|------|---|
| 认证 | Key B |
| 分页 | 偏移分页 |

**筛选参数：**

| 参数 | 类型 | 匹配方式 |
|------|------|----------|
| `username` | string | LIKE |
| `email` | string | LIKE |
| `status` | integer | 精确 |
| `role` | integer | 精确 |

---

#### #42 `GET /api/admin/users/:id`

获取单个用户详情。

---

#### #43 `PATCH /api/admin/users/:id`

更新用户属性。**统一的属性修改端点** — 合并了 status/role/credits/profile 编辑。

| 属性 | 值 |
|------|---|
| 认证 | Key B |

**可更新字段：**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `username` | string | 非空，≤ 50 字符，不能重名 | 用户名 |
| `email` | string | 含 `@`，≤ 255 字符 | 邮箱 |
| `avatar` | string | — | 头像 |
| `status` | number | 0, -1, -2 | 状态 |
| `role` | number | 0-3 | 角色 |
| `credits` | number | 整数 | 积分（直接设置绝对值） |

至少提供一个字段。

**成功响应（200）**：`{ data: AdminUser, meta }`

| 错误码 | 状态 | 触发条件 |
|--------|------|---------|
| `USERNAME_TAKEN` | 409 | 用户名已被占用 |
| `USER_NOT_FOUND` | 404 | 用户不存在 |

---

#### #44 `POST /api/admin/users/:id/ban`

封禁用户（可选删除其所有内容）。

**请求体（可选）**：`{ deleteContent?: boolean }`

**成功响应（200）— 不删除内容：**
```json
{ "data": { "banned": true, "id": 42, "contentDeleted": false } }
```

**成功响应（200）— 删除内容：**
```json
{ "data": { "banned": true, "id": 42, "contentDeleted": true, "threadsDeleted": 10, "postsDeleted": 150 } }
```

**`deleteContent: true` 的副作用：**
- 设置 `status = -1`，清零 `threads` / `posts`
- 删除用户的所有主题及帖子
- 删除用户在其他主题的回复
- 递减受影响主题/版块的计数

**错误**：`USER_NOT_FOUND`(404)

---

#### #45 `POST /api/admin/users/:id/nuke`

核弹操作 — 封禁 + 删除所有内容 + 清零积分。

**请求体**：无

**成功响应（200）：**
```json
{ "data": { "nuked": true, "id": 42, "threadsDeleted": 10, "postsDeleted": 150 } }
```

**副作用**：与 `ban(deleteContent: true)` 相同，额外清零 `credits`。

---

#### #46 `POST /api/admin/users/batch-status`

批量设置用户状态。

**请求体**：`{ ids: number[], status: number }` — `ids` ≤ 100，`status` ∈ {0, -1, -2}。

**成功响应（200）**：`{ data: { updated: true, count } }`

---

#### #47 `POST /api/admin/users/batch-role`

批量设置用户角色。

**请求体**：`{ ids: number[], role: number }` — `ids` ≤ 100，`role` ∈ {0, 1, 2, 3}。

**成功响应（200）**：`{ data: { updated: true, count } }`

---

#### #48 `GET /api/admin/users/batch`

批量获取用户信息。

| 属性 | 值 |
|------|---|
| 认证 | Key B |

**查询参数：**

| 参数 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `ids` | string | 是 | 逗号分隔的用户 ID（如 `1,2,3`），最多 100 个 |

**成功响应（200）**：`{ data: AdminUser[], meta }`

> 返回 AdminUser 数组，不存在的 ID 静默忽略。

---

### E. Attachment 附件（Admin）— #49-#52

#### #49 `GET /api/admin/attachments`

获取附件列表（偏移分页）。

| 属性 | 值 |
|------|---|
| 认证 | Key B |
| 分页 | 偏移分页 |

**筛选参数：**

| 参数 | 类型 | 匹配方式 |
|------|------|----------|
| `postId` | integer | 精确 |
| `threadId` | integer | 精确 |
| `authorId` | integer | 精确 |
| `isImage` | boolean | 精确（`"true"`/`"1"` 或 `"false"`/`"0"`） |

---

#### #50 `GET /api/admin/attachments/:id`

获取单个附件详情。

---

#### #51 `DELETE /api/admin/attachments/:id`

删除附件元数据记录。

> 仅删除 D1 记录，不删除实际存储文件。

---

#### #52 `POST /api/admin/attachments/batch-delete`

批量删除附件元数据。

**请求体**：`{ ids: number[] }` — `ids` ≤ 100。

**成功响应（200）**：`{ data: { deleted: true, count: 5 } }`

---

### F. IpBan IP 封禁（Admin）— #53-#59

> **需要新建表**：
> ```sql
> CREATE TABLE IF NOT EXISTS ip_bans (
>   id INTEGER PRIMARY KEY AUTOINCREMENT,
>   ip TEXT NOT NULL,
>   admin_id INTEGER NOT NULL,
>   admin_name TEXT NOT NULL DEFAULT '',
>   reason TEXT NOT NULL DEFAULT '',
>   expires_at INTEGER,
>   created_at INTEGER NOT NULL
> );
> CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_bans_ip ON ip_bans(ip);
> ```

#### #53 `GET /api/admin/ip-bans`

获取 IP 封禁列表（偏移分页）。

| 属性 | 值 |
|------|---|
| 认证 | Key B |
| 分页 | 偏移分页 |

**筛选参数：**

| 参数 | 类型 | 匹配方式 |
|------|------|----------|
| `ip` | string | LIKE |
| `expired` | string | `"true"` 含已过期，默认仅有效 |

---

#### #54 `GET /api/admin/ip-bans/:id`

获取单条 IP 封禁详情。

---

#### #55 `POST /api/admin/ip-bans`

添加 IP 封禁规则。

**请求体：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `ip` | string | 是 | IPv4 / CIDR / 通配符（如 `1.2.3.4`、`192.168.0.0/24`、`10.0.*.*`） |
| `reason` | string | 否 | — |
| `expiresAt` | number \| null | 否 | Unix 秒，省略/null 为永久 |

**成功响应（201）**：`{ data: IpBan, meta }`

**错误**：`IP_BAN_SELF`(400)、`IP_BAN_DUPLICATE`(409)

---

#### #56 `PATCH /api/admin/ip-bans/:id`

修改封禁规则。

**可更新字段**：`reason`, `expiresAt`（null 改为永久）— 至少提供一个。

---

#### #57 `DELETE /api/admin/ip-bans/:id`

删除封禁规则（解封）。

---

#### #58 `POST /api/admin/ip-bans/batch-delete`

批量删除 IP 封禁规则（批量解封）。

**请求体**：`{ ids: number[] }` — `ids` ≤ 100。

**成功响应（200）**：`{ data: { deleted: true, count: 3 } }`

---

#### #59 `GET /api/admin/ip-bans/check-ip`

检查指定 IP 是否命中封禁规则。

**查询参数**：`ip` — 必填，IPv4 地址。

**成功响应（200）— 命中**：`{ data: { banned: true, matchedRule: IpBan } }`

**成功响应（200）— 未命中**：`{ data: { banned: false } }`

> 匹配逻辑：精确 → CIDR → 通配符，返回第一条命中的有效规则。

---

### G. CensorWord 敏感词（Admin）— #60-#66

> **需要新建表**：
> ```sql
> CREATE TABLE IF NOT EXISTS censor_words (
>   id INTEGER PRIMARY KEY AUTOINCREMENT,
>   find TEXT NOT NULL,
>   replacement TEXT NOT NULL DEFAULT '**',
>   action TEXT NOT NULL DEFAULT 'replace' CHECK(action IN ('ban', 'replace')),
>   admin_id INTEGER NOT NULL,
>   admin_name TEXT NOT NULL DEFAULT '',
>   created_at INTEGER NOT NULL
> );
> CREATE UNIQUE INDEX IF NOT EXISTS idx_censor_words_find ON censor_words(find);
> ```
>
> **匹配规则**：纯文本 → 大小写不敏感子串匹配；以 `/` 包裹 → 正则。最短 2 字符。
>
> **动作**：`ban` = 403 拦截，`replace` = 静默替换。
>
> **运行时集成**：`POST /api/v1/threads`（#6）和 `POST /api/v1/posts`（#9）发帖前自动检查。

#### #60 `GET /api/admin/censor-words`

获取敏感词列表（偏移分页）。

| 属性 | 值 |
|------|---|
| 认证 | Key B |
| 分页 | 偏移分页 |

**筛选参数：**

| 参数 | 类型 | 匹配方式 |
|------|------|----------|
| `find` | string | LIKE |
| `action` | string | 精确（`"ban"` / `"replace"`） |

---

#### #61 `GET /api/admin/censor-words/:id`

获取单条敏感词详情。

---

#### #62 `POST /api/admin/censor-words`

添加敏感词规则。

**请求体：**

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `find` | string | 是 | 纯文本（≥ 2 字符）或正则（`/pattern/`） |
| `replacement` | string | 否 | 默认 `"**"`，`action=ban` 时忽略 |
| `action` | string | 否 | `"ban"` / `"replace"`，默认 `"replace"` |

**成功响应（201）**：`{ data: CensorWord, meta }`

**错误**：`CENSOR_WORD_INVALID`(400)、`CENSOR_WORD_DUPLICATE`(409)

---

#### #63 `PATCH /api/admin/censor-words/:id`

修改敏感词规则。

**可更新字段**：`find`, `replacement`, `action` — 至少提供一个。

**错误**：`CENSOR_WORD_INVALID`(400)、`CENSOR_WORD_DUPLICATE`(409)

---

#### #64 `DELETE /api/admin/censor-words/:id`

删除敏感词规则。

---

#### #65 `POST /api/admin/censor-words/batch-delete`

批量删除敏感词规则。

**请求体**：`{ ids: number[] }` — `ids` ≤ 100。

**成功响应（200）**：`{ data: { deleted: true, count: 5 } }`

---

#### #66 `POST /api/admin/censor-words/test`

测试文本命中情况（不执行实际过滤）。

**请求体**：`{ content: string }`

**成功响应（200）— 命中 ban**：
```json
{
  "data": {
    "matched": true,
    "action": "ban",
    "matches": [
      {
        "word": { "id": 1, "find": "违禁词", "replacement": "**", "action": "ban" },
        "found": "违禁词"
      }
    ],
    "filtered": null
  }
}
```

**成功响应（200）— 命中 replace**：
```json
{
  "data": {
    "matched": true,
    "action": "replace",
    "matches": [
      {
        "word": { "id": 2, "find": "敏感词", "replacement": "***", "action": "replace" },
        "found": "敏感词"
      }
    ],
    "filtered": "这是***替换后的文本"
  }
}
```

**成功响应（200）— 无命中**：
```json
{
  "data": { "matched": false, "action": null, "matches": [], "filtered": null }
}
```

> `ban` 优先于 `replace`。同时命中时返回 `action: "ban"`。

---

### H. Stats 站点统计（Admin）— #67

#### #67 `GET /api/admin/stats`

获取站点统计概览（Dashboard 数据）。

| 属性 | 值 |
|------|---|
| 认证 | Key B |

**成功响应（200）：**
```json
{
  "data": {
    "users": { "total": 5000, "today": 12, "banned": 35 },
    "threads": { "total": 10000, "today": 45 },
    "posts": { "total": 120000, "today": 230 },
    "forums": { "total": 20, "hidden": 2 }
  }
}
```

> `today` 基于 UTC 当天 00:00 起的 `created_at` / `reg_date`。

---

## 附录

### CORS 配置

允许的来源：
- `https://ellie.nocoo.cloud`
- `https://ellie.worker.hexly.ai`
- `http://localhost:3000`

允许的请求头：`Content-Type`, `Authorization`, `X-API-Key`

允许的方法：`GET`, `POST`, `PATCH`, `DELETE`, `OPTIONS`

`OPTIONS` 预检请求返回 `204 No Content`，`Access-Control-Max-Age: 86400`。

### 全局异常处理

路由器级别的兜底错误（未匹配路由、未捕获异常）使用与业务端点相同的 `{ error: { code, message, details } }` 结构。

#### 文档协议（目标格式）

**未匹配的路由（404）：**
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found",
    "details": { "path": "/the/requested/path" }
  }
}
```

**未捕获的异常（500）：**
```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error",
    "details": { "message": "<error.message>" }
  }
}
```

### 接口总览表

#### 公开端点（#1-#22）

| # | 方法 | 路径 | 认证 | 分页 |
|---|------|------|------|------|
| 1 | `GET` | `/api/live` | 无 | — |
| 2 | `GET` | `/api/v1/forums` | Key A | 无 |
| 3 | `GET` | `/api/v1/forums/:id` | Key A | — |
| 4 | `GET` | `/api/v1/threads` | Key A | 游标 |
| 5 | `GET` | `/api/v1/threads/:id` | Key A | — |
| 6 | `POST` | `/api/v1/threads` | Key A + 论坛 JWT | — |
| 7 | `GET` | `/api/v1/posts` | Key A | 游标 |
| 8 | `GET` | `/api/v1/posts/:id` | Key A | — |
| 9 | `POST` | `/api/v1/posts` | Key A + 论坛 JWT | — |
| 10 | `GET` | `/api/v1/posts/:id/attachments` | Key A | 无 |
| 11 | `GET` | `/api/v1/users/:id` | Key A | — |
| 12 | `POST` | `/api/v1/auth/login` | Key A | — |
| 13 | `POST` | `/api/v1/auth/refresh` | Key A | — |
| 14 | `DELETE` | `/api/v1/auth/logout` | Key A | — |
| 15 | `GET` | `/api/v1/auth/me` | Key A + 论坛 JWT | — |
| 16 | `PATCH` | `/api/v1/users/me` | Key A + 论坛 JWT | — |
| 17 | `POST` | `/api/v1/users/me/password` | Key A + 论坛 JWT | — |
| 18 | `PATCH` | `/api/v1/moderation/threads/:id/sticky` | Key A + 论坛 JWT (Mod+) | — |
| 19 | `PATCH` | `/api/v1/moderation/threads/:id/digest` | Key A + 论坛 JWT (Mod+) | — |
| 20 | `PATCH` | `/api/v1/moderation/threads/:id/close` | Key A + 论坛 JWT (Mod+) | — |
| 21 | `PATCH` | `/api/v1/moderation/threads/:id/move` | Key A + 论坛 JWT (Mod+) | — |
| 22 | `DELETE` | `/api/v1/moderation/posts/:id` | Key A + 论坛 JWT (Mod+) | — |

#### 管理端点（#23-#67）— 按实体分组

| # | 方法 | 路径 | 实体 | 认证 | 操作 |
|---|------|------|------|------|------|
| 23 | `GET` | `/api/admin/forums` | Forum | Key B | list |
| 24 | `GET` | `/api/admin/forums/:id` | Forum | Key B | get |
| 25 | `POST` | `/api/admin/forums` | Forum | Key B | create |
| 26 | `PATCH` | `/api/admin/forums/:id` | Forum | Key B | update |
| 27 | `DELETE` | `/api/admin/forums/:id` | Forum | Key B | delete |
| 28 | `POST` | `/api/admin/forums/:id/merge` | Forum | Key B | merge |
| 29 | `POST` | `/api/admin/forums/reorder` | Forum | Key B | reorder |
| 30 | `GET` | `/api/admin/threads` | Thread | Key B | list |
| 31 | `GET` | `/api/admin/threads/:id` | Thread | Key B | get |
| 32 | `PATCH` | `/api/admin/threads/:id` | Thread | Key B | update *(含 sticky/digest/close/highlight/move)* |
| 33 | `DELETE` | `/api/admin/threads/:id` | Thread | Key B | delete |
| 34 | `POST` | `/api/admin/threads/batch-delete` | Thread | Key B | batch-delete |
| 35 | `POST` | `/api/admin/threads/batch-move` | Thread | Key B | batch-move |
| 36 | `GET` | `/api/admin/posts` | Post | Key B | list |
| 37 | `GET` | `/api/admin/posts/:id` | Post | Key B | get |
| 38 | `PATCH` | `/api/admin/posts/:id` | Post | Key B | update |
| 39 | `DELETE` | `/api/admin/posts/:id` | Post | Key B | delete |
| 40 | `POST` | `/api/admin/posts/batch-delete` | Post | Key B | batch-delete |
| 41 | `GET` | `/api/admin/users` | User | Key B | list |
| 42 | `GET` | `/api/admin/users/:id` | User | Key B | get |
| 43 | `PATCH` | `/api/admin/users/:id` | User | Key B | update *(含 status/role/credits/profile)* |
| 44 | `POST` | `/api/admin/users/:id/ban` | User | Key B | ban |
| 45 | `POST` | `/api/admin/users/:id/nuke` | User | Key B | nuke |
| 46 | `POST` | `/api/admin/users/batch-status` | User | Key B | batch-status |
| 47 | `POST` | `/api/admin/users/batch-role` | User | Key B | batch-role |
| 48 | `GET` | `/api/admin/users/batch` | User | Key B | batch-fetch |
| 49 | `GET` | `/api/admin/attachments` | Attachment | Key B | list |
| 50 | `GET` | `/api/admin/attachments/:id` | Attachment | Key B | get |
| 51 | `DELETE` | `/api/admin/attachments/:id` | Attachment | Key B | delete |
| 52 | `POST` | `/api/admin/attachments/batch-delete` | Attachment | Key B | batch-delete |
| 53 | `GET` | `/api/admin/ip-bans` | IpBan | Key B | list |
| 54 | `GET` | `/api/admin/ip-bans/:id` | IpBan | Key B | get |
| 55 | `POST` | `/api/admin/ip-bans` | IpBan | Key B | create |
| 56 | `PATCH` | `/api/admin/ip-bans/:id` | IpBan | Key B | update |
| 57 | `DELETE` | `/api/admin/ip-bans/:id` | IpBan | Key B | delete |
| 58 | `POST` | `/api/admin/ip-bans/batch-delete` | IpBan | Key B | batch-delete |
| 59 | `GET` | `/api/admin/ip-bans/check-ip` | IpBan | Key B | check |
| 60 | `GET` | `/api/admin/censor-words` | CensorWord | Key B | list |
| 61 | `GET` | `/api/admin/censor-words/:id` | CensorWord | Key B | get |
| 62 | `POST` | `/api/admin/censor-words` | CensorWord | Key B | create |
| 63 | `PATCH` | `/api/admin/censor-words/:id` | CensorWord | Key B | update |
| 64 | `DELETE` | `/api/admin/censor-words/:id` | CensorWord | Key B | delete |
| 65 | `POST` | `/api/admin/censor-words/batch-delete` | CensorWord | Key B | batch-delete |
| 66 | `POST` | `/api/admin/censor-words/test` | CensorWord | Key B | test |
| 67 | `GET` | `/api/admin/stats` | Stats | Key B | get |

**共计：67 个端点** = 22 公开（Key A）+ 45 管理（Key B）

### 测试原则

#### 分层架构与覆盖率目标

| 层 | 范围 | 覆盖率 | 说明 |
|----|------|--------|------|
| **Core CRUD 框架** | `lib/crud.ts` `lib/adminHelpers.ts` | **100%** | 所有实体共享的基础设施，一个 bug 影响全部实体 |
| **实体扩展** | `handlers/admin/*.ts` 中的 `EntityConfig` + 自定义逻辑 | **≥ 95%** | 每个实体的配置、filter、beforeUpdate/beforeDelete hook |
| **公共 handler** | `handlers/*.ts`（非 admin） | **≥ 95%** | 用户可见端点 |
| **Middleware** | `middleware/*.ts` | **100%** | 认证、鉴权、CORS、错误处理 |
| **共享 lib** | `lib/response.ts` `lib/mappers.ts` `lib/parseId.ts` 等 | **100%** | 纯函数，易测试 |

#### Core CRUD 框架（100%）

核心 CRUD 是所有实体的底座。以下场景必须全覆盖：

| 模块 | 必测场景 |
|------|---------|
| `createListHandler` | 无 filter 分页 · 单 filter · 多 filter 组合 · like 模糊搜索 · sort 参数 · 空结果 · 参数类型错误 |
| `createGetByIdHandler` | 正常获取 · 不存在返回 404 · ID 非法返回 400 |
| `createCreateHandler` | 全部 required 字段 · 缺少 required → 400 · default 值填充 · validate 失败 → 400 · beforeCreate hook 返回 error · 唯一约束冲突 → 409 |
| `createUpdateHandler` | 单字段更新 · 多字段同时更新 · 空 body → 400 · 无有效字段 → 400 · beforeUpdate hook 返回 error · 不存在 → 404 |
| `createRemoveHandler` | 正常删除 · 不存在 → 404 · beforeDelete hook 拦截 · afterDelete hook 执行 · canDelete=false 时 405 |
| `parseBody` | 合法 JSON · 空 body · 非 JSON Content-Type · 超大 body |
| `parsePagination` | 默认值 · 自定义 page/limit · 非法值降级为默认 · limit 上限 |
| `buildWhere` | 无 filter → 空 WHERE · eq/like/gte/lte 各 type · int cast · 多条件 AND |
| `requireEntity` | 存在 → 返回 row · 不存在 → throw |

#### 实体扩展（≥ 95%）

每个实体只需测试其**特有逻辑**，通用 CRUD 行为由框架测试覆盖：

| 实体 | 特有逻辑测试点 |
|------|---------------|
| **Forum** | merge（帖子迁移 + 计数更新 + 源论坛删除）· reorder（批量 display_order 更新）· delete 前检查是否有帖子 |
| **Thread** | unified PATCH（sticky/digest/closed/highlight 各属性独立和组合更新）· forumId 变更触发 move（计数增减）· delete cascade（级联删除 posts）· batch-delete · batch-move |
| **Post** | delete guard（禁止删除主题首帖）· batch-delete · 删除后 thread reply_count 更新 |
| **User** | unified PATCH（status/role/credits/profile 各属性组合更新）· self-protect（不能修改自己的 status/role）· ban（可选 deleteContent）· nuke（ban + 清空内容 + credits 归零）· batch-status · batch-role |
| **Attachment** | list filter（postId/threadId/authorId/isImage）· delete 元数据清除 |
| **IpBan** | create 唯一约束 · check 精确匹配 · check CIDR 匹配 · check 通配符匹配 · 过期 ban 不生效 |
| **CensorWord** | create 唯一约束 · test `replace` action（替换为 replacement）· test `ban` action（返回 matched=true）· test 正则模式 · test 多规则按序应用 |

#### 测试规范

**命名约定**：`describe("{Entity} admin")` → `it("should {verb} when {condition}")`

**测试隔离**：每个 `describe` block 独立初始化 mock D1，测试间不共享状态。

**Mock 策略**：
- D1 数据库：使用 `miniflare` 或内存 mock
- KV Store：内存 mock
- 认证中间件：每个 admin 测试注入已认证的 admin/mod context

**禁止 skip**：所有测试必须执行。暂时无法实现的测试用 `it.todo()` 标记，不使用 `it.skip()`。

**运行命令**：
```bash
# 全部 worker 单元测试
bun test apps/worker

# 单实体测试
bun test apps/worker/tests/unit/handlers/admin/forum.test.ts

# 覆盖率报告
bun test apps/worker --coverage
```
