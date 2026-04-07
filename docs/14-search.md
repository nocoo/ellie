# 14 - 搜索功能

## 概述

基于 D1 FTS5 全文搜索能力，实现主题标题的关键词搜索功能。前端已有搜索页面框架（`/search`），后端需实现搜索 API。

### 数据规模

| 表 | 数量 |
|---|---:|
| threads | 982,549 |
| users | 1,141,587 |
| posts | 9,510,382 |

### 技术验证结果

在 tongjinet-db 上完成的 FTS5 测试：

| 指标 | 结果 |
|------|------|
| FTS5 支持 | ✅ D1 原生支持 |
| 中文搜索 | ✅ `unicode61` tokenizer |
| 全量导入 (98万条) | 6.3 秒 |
| 搜索延迟 | 0.4ms (纯 FTS) / 57ms (JOIN) |
| 存储增加 | +86MB (+1.7%) |

---

## 1. 数据库设计

### 1.1 FTS5 虚拟表

```sql
-- 主题标题全文搜索索引
CREATE VIRTUAL TABLE threads_fts USING fts5(
    subject,
    tokenize='unicode61'
);
```

**设计决策**：

- **仅索引 subject**：帖子内容（posts.content）有 951 万条，索引成本高，首期不纳入
- **tokenize='unicode61'**：D1 验证通过，支持中文字符级分词
- **不使用 content= 语法**：避免触发器复杂性，手动维护同步

### 1.2 同步触发器

```sql
-- 新建主题时同步
CREATE TRIGGER threads_fts_ai AFTER INSERT ON threads BEGIN
    INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
END;

-- 删除主题时同步
CREATE TRIGGER threads_fts_ad AFTER DELETE ON threads BEGIN
    INSERT INTO threads_fts(threads_fts, rowid, subject) 
    VALUES ('delete', old.id, old.subject);
END;

-- 更新标题时同步
CREATE TRIGGER threads_fts_au AFTER UPDATE OF subject ON threads BEGIN
    INSERT INTO threads_fts(threads_fts, rowid, subject) 
    VALUES ('delete', old.id, old.subject);
    INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
END;
```

### 1.3 Settings 配置项

在 `settings` 表新增搜索开关（遵循 08-general-settings.md 规范）：

| Key | 默认值 | Type | 说明 |
|-----|--------|------|------|
| `general.search.enabled` | `true` | boolean | 是否启用搜索功能 |

**Migration 追加**：`apps/worker/migrations/0023_create_threads_fts.sql`

```sql
-- Seed search setting (default: enabled)
INSERT OR IGNORE INTO settings (key, value, type, updated_at)
VALUES ('general.search.enabled', 'true', 'boolean', strftime('%s', 'now'));
```

**Admin UI**：在 `SETTING_GROUPS` 中 `general.site` 或新建 `general.search` 分组添加开关控件。

### 1.4 Migration 文件

**文件**：`apps/worker/migrations/0023_create_threads_fts.sql`

```sql
-- 0023_create_threads_fts.sql — Full-text search for thread subjects
-- Uses FTS5 with unicode61 tokenizer for Chinese support

-- Create FTS5 virtual table
CREATE VIRTUAL TABLE IF NOT EXISTS threads_fts USING fts5(
    subject,
    tokenize='unicode61'
);

-- Populate from existing data
INSERT INTO threads_fts(rowid, subject)
SELECT id, subject FROM threads;

-- Sync triggers
CREATE TRIGGER IF NOT EXISTS threads_fts_ai AFTER INSERT ON threads BEGIN
    INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
END;

CREATE TRIGGER IF NOT EXISTS threads_fts_ad AFTER DELETE ON threads BEGIN
    INSERT INTO threads_fts(threads_fts, rowid, subject) 
    VALUES ('delete', old.id, old.subject);
END;

CREATE TRIGGER IF NOT EXISTS threads_fts_au AFTER UPDATE OF subject ON threads BEGIN
    INSERT INTO threads_fts(threads_fts, rowid, subject) 
    VALUES ('delete', old.id, old.subject);
    INSERT INTO threads_fts(rowid, subject) VALUES (new.id, new.subject);
END;

-- Seed search setting (default: enabled)
INSERT OR IGNORE INTO settings (key, value, type, updated_at)
VALUES ('general.search.enabled', 'true', 'boolean', strftime('%s', 'now'));
```

---

## 2. Worker API

### 2.1 端点设计

```
GET /api/v1/search/threads
```

**Query Parameters**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `q` | string | ✅ | 搜索关键词，最少 2 字符 |
| `limit` | number | ❌ | 返回数量，默认 20，最大 50 |
| `cursor` | string | ❌ | Base64 编码的分页游标 |

**响应格式**：复用现有 `jsonResponse` envelope

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
    "timestamp": 1704240000,
    "requestId": "uuid",
    "nextCursor": "base64...",
    "total": 183
  }
}
```

### 2.2 可见性过滤（关键）

搜索结果**必须**遵循现有可见性规则，不能绕开：

1. **主题可见性**：`sticky >= 0`（排除隐藏/删除/占位）
2. **版块可见性**：`forum.status = 1` + 用户有权访问的 visibility 级别
3. **使用现有工具**：复用 `visibility.ts` 的 `threadVisible()`, `buildForumFilter()`

### 2.3 排序策略

**产品决策**：首期按"最近活跃"排序，不使用 FTS5 BM25 相关性排序。

理由：
- 论坛场景下，用户更关心"最近讨论的相关主题"而非"最匹配标题的主题"
- BM25 对中文单字符分词效果有限
- 与列表页排序保持一致，用户体验更统一

如后续需要相关性排序，可使用：
```sql
ORDER BY bm25(threads_fts) -- FTS5 内置相关性评分
```

### 2.4 Handler 实现

**文件**：`apps/worker/src/handlers/search.ts`

```typescript
import type { Env } from "../lib/env";
import { isKvUserCacheEnabled } from "../lib/env";
import { toThread, enrichThreadsWithUserCache } from "../lib/mappers";
import { jsonResponse } from "../lib/response";
import { getUserProfiles } from "../lib/user-cache";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";
import {
  threadVisible,
  buildForumFilter,
  buildVisibilityContext,
} from "../lib/visibility";
import type { Thread } from "@ellie/types";

/** Search cursor payload (matches thread list cursor format) */
interface SearchCursorPayload {
  lastPostAt: number;
  id: number;
}

function encodeSearchCursor(payload: SearchCursorPayload): string {
  return btoa(JSON.stringify(payload));
}

function decodeSearchCursor(cursor: string): SearchCursorPayload | null {
  try {
    const json = atob(cursor);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "lastPostAt" in parsed &&
      "id" in parsed &&
      typeof (parsed as SearchCursorPayload).lastPostAt === "number" &&
      typeof (parsed as SearchCursorPayload).id === "number"
    ) {
      return parsed as SearchCursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Tokenize and escape FTS5 query for multi-keyword AND search.
 * 
 * Input: "同济 毕业典礼"
 * Output: "同济" "毕业典礼"  (FTS5 implicit AND between quoted terms)
 * 
 * Each token is quoted to handle special chars, space-separated for AND logic.
 */
function buildFtsQuery(query: string): string {
  // Split by whitespace, filter empty, quote each token
  const tokens = query.split(/\s+/).filter((t) => t.length > 0);
  // Quote each token, escaping internal quotes
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

/**
 * GET /api/v1/search/threads - Search threads by title
 * 
 * Performs FTS5 full-text search on thread subjects with visibility filtering.
 * Supports multi-keyword AND search (space-separated keywords).
 * Results sorted by last_post_at DESC (most recently active first).
 * 
 * Controlled by general.search.enabled setting (default: true).
 */
export async function searchThreads(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin") ?? undefined;

  // 0. Check if search is enabled (via settings)
  const searchEnabledRow = await env.DB.prepare(
    "SELECT value FROM settings WHERE key = 'general.search.enabled'"
  ).first<{ value: string }>();
  const searchEnabled = searchEnabledRow?.value !== "false"; // default true
  
  if (!searchEnabled) {
    return errorResponse(
      "FEATURE_DISABLED",  // New error code - update 05-worker-api.md and 07-api-reference.md
      503,
      { message: "Search is currently disabled" },
      origin
    );
  }

  // 1. Parameter validation
  const query = url.searchParams.get("q")?.trim();
  if (!query || query.length < 2) {
    return errorResponse(
      "INVALID_REQUEST",
      400,
      { message: "Search query must be at least 2 characters" },
      origin
    );
  }

  const limitParam = url.searchParams.get("limit");
  const limitNum = limitParam ? Number.parseInt(limitParam, 10) : 20;
  const clampedLimit = Number.isNaN(limitNum) || limitNum <= 0 ? 20 : Math.min(limitNum, 50);

  // 2. Parse cursor (base64 encoded)
  const cursorStr = url.searchParams.get("cursor");
  let cursorPayload: SearchCursorPayload | null = null;
  if (cursorStr) {
    cursorPayload = decodeSearchCursor(cursorStr);
    if (!cursorPayload) {
      return errorResponse(
        "INVALID_REQUEST",
        400,
        { message: "Invalid cursor format" },
        origin
      );
    }
  }

  // 3. Build visibility context from optional auth
  const user = await optionalAuthVerified(request, env);
  const visCtx = buildVisibilityContext(user);
  const forumFilter = buildForumFilter(visCtx, "f");

  // 4. Build search query with visibility filtering
  // Join: threads_fts -> threads -> forums
  // Filter: FTS match + thread visible + forum active + forum visibility
  const ftsQuery = buildFtsQuery(query);
  
  const cursorCondition = cursorPayload
    ? "AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))"
    : "";

  const sql = `
    SELECT t.*
    FROM threads t
    JOIN threads_fts fts ON fts.rowid = t.id
    JOIN forums f ON t.forum_id = f.id
    WHERE threads_fts MATCH ?
      AND ${threadVisible("t")}
      AND ${forumFilter}
      ${cursorCondition}
    ORDER BY t.last_post_at DESC, t.id DESC
    LIMIT ?
  `;

  const params = cursorPayload
    ? [ftsQuery, cursorPayload.lastPostAt, cursorPayload.lastPostAt, cursorPayload.id, clampedLimit + 1]
    : [ftsQuery, clampedLimit + 1];

  const result = await env.DB.prepare(sql).bind(...params).all();

  // 5. Get total count (only on first page, for UI display)
  // This is an optional/approximate value, not a guaranteed precise count
  let total = 0;
  if (!cursorStr) {
    const countSql = `
      SELECT COUNT(*) as cnt
      FROM threads t
      JOIN threads_fts fts ON fts.rowid = t.id
      JOIN forums f ON t.forum_id = f.id
      WHERE threads_fts MATCH ?
        AND ${threadVisible("t")}
        AND ${forumFilter}
    `;
    const countResult = await env.DB.prepare(countSql).bind(ftsQuery).first<{ cnt: number }>();
    total = countResult?.cnt ?? 0;
  }

  // 6. Build response with pagination
  const hasMore = result.results.length > clampedLimit;
  const items = hasMore ? result.results.slice(0, -1) : result.results;
  
  // Map to Thread type using existing mapper
  const threads = items.map((row) => toThread(row as Record<string, unknown>));
  
  // 7. Enrich with user cache (avatars) - follow existing pattern
  let enrichedThreads: Thread[];
  if (isKvUserCacheEnabled(env)) {
    // Collect user IDs and fetch from KV cache
    const userIds = new Set<number>();
    for (const thread of threads) {
      if (thread.authorId > 0) userIds.add(thread.authorId);
      if (thread.lastPosterId > 0) userIds.add(thread.lastPosterId);
    }
    const userCache = userIds.size > 0
      ? await getUserProfiles(env, ctx, [...userIds])
      : new Map();
    enrichedThreads = enrichThreadsWithUserCache(threads, userCache);
  } else {
    // KV cache disabled: accepted degradation for search results.
    // Thread list uses JOIN approach, but search query is already complex.
    // First-phase decision: return threads without avatar enrichment.
    // This is a known inconsistency with thread list page.
    enrichedThreads = threads;
  }

  // Build next cursor
  const lastItem = items[items.length - 1] as { last_post_at: number; id: number } | undefined;
  const nextCursor = hasMore && lastItem
    ? encodeSearchCursor({ lastPostAt: lastItem.last_post_at, id: lastItem.id })
    : null;

  return jsonResponse(enrichedThreads, origin, { nextCursor, total });
}
```

### 2.5 路由注册

**文件**：`apps/worker/src/index.ts`

```typescript
import * as searchHandlers from "./handlers/search";

// 在路由配置中添加（注意：需要传递 ctx）
if (path === "/api/v1/search/threads" && method === "GET") {
  return searchHandlers.searchThreads(request, env, ctx);
}
```

---

## 3. 前端对接

### 3.1 架构决策：不使用 Proxy Route

搜索页是 Server Component，直接在 `search.server.ts` 调用 Worker API，无需额外 proxy route。

理由：
- 与 `thread-list.server.ts` 保持一致
- 减少维护成本
- 如未来需要客户端实时搜索（如搜索建议），再添加 proxy route

### 3.2 修改 search.server.ts（最终状态）

**文件**：`apps/web/src/viewmodels/forum/search.server.ts`

```typescript
import "server-only";

import { ForumApiError, forumApi } from "@/lib/forum-api";
import type { Thread } from "@ellie/types";
import type { PaginatedResult } from "@/viewmodels/shared/pagination";

export interface SearchData {
  query: string;
  results: PaginatedResult<Thread>;
  disabled?: boolean; // true when search is disabled by admin
}

export async function loadSearchResults(params: {
  query?: string;
  cursor?: string;
  limit?: number;
}): Promise<SearchData> {
  const query = params.query?.trim() ?? "";
  const limit = params.limit ?? 20;

  // Empty or too short query: return empty results (UI shows prompt)
  // Note: Worker returns 400 for < 2 chars, but we silently handle it in UI layer
  if (!query || query.length < 2) {
    return {
      query,
      results: { items: [], nextCursor: null, prevCursor: null, total: 0 },
    };
  }

  try {
    // Title search: call FTS5 API
    const response = await forumApi.getCursor<Thread>("/api/v1/search/threads", {
      q: query,
      limit,
      cursor: params.cursor,
    });

    return {
      query,
      results: {
        items: response.data,
        nextCursor: response.meta.nextCursor,
        prevCursor: null, // FTS5 keyset pagination is forward-only
        total: (response.meta as { total?: number }).total ?? 0,
      },
    };
  } catch (err) {
    // Handle search disabled (503 FEATURE_DISABLED)
    if (err instanceof ForumApiError && err.status === 503) {
      return {
        query,
        results: { items: [], nextCursor: null, prevCursor: null, total: 0 },
        disabled: true,
      };
    }
    throw err;
  }
}
```

### 3.3 修改 search.ts（最终状态）

**文件**：`apps/web/src/viewmodels/forum/search.ts`

```typescript
// viewmodels/forum/search.ts — Search page pure logic (simplified)

/** Check if a search query is valid (>= 2 chars after trim). */
export function isValidSearchQuery(query: string): boolean {
  return query.trim().length >= 2;
}
```

**删除内容**：
- `SearchType` 类型定义
- `resolveSearchType()` 函数
- `buildSearchParams()` 函数

### 3.4 修改 search/page.tsx（最终状态）

**文件**：`apps/web/src/app/(forum)/search/page.tsx`

**删除内容**：
- `SEARCH_TYPES` 数组
- Tab 切换 UI（`typeTabs`, `titleTab`, `authorTab` 相关代码）
- `searchType` 相关的 URL 参数处理

**新增内容**：
- 搜索禁用状态 UI

**保留内容**：
- 搜索表单
- 搜索结果列表
- 分页组件

```typescript
// 简化后的 SearchPageProps
interface SearchPageProps {
  searchParams: Promise<{ q?: string; cursor?: string }>;
}

// loadSearchResults 调用简化
const data = await loadSearchResults({
  query: sp.q,
  cursor: sp.cursor,
});

// 搜索禁用状态处理
if (data.disabled) {
  return (
    <Card size="sm">
      <CardContent className="text-center py-8">
        <p className="text-sm text-muted-foreground">搜索功能暂时关闭</p>
      </CardContent>
    </Card>
  );
}
```

---

## 4. "按作者搜索"的产品决策

### 4.1 问题分析

现有 `/api/v1/users/search` 是**用户名前缀匹配**的 autocomplete 接口（用于私信发件人选择），不是全文作者搜索。

如果用它做"作者搜索"：
- 搜索 "张" 只会找到用户名**以"张"开头**的用户
- 不支持模糊匹配（搜"三"找不到"张三"）
- 多个同前缀用户只取第一个，结果不可控

### 4.2 方案选项

| 方案 | 体验 | 实现复杂度 |
|------|------|------------|
| A. 禁用按作者搜索 | 差 | 低 |
| B. 精确用户名匹配 | 一般 | 低 |
| C. 用户选择器 → 查看主题 | 好 | 中 |
| D. 用户 FTS5 索引 | 最好 | 高 |

### 4.3 首期决策：移除作者搜索

首期**完全移除**"按作者搜索"，代码变更见 §3.2-3.4 的最终状态示例。

**未来扩展**：如需作者搜索，走方案 C（用户选择器组件），作为独立功能迭代。

---

## 5. Admin 设置界面

### 5.1 SETTING_GROUPS 配置

在 Admin Console 的 `SETTING_GROUPS` 添加搜索设置（遵循 08-general-settings.md 规范）：

**文件**：`apps/admin/src/viewmodels/admin/settings.ts`

```typescript
// 添加到 general.site 分组或新建 general.search 分组
{
  key: "general.search.enabled",
  label: "启用搜索",
  description: "关闭后，搜索页面将显示"搜索功能暂时关闭"",
  inputType: "switch", // boolean 类型使用 switch 控件
}
```

### 5.2 Admin 页面位置

设置页面：`/admin/settings` → "站点设置" 或 "功能开关" 分组

---

## 6. 测试设计

### 6.1 L1 单元测试

**文件**：`apps/worker/tests/unit/handlers/search.test.ts`

| 测试用例 | 说明 |
|----------|------|
| `returns 503 when search is disabled` | 管理员关闭搜索时返回 503 |
| `returns 400 for empty query` | 空查询参数 |
| `returns 400 for query < 2 chars` | 查询少于 2 字符 |
| `returns 400 for invalid cursor` | 非法 cursor 格式（非 base64、JSON 格式错误）|
| `returns results for valid query` | 正常搜索 |
| `supports multi-keyword AND search` | 多关键词搜索（空格分隔）|
| `respects limit parameter` | limit 参数生效 |
| `clamps limit to max 50` | limit 上限 |
| `supports cursor pagination` | 游标分页 |
| `returns total count on first page only` | 首页返回总数，翻页不返回 |
| `handles FTS5 special characters` | 引号、星号等特殊字符不报错 |
| `filters hidden threads (sticky < 0)` | 隐藏主题过滤 |
| `filters threads in hidden forums` | 隐藏版块过滤 |
| `respects forum visibility levels` | 版块可见性（public/members/staff/admin）|
| `returns complete Thread fields` | 字段完整性（含 special/highlight/recommends 等）|

### 6.2 L2 集成测试

**文件**：`tests/integration/worker/search.test.ts`（新建，符合现有目录结构）

| 测试用例 | 说明 |
|----------|------|
| `GET /search/threads returns matching threads` | 端到端搜索 |
| `Chinese keywords work correctly` | 中文关键词 |
| `multi-keyword AND search` | "同济 毕业" 返回同时包含两词的结果 |
| `pagination with cursor works` | 分页验证 |
| `hidden threads not in results` | 可见性验证 |
| `response matches Thread type contract` | 类型契约验证 |
| `returns 503 when search disabled via setting` | 设置禁用时的响应 |

---

## 7. 实施计划

### Phase 1: 数据库层（1 commit）

1. 创建 migration `0023_create_threads_fts.sql`
2. 本地测试 migration
3. 部署到生产 D1

```bash
# 测试库
npx wrangler d1 migrations apply tongjinet-db-test --remote -c apps/worker/wrangler.toml

# 生产库
npx wrangler d1 migrations apply tongjinet-db --remote -c apps/worker/wrangler.toml
```

### Phase 2: Worker API（1 commit）

1. 创建 `handlers/search.ts`
2. 注册路由
3. 添加 L1 测试
4. 部署 Worker

### Phase 3: 前端对接（1 commit）

1. 修改 `search.server.ts` 调用真实 API
2. 移除作者搜索相关代码：
   - `search.ts`：删除 `SearchType`、`resolveSearchType()`、`buildSearchParams()`
   - `search/page.tsx`：删除 tab 切换 UI，添加禁用状态处理
3. 添加 L2 测试

### Phase 4: Admin 设置（1 commit）

1. 在 `SETTING_GROUPS` 添加 `general.search.enabled` 开关
2. 验证 Admin UI 可正常切换

### Phase 5: 验证与文档

1. E2E 测试验证
2. 更新 API 文档：
   - `07-api-reference.md`：添加 `/api/v1/search/threads` 端点
   - `05-worker-api.md` 和 `07-api-reference.md`：添加 `FEATURE_DISABLED` 错误码（503）

---

## 8. 原子提交计划

| # | 提交信息 | 内容 |
|---|----------|------|
| 1 | `feat(db): add FTS5 index for thread search` | migration 文件（含 setting seed）|
| 2 | `feat(worker): add search threads endpoint` | handler + route + L1 tests |
| 3 | `feat(web): connect search page to FTS5 API` | viewmodel 修改 + 移除作者搜索 + 禁用态 UI + L2 tests |
| 4 | `feat(admin): add search enabled setting` | Admin UI 配置 |
| 5 | `docs: update API reference for search endpoint` | 文档更新（含 FEATURE_DISABLED 错误码）|

---

## 9. 未来扩展

### 9.1 帖子内容搜索（Phase 2）

```sql
-- 帖子内容 FTS（951 万条，索引约 +500MB）
CREATE VIRTUAL TABLE posts_fts USING fts5(
    content,
    tokenize='unicode61'
);
```

### 9.2 用户搜索增强

- 方案 C：用户选择器组件（输入时 autocomplete → 选择用户 → 查看主题列表）
- 方案 D：用户 FTS5 索引（搜索 username + bio）

### 9.3 搜索建议 / 热门搜索

- KV 缓存热门搜索词
- 需要 proxy route 供客户端调用
