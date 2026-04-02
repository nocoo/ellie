# 09 用户信息缓存重构

## 背景与问题

### 当前问题

数据库多处存储了**冗余用户名**而非仅存用户 ID：

| 表 | 字段 | 用途 | 是否有对应 ID 字段 |
|---|---|---|---|
| `forums` | `last_poster` | 最后发帖人用户名 | ❌ 缺少 `last_poster_id` |
| `threads` | `author_name` | 发帖人用户名 | ✅ 有 `author_id` |
| `threads` | `last_poster` | 最后回复人用户名 | ❌ 缺少 `last_poster_id` |
| `posts` | `author_name` | 发帖人用户名 | ✅ 有 `author_id` |
| `ip_bans` | `admin_name` | 操作管理员用户名 | ✅ 有 `admin_id` |
| `censor_words` | `admin_name` | 操作管理员用户名 | ✅ 有 `admin_id` |

### 问题影响

1. **用户改名后数据过时** — 用户更改用户名后，历史记录中的用户名不会更新
2. **无法点击跳转** — 只有用户名没有 ID，前端无法实现点击跳转到用户主页
3. **数据不一致** — 同一用户在不同位置可能显示不同的用户名

---

## 设计方案

### 核心思路

**数据库只存 ID，用户名通过 KV 缓存批量获取**

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   数据库    │     │   KV 缓存   │     │   用户表    │
│  (只存 ID)  │ ──> │ (用户信息)  │ <── │   (源)     │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          ▼
                    ┌─────────────┐
                    │  API 响应   │
                    │ (ID + Name) │
                    └─────────────┘
```

### KV 缓存结构

```typescript
// Key 格式
const KEY_PREFIX = "user:mini:";
const key = `${KEY_PREFIX}${userId}`;  // e.g., "user:mini:12345"

// Value 结构
interface UserMiniProfile {
  id: number;
  username: string;
  avatar: string;
  role: number;
  groupTitle: string;
  groupColor: string;
  groupStars: number;
}

// TTL
const USER_CACHE_TTL = 86400; // 24 hours
```

### 缓存失效策略

| 触发事件 | 触发位置 | 操作 |
|----------|----------|------|
| 管理员改用户名 | `admin/user.ts` afterUpdate | `invalidateUserCache(userId)` |
| 管理员改用户头像 | `admin/user.ts` afterUpdate | `invalidateUserCache(userId)` |
| 管理员改用户组/角色 | `admin/user.ts` afterUpdate | `invalidateUserCache(userId)` |
| 用户自助改头像 | `me.ts` 更新成功后 | `invalidateUserCache(userId)` |

> **注意**：当前 `me.ts` 只允许修改 `email` 和 `avatar`，不允许改 `username`。用户名只能通过管理后台修改。

---

## 数据库改动

### 新增字段

```sql
-- forums 表：添加最后发帖人 ID
ALTER TABLE forums ADD COLUMN last_poster_id INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_forums_last_poster_id ON forums(last_poster_id);

-- threads 表：添加最后回复人 ID
ALTER TABLE threads ADD COLUMN last_poster_id INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_threads_last_poster_id ON threads(last_poster_id);
```

### 保留字段（Phase 1 暂不删除）

以下字段暂时保留，待新方案稳定后再考虑移除：

- `forums.last_poster` — 保留作为备用
- `threads.author_name` — 保留作为备用
- `threads.last_poster` — 保留作为备用
- `posts.author_name` — 保留作为备用
- `ip_bans.admin_name` — 保留作为备用
- `censor_words.admin_name` — 保留作为备用

### 迁移脚本

```sql
-- Migration: 0012_add_poster_ids.sql

-- Step 1: Add new columns
ALTER TABLE forums ADD COLUMN last_poster_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads ADD COLUMN last_poster_id INTEGER NOT NULL DEFAULT 0;

-- Step 2: Create indexes
CREATE INDEX IF NOT EXISTS idx_forums_last_poster_id ON forums(last_poster_id);
CREATE INDEX IF NOT EXISTS idx_threads_last_poster_id ON threads(last_poster_id);

-- Step 3: Data will be populated via recalcForums/recalcThreads
```

---

## 代码改动

### 1. 新增文件

| 文件 | 说明 |
|------|------|
| `apps/worker/src/lib/user-cache.ts` | KV 用户缓存操作封装 |

### 2. 修改文件 — 读路径

| 文件 | 改动 |
|------|------|
| `packages/db/src/schema.ts` | 添加 `last_poster_id` 字段定义 |
| `packages/types/src/types.ts` | 添加 `lastPosterId` 字段到 `Forum`/`Thread` 类型 |
| `apps/worker/src/handlers/forum.ts` | 查询时使用 KV 批量获取用户信息 |
| `apps/worker/src/handlers/thread.ts` | **list()** 查询时使用 KV 批量获取用户信息；**getById()** 使用 KV 获取 authorName |
| `apps/worker/src/lib/mappers.ts` | 更新 mapper 支持新字段 |

### 3. 修改文件 — 写路径（关键！）

| 文件 | 改动 |
|------|------|
| `apps/worker/src/handlers/thread.ts` | **create()** 写入 `last_poster_id` 到 threads 和 forums |
| `apps/worker/src/handlers/post.ts` | **create()** 写入 `last_poster_id` 到 threads 和 forums |
| `apps/worker/src/lib/recalcMetadata.ts` | **recalcForumMetadata()** 和 **recalcThreadMetadata()** 更新 `last_poster_id` |
| `apps/worker/src/handlers/admin/statistics.ts` | **recalcForums()** 和 **recalcThreads()** 填充 `last_poster_id` |

### 4. 修改文件 — 缓存失效

| 文件 | 改动 |
|------|------|
| `apps/worker/src/handlers/admin/user.ts` | **update()** 添加 afterUpdate 钩子，用户名/头像/角色变更时失效缓存 |
| `apps/worker/src/handlers/me.ts` | 头像更新成功后失效缓存 |

---

## 实现细节

### user-cache.ts

```typescript
// apps/worker/src/lib/user-cache.ts

import type { Env } from "./env";

const USER_CACHE_PREFIX = "user:mini:";
const USER_CACHE_TTL = 86400; // 24h

export interface UserMiniProfile {
  id: number;
  username: string;
  avatar: string;
  role: number;
  groupTitle: string;
  groupColor: string;
  groupStars: number;
}

/**
 * Batch get user profiles from KV cache, with DB fallback for cache misses.
 * Uses ctx.waitUntil for non-blocking cache population.
 */
export async function getUserProfiles(
  env: Env,
  ctx: ExecutionContext,
  userIds: number[],
): Promise<Map<number, UserMiniProfile>> {
  const result = new Map<number, UserMiniProfile>();
  if (userIds.length === 0) return result;

  // Deduplicate and filter invalid IDs
  const uniqueIds = [...new Set(userIds)].filter((id) => id > 0);
  if (uniqueIds.length === 0) return result;

  // Parallel KV reads
  const cacheResults = await Promise.all(
    uniqueIds.map(async (id) => ({
      id,
      data: await env.KV.get<UserMiniProfile>(`${USER_CACHE_PREFIX}${id}`, "json"),
    })),
  );

  // Separate hits and misses
  const missedIds: number[] = [];
  for (const { id, data } of cacheResults) {
    if (data) {
      result.set(id, data);
    } else {
      missedIds.push(id);
    }
  }

  // DB fallback for cache misses
  if (missedIds.length > 0) {
    const placeholders = missedIds.map(() => "?").join(",");
    const dbResult = await env.DB.prepare(
      `SELECT id, username, avatar, role, group_title, group_color, group_stars
       FROM users WHERE id IN (${placeholders})`,
    )
      .bind(...missedIds)
      .all();

    for (const row of dbResult.results) {
      const profile: UserMiniProfile = {
        id: row.id as number,
        username: row.username as string,
        avatar: row.avatar as string,
        role: row.role as number,
        groupTitle: row.group_title as string,
        groupColor: row.group_color as string,
        groupStars: row.group_stars as number,
      };
      result.set(profile.id, profile);

      // Non-blocking cache population
      ctx.waitUntil(
        env.KV.put(`${USER_CACHE_PREFIX}${profile.id}`, JSON.stringify(profile), {
          expirationTtl: USER_CACHE_TTL,
        }),
      );
    }
  }

  return result;
}

/**
 * Invalidate user cache when profile changes.
 */
export async function invalidateUserCache(env: Env, userId: number): Promise<void> {
  await env.KV.delete(`${USER_CACHE_PREFIX}${userId}`);
}

/**
 * Batch invalidate user caches.
 */
export async function invalidateUserCaches(env: Env, userIds: number[]): Promise<void> {
  await Promise.all(userIds.map((id) => env.KV.delete(`${USER_CACHE_PREFIX}${id}`)));
}
```

### 写路径改动 — thread.ts create()

```typescript
// apps/worker/src/handlers/thread.ts - create()

// Step 1: Insert thread (写入 last_poster_id = user.userId)
const threadResult = await env.DB.prepare(
  `INSERT INTO threads (forum_id, author_id, author_name, subject, created_at, 
   last_post_at, last_poster, last_poster_id, replies, views, closed, sticky, digest) 
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`,
)
  .bind(forumId, user.userId, authorName, filteredSubject, now, now, authorName, user.userId)
  .run();

// Step 2: Update forum (写入 last_poster_id)
env.DB.prepare(
  `UPDATE forums SET threads = threads + 1, posts = posts + 1, 
   last_thread_id = ?, last_post_at = ?, last_poster = ?, last_poster_id = ?, 
   last_thread_subject = ? WHERE id = ?`,
).bind(threadId, now, authorName, user.userId, filteredSubject, forumId),
```

### 写路径改动 — post.ts create()

```typescript
// apps/worker/src/handlers/post.ts - create()

// Batch update counts (写入 last_poster_id)
await env.DB.batch([
  env.DB.prepare(
    `UPDATE threads SET replies = replies + 1, last_post_at = ?, 
     last_poster = ?, last_poster_id = ? WHERE id = ?`,
  ).bind(now, authorName, user.userId, threadId),
  env.DB.prepare(
    `UPDATE forums SET posts = posts + 1, last_post_at = ?, 
     last_poster = ?, last_poster_id = ? WHERE id = ?`,
  ).bind(now, authorName, user.userId, thread.forum_id),
  // ...
]);
```

### 写路径改动 — recalcMetadata.ts

```typescript
// apps/worker/src/lib/recalcMetadata.ts

export async function recalcForumMetadata(env: Env, forumId: number): Promise<void> {
  // 查询时获取 last_poster_id
  const lastThread = await env.DB.prepare(
    `SELECT id, subject, last_post_at, last_poster, last_poster_id 
     FROM threads WHERE forum_id = ? ORDER BY last_post_at DESC LIMIT 1`,
  )
    .bind(forumId)
    .first<{ id: number; subject: string; last_post_at: number; last_poster: string; last_poster_id: number }>();

  // 更新时写入 last_poster_id
  await env.DB.prepare(
    `UPDATE forums SET last_thread_id = ?, last_post_at = ?, 
     last_poster = ?, last_poster_id = ?, last_thread_subject = ? WHERE id = ?`,
  )
    .bind(
      lastThread?.id ?? 0,
      lastThread?.last_post_at ?? 0,
      lastThread?.last_poster ?? "",
      lastThread?.last_poster_id ?? 0,
      lastThread?.subject ?? "",
      forumId,
    )
    .run();
}

export async function recalcThreadMetadata(env: Env, threadId: number): Promise<void> {
  // 查询时获取 author_id
  const lastPost = await env.DB.prepare(
    `SELECT created_at, author_name, author_id 
     FROM posts WHERE thread_id = ? ORDER BY position DESC LIMIT 1`,
  )
    .bind(threadId)
    .first<{ created_at: number; author_name: string; author_id: number }>();

  if (lastPost) {
    await env.DB.prepare(
      `UPDATE threads SET last_post_at = ?, last_poster = ?, last_poster_id = ? WHERE id = ?`,
    )
      .bind(lastPost.created_at, lastPost.author_name, lastPost.author_id, threadId)
      .run();
  } else {
    // No posts remain — fall back to thread's own creation info
    const thread = await env.DB.prepare(
      `SELECT created_at, author_name, author_id FROM threads WHERE id = ?`,
    )
      .bind(threadId)
      .first<{ created_at: number; author_name: string; author_id: number }>();
    if (thread) {
      await env.DB.prepare(
        `UPDATE threads SET last_post_at = ?, last_poster = ?, last_poster_id = ? WHERE id = ?`,
      )
        .bind(thread.created_at, thread.author_name, thread.author_id, threadId)
        .run();
    }
  }
}
```

### 读路径改动 — forum.ts list()

```typescript
// apps/worker/src/handlers/forum.ts - list()

export async function list(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // 1. Query forums (包含 last_poster_id)
  const forums = await env.DB.prepare(`
    SELECT id, parent_id, name, description, icon, display_order, 
           threads, posts, type, status, moderators,
           last_thread_id, last_post_at, last_poster_id, last_thread_subject
    FROM forums WHERE status > 0 ORDER BY display_order
  `).all();

  // 2. Collect all user IDs that need resolution
  const userIds = new Set<number>();
  for (const forum of forums.results) {
    if ((forum.last_poster_id as number) > 0) {
      userIds.add(forum.last_poster_id as number);
    }
  }

  // 3. Batch fetch user profiles from KV
  const userMap = await getUserProfiles(env, ctx, Array.from(userIds));

  // 4. Map results with resolved usernames
  const data = forums.results.map((row) => {
    const lastPosterProfile = userMap.get(row.last_poster_id as number);
    return {
      ...toForum(row),
      lastPoster: lastPosterProfile?.username ?? "",
      lastPosterAvatar: lastPosterProfile?.avatar ?? "",
    };
  });

  return jsonResponse(data, origin);
}
```

### 读路径改动 — thread.ts getById()

```typescript
// apps/worker/src/handlers/thread.ts - getById()

export async function getById(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // ... 获取 thread 数据
  
  // 通过 KV 获取作者信息
  const userMap = await getUserProfiles(env, ctx, [thread.author_id as number]);
  const authorProfile = userMap.get(thread.author_id as number);
  
  return jsonResponse({
    ...toThread(thread),
    authorName: authorProfile?.username ?? thread.author_name,
    authorAvatar: authorProfile?.avatar ?? "",
  }, origin);
}
```

### 缓存失效 — admin/user.ts afterUpdate

```typescript
// apps/worker/src/handlers/admin/user.ts

const userConfig: EntityConfig = {
  // ... existing config
  
  // 添加 afterUpdate 钩子
  afterUpdate: async (env: Env, id: number, data: Record<string, unknown>) => {
    // 如果更新了影响缓存的字段，失效缓存
    const cacheFields = ["username", "avatar", "role", "group_title", "group_color", "group_stars"];
    const shouldInvalidate = cacheFields.some((field) => field in data);
    
    if (shouldInvalidate) {
      const { invalidateUserCache } = await import("../../lib/user-cache");
      await invalidateUserCache(env, id);
    }
  },
};
```

### 缓存失效 — me.ts

```typescript
// apps/worker/src/handlers/me.ts - updateProfile()

// 更新成功后失效缓存
if (updatedAvatar) {
  const { invalidateUserCache } = await import("../lib/user-cache");
  await invalidateUserCache(env, user.userId);
}
```

---

## 类型更新

### packages/types/src/types.ts

```typescript
/** Maps to Doc02 forums table */
export interface Forum {
  id: number;
  parentId: number;
  name: string;
  description: string;
  icon: string;
  displayOrder: number;
  threads: number;
  posts: number;
  type: ForumType;
  status: number;
  moderators: string;
  todayThreads: number;
  lastThreadId: number;
  lastPostAt: number;
  lastPosterId: number;      // 新增
  lastPoster: string;        // 保留，从 KV 获取
  lastPosterAvatar: string;  // 新增
  lastThreadSubject: string;
}

/** Maps to Doc02 threads table */
export interface Thread {
  id: number;
  forumId: number;
  authorId: number;
  authorName: string;        // 保留，从 KV 获取
  authorAvatar: string;      // 新增
  subject: string;
  createdAt: number;
  lastPostAt: number;
  lastPosterId: number;      // 新增
  lastPoster: string;        // 保留，从 KV 获取
  lastPosterAvatar: string;  // 新增
  replies: number;
  views: number;
  closed: number;
  sticky: StickyLevel;
  digest: number;
  special: number;
  highlight: number;
  recommends: number;
  typeName: string;
}
```

---

## 前端改动

### 全部需要改动的页面

| 页面 | 文件 | 改动 |
|------|------|------|
| 论坛首页 | `forum-card.tsx` | `lastPoster` 使用 `UserPopover` |
| 帖子列表 | `thread-item.tsx` | `authorName`、`lastPoster` 使用 `UserPopover` |
| 帖子详情 | `threads/[id]/page.tsx` | `thread.authorName` 使用 `UserPopover`（数据从 API 获取已是最新） |

### forum-card.tsx

```tsx
// 使用 UserPopover 包装用户名
{forum.lastPosterId > 0 && (
  <UserPopover userId={forum.lastPosterId}>
    <span className="text-forum-link hover:underline cursor-pointer">
      {forum.lastPoster}
    </span>
  </UserPopover>
)}
```

### thread-item.tsx

```tsx
// 作者和最后回复人都可点击
<UserPopover userId={thread.authorId}>
  <span className="text-forum-link hover:underline cursor-pointer">
    {thread.authorName}
  </span>
</UserPopover>

{thread.lastPosterId > 0 && thread.lastPosterId !== thread.authorId && (
  <UserPopover userId={thread.lastPosterId}>
    <span className="text-forum-link hover:underline cursor-pointer">
      {thread.lastPoster}
    </span>
  </UserPopover>
)}
```

### threads/[id]/page.tsx

```tsx
// 帖子详情页的作者链接
<UserPopover userId={thread.authorId}>
  <Link
    href={`/users/${thread.authorId}`}
    className="hover:text-primary transition-colors"
  >
    {thread.authorName}
  </Link>
</UserPopover>
```

---

## 实施计划

### Phase 1: 数据库改动 + 写路径

| 步骤 | 内容 | 原子提交 |
|------|------|----------|
| 1.1 | 创建迁移脚本添加 `last_poster_id` 字段 | `db: add last_poster_id columns` |
| 1.2 | 更新 `packages/db/src/schema.ts` | 同上 |
| 1.3 | 更新 `packages/types` 类型定义 | `types: add lastPosterId fields` |
| 1.4 | 更新 `thread.ts` create() 写入 `last_poster_id` | `worker: thread create writes last_poster_id` |
| 1.5 | 更新 `post.ts` create() 写入 `last_poster_id` | `worker: post create writes last_poster_id` |
| 1.6 | 更新 `recalcMetadata.ts` 维护 `last_poster_id` | `worker: recalcMetadata maintains last_poster_id` |
| 1.7 | 更新 `recalcForums`/`recalcThreads` 填充 ID | `worker: statistics recalc fills last_poster_id` |
| 1.8 | 部署 Worker + 执行迁移 + 运行重算 | — |

### Phase 2: KV 缓存层 + 读路径

| 步骤 | 内容 | 原子提交 |
|------|------|----------|
| 2.1 | 实现 `user-cache.ts` 缓存模块 | `worker: add user-cache.ts` |
| 2.2 | 更新 `forum.ts` list() 使用 KV | `worker: forum list uses KV cache` |
| 2.3 | 更新 `thread.ts` list()/getById() 使用 KV | `worker: thread handlers use KV cache` |
| 2.4 | 更新 mappers 支持新字段 | `worker: mappers support new fields` |
| 2.5 | 部署 + 测试 | — |

### Phase 3: 缓存失效

| 步骤 | 内容 | 原子提交 |
|------|------|----------|
| 3.1 | `admin/user.ts` 添加 afterUpdate 失效缓存 | `worker: invalidate cache on user update` |
| 3.2 | `me.ts` 头像更新后失效缓存 | `worker: invalidate cache on avatar change` |
| 3.3 | 部署 + 测试 | — |

### Phase 4: 前端适配

| 步骤 | 内容 | 原子提交 |
|------|------|----------|
| 4.1 | `forum-card.tsx` 使用 `UserPopover` | `web: forum-card uses UserPopover` |
| 4.2 | `thread-item.tsx` 使用 `UserPopover` | `web: thread-item uses UserPopover` |
| 4.3 | `threads/[id]/page.tsx` 使用 `UserPopover` | `web: thread detail uses UserPopover` |

### Phase 5: 清理（可选，待稳定后）

| 步骤 | 内容 | 原子提交 |
|------|------|----------|
| 5.1 | 移除冗余 name 字段（forums/threads/posts） | `db: remove deprecated name columns` |

---

## 测试计划

### L1 单元测试

- [ ] `user-cache.ts` — 缓存命中/未命中/批量查询
- [ ] `getUserProfiles` — 空数组、单个、多个、重复 ID
- [ ] `invalidateUserCache` — 缓存删除

### L2 集成测试

- [ ] **Forum list API** — 返回正确的 `lastPosterId` 和 `lastPoster`
- [ ] **Thread list API** — 返回正确的 `authorId`/`authorName` 和 `lastPosterId`/`lastPoster`
- [ ] **Thread getById API** — 返回正确的 `authorName`（从 KV 获取）
- [ ] **发帖后** — forums 和 threads 的 `last_poster_id` 正确更新
- [ ] **回帖后** — threads 和 forums 的 `last_poster_id` 正确更新
- [ ] **删帖后** — recalcMetadata 正确重算 `last_poster_id`
- [ ] **管理员改名后** — 缓存失效，下次请求返回新用户名
- [ ] **用户改头像后** — 缓存失效

### L3 端到端测试

- [ ] **论坛首页** — 点击最后发帖人可弹出 UserPopover
- [ ] **帖子列表** — 点击作者/最后回复人可弹出 UserPopover
- [ ] **帖子详情** — 点击作者可弹出 UserPopover，显示最新用户名
- [ ] **发帖后** — 列表立即显示正确的 lastPosterId
- [ ] **管理员改名后** — 刷新后所有位置显示新用户名（论坛首页、帖子列表、帖子详情）

### L4 性能测试

- [ ] KV 缓存命中率 > 90%（稳定后）
- [ ] Forum list 响应时间 < 100ms
- [ ] 批量 KV 读取 < 50ms（100 用户）

---

## 回滚方案

如果新方案出现问题：

1. **数据库层面** — 新增字段不影响现有逻辑，可继续使用旧的 `last_poster` 字段
2. **API 层面** — 回退 Worker 代码到使用旧字段
3. **缓存层面** — 直接从数据库查询用户名（降级方案）

---

## 预期收益

| 指标 | 改进前 | 改进后 |
|------|--------|--------|
| 数据一致性 | 用户改名后不更新 | 实时一致（所有页面） |
| 用户名可点击 | ❌ 无法跳转 | ✅ 可跳转到用户主页 |
| 查询性能 | N/A | KV < 10ms，批量并发 |
| 存储成本 | 冗余存储用户名 | 只存 ID（更小） |
