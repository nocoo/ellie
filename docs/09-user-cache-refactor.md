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

| 触发事件 | 操作 |
|----------|------|
| 用户改名 | `invalidateUserCache(userId)` |
| 用户改头像 | `invalidateUserCache(userId)` |
| 用户组/角色变更 | `invalidateUserCache(userId)` |
| 管理员批量更新用户 | 批量失效相关用户 |

---

## 数据库改动

### 新增字段

```sql
-- forums 表：添加最后发帖人 ID
ALTER TABLE forums ADD COLUMN last_poster_id INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_forums_last_poster ON forums(last_poster_id);

-- threads 表：添加最后回复人 ID
ALTER TABLE threads ADD COLUMN last_poster_id INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_threads_last_poster ON threads(last_poster_id);
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
-- Migration: 0010_add_poster_ids.sql

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

### 2. 修改文件

| 文件 | 改动 |
|------|------|
| `packages/db/src/schema.ts` | 添加新字段定义 |
| `packages/types/src/types.ts` | 添加 `lastPosterId` 字段到 `Forum`/`Thread` 类型 |
| `apps/worker/src/handlers/admin/statistics.ts` | `recalcForums`/`recalcThreads` 填充新 ID 字段 |
| `apps/worker/src/handlers/forum.ts` | 查询时使用 KV 批量获取用户信息 |
| `apps/worker/src/handlers/thread.ts` | 查询时使用 KV 批量获取用户信息 |
| `apps/worker/src/lib/mappers.ts` | 更新 mapper 支持新字段 |
| `apps/worker/src/handlers/me.ts` | 用户改名时失效缓存 |
| `apps/worker/src/handlers/admin/user.ts` | 管理员更新用户时失效缓存 |

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

### 查询流程改动

```typescript
// apps/worker/src/handlers/forum.ts - list()

export async function list(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // 1. Query forums (only IDs, no names)
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

### recalcForums 更新

```typescript
// apps/worker/src/handlers/admin/statistics.ts

// 获取最后发帖信息时，同时获取 author_id
const lastThreads = await env.DB.prepare(`
  SELECT t1.forum_id, t1.id, t1.subject, t1.last_post_at, t1.last_poster_id
  FROM threads t1
  INNER JOIN (
    SELECT forum_id, MAX(last_post_at) as max_last_post_at
    FROM threads
    GROUP BY forum_id
  ) t2 ON t1.forum_id = t2.forum_id AND t1.last_post_at = t2.max_last_post_at
`).all();

// 更新时写入 last_poster_id
return env.DB.prepare(`
  UPDATE forums SET
    threads = ?,
    posts = ?,
    last_thread_id = ?,
    last_post_at = ?,
    last_poster_id = ?
  WHERE id = ?
`).bind(
  threadCount,
  postCount,
  lastThread?.id ?? 0,
  lastThread?.last_post_at ?? 0,
  lastThread?.last_poster_id ?? 0,
  forumId,
);
```

### recalcThreads 更新

```typescript
// 获取最后回复信息时，获取 author_id
const lastPosts = await env.DB.prepare(`
  SELECT p1.thread_id, p1.created_at, p1.author_id
  FROM posts p1
  INNER JOIN (
    SELECT thread_id, MAX(created_at) as max_created_at
    FROM posts
    GROUP BY thread_id
  ) p2 ON p1.thread_id = p2.thread_id AND p1.created_at = p2.max_created_at
`).all();

// 更新时写入 last_poster_id
return env.DB.prepare(`
  UPDATE threads SET
    replies = ?,
    last_post_at = ?,
    last_poster_id = ?
  WHERE id = ?
`).bind(
  replyCount,
  lastPost?.created_at ?? thread.created_at,
  lastPost?.author_id ?? thread.author_id,
  thread.id,
);
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
  lastPoster: string;        // 保留，但从 KV 获取
  lastPosterAvatar: string;  // 新增（可选）
  lastThreadSubject: string;
}

/** Maps to Doc02 threads table */
export interface Thread {
  id: number;
  forumId: number;
  authorId: number;
  authorName: string;        // 保留，但从 KV 获取
  authorAvatar: string;      // 新增（可选）
  subject: string;
  createdAt: number;
  lastPostAt: number;
  lastPosterId: number;      // 新增
  lastPoster: string;        // 保留，但从 KV 获取
  lastPosterAvatar: string;  // 新增（可选）
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

---

## 实施计划

### Phase 1: 数据库改动 + 数据填充

| 步骤 | 内容 | 原子提交 |
|------|------|----------|
| 1.1 | 创建迁移脚本添加 `last_poster_id` 字段 | `db: add last_poster_id columns to forums and threads` |
| 1.2 | 更新 `packages/db/src/schema.ts` | 同上 |
| 1.3 | 更新 `packages/types` 类型定义 | `types: add lastPosterId to Forum and Thread` |
| 1.4 | 更新 `recalcForums` 填充 `last_poster_id` | `worker: recalcForums populates last_poster_id` |
| 1.5 | 更新 `recalcThreads` 填充 `last_poster_id` | `worker: recalcThreads populates last_poster_id` |
| 1.6 | 部署 Worker + 执行迁移 + 运行重算 | — |

### Phase 2: KV 缓存层

| 步骤 | 内容 | 原子提交 |
|------|------|----------|
| 2.1 | 实现 `user-cache.ts` 缓存模块 | `worker: add user-cache.ts for KV-based user profile caching` |
| 2.2 | 更新 `forum.ts` 使用 KV 获取用户名 | `worker: forum list uses KV for user profiles` |
| 2.3 | 更新 `thread.ts` 使用 KV 获取用户名 | `worker: thread list uses KV for user profiles` |
| 2.4 | 更新 mappers 支持新字段 | `worker: mappers support lastPosterId` |
| 2.5 | 用户改名时失效缓存 | `worker: invalidate user cache on profile update` |
| 2.6 | 部署 + 测试 | — |

### Phase 3: 前端适配

| 步骤 | 内容 | 原子提交 |
|------|------|----------|
| 3.1 | `forum-card.tsx` 使用 `UserPopover` | `web: forum-card uses UserPopover for lastPoster` |
| 3.2 | `thread-item.tsx` 使用 `UserPopover` | `web: thread-item uses UserPopover for author/lastPoster` |
| 3.3 | 移除假链接样式 | 同上 |

### Phase 4: 清理（可选，待稳定后）

| 步骤 | 内容 | 原子提交 |
|------|------|----------|
| 4.1 | 移除 `forums.last_poster` 字段 | `db: remove deprecated last_poster column from forums` |
| 4.2 | 移除 `threads.last_poster` 字段 | `db: remove deprecated last_poster column from threads` |
| 4.3 | 移除 `threads.author_name` 字段 | `db: remove deprecated author_name column from threads` |
| 4.4 | 移除 `posts.author_name` 字段 | `db: remove deprecated author_name column from posts` |

---

## 测试计划

### L1 单元测试

- [ ] `user-cache.ts` — 缓存命中/未命中/批量查询
- [ ] `getUserProfiles` — 空数组、单个、多个、重复 ID
- [ ] `invalidateUserCache` — 缓存删除

### L2 集成测试

- [ ] Forum list API — 返回正确的 `lastPosterId` 和 `lastPoster`
- [ ] Thread list API — 返回正确的 `authorId`/`authorName` 和 `lastPosterId`/`lastPoster`
- [ ] 用户改名后 — 缓存失效，下次请求返回新用户名

### L3 端到端测试

- [ ] 论坛首页 — 点击最后发帖人可弹出 UserPopover
- [ ] 帖子列表 — 点击作者/最后回复人可弹出 UserPopover
- [ ] 用户改名 — 刷新后所有位置显示新用户名

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
| 数据一致性 | 用户改名后不更新 | 实时一致 |
| 用户名可点击 | ❌ 无法跳转 | ✅ 可跳转到用户主页 |
| 查询性能 | N/A | KV < 10ms，批量并发 |
| 存储成本 | 冗余存储用户名 | 只存 ID（更小） |
