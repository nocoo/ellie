# 在线统计功能

恢复 Discuz 风格的在线用户统计与用户在线时长统计功能。

## 概述

Discuz X3.4 的在线统计功能包括：
- **实时在线人数**：当前活跃用户数（含游客）
- **历史峰值**：最高在线人数及日期
- **用户在线时长**：每个用户的累计在线时间

Ellie 需要在 Cloudflare Workers + D1 + KV 架构下重新实现这些功能。

### 范围裁剪

本期实现 **仅统计登录用户**，不含游客。原因：
- 游客无稳定标识（IP 共享、动态变化）
- 基于 fingerprint 的方案复杂且不可靠
- KV key 数量会随游客暴增，成本不可控

游客统计作为 P2 扩展项，后续可通过 CF Analytics 或采样估算实现。

---

## 1. 原 Discuz 实现分析

### 1.1 核心数据表

| 表名 | 功能 |
|------|------|
| `pre_common_session` | 实时会话表，存储在线用户/游客的会话数据 |
| `pre_common_onlinelist` | 首页在线列表缓存 |
| `pre_common_member_status` | 用户状态（含 `lastactivity` 字段） |
| `pre_common_member_count` | 用户计数（含 `oltime` 累计在线分钟数） |

### 1.2 会话表结构（pre_common_session）

```sql
CREATE TABLE pre_common_session (
  sid char(6) NOT NULL DEFAULT '' COMMENT '会话ID',
  ip1 tinyint(3) unsigned NOT NULL DEFAULT '0',
  ip2 tinyint(3) unsigned NOT NULL DEFAULT '0',
  ip3 tinyint(3) unsigned NOT NULL DEFAULT '0',
  ip4 tinyint(3) unsigned NOT NULL DEFAULT '0',
  uid mediumint(8) unsigned NOT NULL DEFAULT '0' COMMENT '用户ID，0=游客',
  username char(15) NOT NULL DEFAULT '',
  groupid smallint(6) unsigned NOT NULL DEFAULT '0',
  invisible tinyint(1) NOT NULL DEFAULT '0' COMMENT '隐身状态',
  `action` tinyint(1) unsigned NOT NULL DEFAULT '0' COMMENT '当前操作',
  lastactivity int(10) unsigned NOT NULL DEFAULT '0' COMMENT '最后活动时间',
  lastolupdate int(10) unsigned NOT NULL DEFAULT '0' COMMENT '上次在线时长更新时间',
  fid mediumint(8) unsigned NOT NULL DEFAULT '0' COMMENT '当前版块',
  tid mediumint(8) unsigned NOT NULL DEFAULT '0' COMMENT '当前主题',
  UNIQUE KEY sid (sid),
  KEY uid (uid)
) ENGINE=MEMORY DEFAULT CHARSET=utf8;
```

**关键点：**
- 使用 `ENGINE=MEMORY`，数据全内存，重启丢失
- `lastactivity` 用于判断是否在线（通常 15 分钟内视为在线）
- `lastolupdate` 用于计算在线时长增量

### 1.3 在线统计逻辑

```php
// 统计当前在线人数
$onlinenum = DB::result_first("
  SELECT COUNT(*) 
  FROM pre_common_session 
  WHERE lastactivity > " . (TIMESTAMP - 900)  // 15分钟
);

// 更新在线时长
$oltime = TIMESTAMP - $session['lastolupdate'];
if ($oltime >= 60) {  // 至少累积1分钟
  $addminutes = intval($oltime / 60);
  DB::query("UPDATE pre_common_member_count SET oltime = oltime + $addminutes WHERE uid = $uid");
  DB::query("UPDATE pre_common_session SET lastolupdate = " . TIMESTAMP . " WHERE sid = '$sid'");
}
```

### 1.4 峰值记录

Discuz 在 `pre_common_setting` 中存储：
- `onlinemax`：历史最高在线人数
- `onlinemaxtime`：达到峰值的时间戳

---

## 2. Ellie 现有基础

### 2.1 已迁移字段

| Ellie 字段 | 来源 | 说明 |
|-----------|------|------|
| `users.ol_time` | `pre_common_member_count.oltime` | 累计在线时长（分钟） |
| `users.last_activity` | `pre_common_member_status.lastactivity` | 最后活动时间戳 |

### 2.2 现有 UI 接口

```typescript
// apps/web/src/viewmodels/forum/footer.ts
export interface OnlineStats {
  totalOnline: number;   // 当前在线人数
  peakOnline: number;    // 历史峰值
  peakDate: string;      // 峰值日期
}

export const DEFAULT_ONLINE_STATS: OnlineStats = {
  totalOnline: 0,
  peakOnline: 0,
  peakDate: "",
};
```

Footer 组件已预留位置，但目前使用默认值（全 0）。

### 2.3 技术栈约束

| 组件 | 特性 | 约束 |
|------|------|------|
| D1 | SQLite | 单线程写入，高频更新可能成为瓶颈 |
| KV | 最终一致性 | TTL 自动过期，list 操作每次最多 1000 keys |
| Workers | 无状态 | 无内存会话，需外部存储 |

---

## 3. 方案设计

### 3.1 方案对比

| 方案 | 实时性 | 复杂度 | 成本 | 适用场景 |
|------|--------|--------|------|---------|
| A: KV + TTL | 准实时（5分钟延迟） | 中 | 低 | **推荐** |
| B: D1 会话表 | 实时 | 中 | 中（写入多） | 需精确在线列表 |
| C: 客户端心跳 + 计数器 | 低（估算） | 低 | 极低 | 简单统计 |

### 3.2 推荐方案：KV + TTL + Cron 聚合

```
┌─────────────────────────────────────────────────────────────────┐
│                        Online Statistics Flow                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Request                                                   │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────┐     write      ┌──────────────────────┐       │
│  │   Worker    │ ──────────────▶│  KV: online:{uid}    │       │
│  │  Middleware │                │  TTL: 15 minutes     │       │
│  └─────────────┘                └──────────────────────┘       │
│                                           │                     │
│                                           │ (auto-expire)       │
│                                           ▼                     │
│  ┌─────────────┐     list       ┌──────────────────────┐       │
│  │ Cron Trigger│ ──────────────▶│  Count active keys   │       │
│  │  (5 min)    │                └──────────────────────┘       │
│  └─────────────┘                          │                     │
│       │                                   │                     │
│       ▼                                   ▼                     │
│  ┌─────────────────────────────────────────────────────┐       │
│  │  KV: stats:online_count = 123                        │       │
│  │  KV: stats:online_peak  = { count: 456, date: "..." }│       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

> **注意**：峰值数据仅存储在 KV（永不过期），不进入 D1 settings 表。这是纯展示数据，非配置项。

---

## 4. 数据模型

### 4.1 KV 存储结构

#### 在线用户 Key

```
Key:   online:{userId}           // 仅登录用户

Value: {
  "uid": 12345,                  // 用户 ID
  "username": "张三",            // 用户名
  "ip": "1.2.3.4",               // IP 地址
  "page": "/forums/1",           // 当前页面
  "ts": 1711900800               // 写入时间戳
}

TTL:   900 秒（15 分钟）
```

#### 统计缓存 Key

```
Key:   stats:online_count
Value: "123"                     // 当前在线人数（登录用户）
TTL:   300 秒（5 分钟）

Key:   stats:online_peak
Value: {
  "count": 456,
  "date": "2026-04-01",
  "timestamp": 1711900800
}
TTL:   无（永久，KV 不设置 expirationTtl）
```

> **存储决策**：峰值数据仅用 KV 持久化，不进入 D1 `settings` 表。原因：
> - 峰值是统计快照，非用户可配置项
> - 避免污染 settings 白名单体系
> - KV 无 TTL 的 key 永久保留，足够可靠
> - 若 KV 丢失，峰值从 0 重新累积，可接受

### 4.2 用户表字段（已存在）

```sql
-- users 表已有字段
ol_time        INTEGER NOT NULL DEFAULT 0,  -- 累计在线分钟数
last_activity  INTEGER NOT NULL DEFAULT 0   -- 最后活动时间戳
```

---

## 5. API 设计

### 5.1 扩展现有 Stats API

复用现有 `GET /api/v1/stats` 端点（`apps/web/src/viewmodels/forum/stats.server.ts` 已调用），在返回值中增加 `online` 字段：

```
GET /api/v1/stats

Response 200:
{
  "users": 12345,           // 总用户数（已有）
  "threads": 6789,          // 总主题数（已有）
  "posts": 45678,           // 总帖子数（已有）
  "newestUser": {...},      // 最新注册用户（已有）
  "online": {               // 新增
    "total": 123,           // 当前在线人数（登录用户）
    "peak": 456,            // 历史峰值
    "peakDate": "2026-04-01"// 峰值日期
  }
}
```

> **设计决策**：扩展现有 `/api/v1/stats` 而非新建 `/api/v1/stats/online`。
> - 首页已通过 `loadSiteStats()` 调用此 API
> - 减少网络请求，一次获取所有统计
> - 与现有 `OnlineStats` 类型对齐

### 5.2 在线用户列表（P2 扩展）

```
GET /api/v1/stats/online/users?limit=50

Response 200:
{
  "users": [
    { "id": 123, "username": "张三", "page": "/forums/1" },
    { "id": 456, "username": "李四", "page": "/threads/789" }
  ],
  "total": 45
}
```

---

## 6. 实现细节

### 6.1 Middleware：更新在线状态

```typescript
// apps/worker/src/middleware/online.ts

import type { Context, Next } from "hono";
import type { Bindings } from "../types";

const ONLINE_TTL = 900; // 15 minutes

export async function onlineMiddleware(c: Context<{ Bindings: Bindings }>, next: Next) {
  // 先执行后续处理
  await next();

  // 仅在成功响应时记录
  if (c.res.status >= 400) return;

  try {
    const userId = c.get("userId");  // 从 JWT 或 session 获取
    const key = userId ? `online:${userId}` : null;
    
    if (key) {
      const value = JSON.stringify({
        uid: userId,
        username: c.get("username") || "",
        ip: c.req.header("CF-Connecting-IP") || "",
        page: new URL(c.req.url).pathname,
        ts: Math.floor(Date.now() / 1000),
      });
      
      // 异步写入，不阻塞响应
      c.executionCtx.waitUntil(
        c.env.KV.put(key, value, { expirationTtl: ONLINE_TTL })
      );
    }
  } catch (e) {
    // 静默失败，不影响主流程
    console.error("Online tracking error:", e);
  }
}
```

### 6.2 Middleware：更新在线时长

```typescript
// apps/worker/src/middleware/activity.ts

import type { Context, Next } from "hono";
import type { Bindings } from "../types";

const ACTIVITY_THRESHOLD = 1800; // 30 分钟内视为连续活动
const THROTTLE_SECONDS = 60;     // 节流：每分钟最多更新一次

export async function activityMiddleware(c: Context<{ Bindings: Bindings }>, next: Next) {
  await next();

  const userId = c.get("userId");
  if (!userId || c.res.status >= 400) return;

  try {
    const now = Math.floor(Date.now() / 1000);
    
    // 节流检查：1 分钟内已更新过则跳过
    const throttleKey = `activity_throttle:${userId}`;
    const lastUpdate = await c.env.KV.get(throttleKey);
    if (lastUpdate && now - parseInt(lastUpdate, 10) < THROTTLE_SECONDS) {
      return; // 跳过本次更新
    }
    
    // 获取用户当前 last_activity
    const user = await c.env.DB.prepare(
      "SELECT last_activity, ol_time FROM users WHERE id = ?"
    ).bind(userId).first<{ last_activity: number; ol_time: number }>();
    
    if (!user) return;
    
    const gap = now - user.last_activity;
    
    // 计算要累加的分钟数
    // 如果距上次活动超过阈值，不累加（视为离开后重新上线）
    const addMinutes = gap < ACTIVITY_THRESHOLD && gap >= 60 
      ? Math.floor(gap / 60) 
      : 0;
    
    // 异步执行：更新节流标记 + 更新用户数据
    c.executionCtx.waitUntil(
      Promise.all([
        // 设置节流标记（TTL 2 分钟，比节流周期略长）
        c.env.KV.put(throttleKey, String(now), { expirationTtl: 120 }),
        // 更新 last_activity 和 ol_time
        c.env.DB.prepare(
          "UPDATE users SET last_activity = ?, ol_time = ol_time + ? WHERE id = ?"
        ).bind(now, addMinutes, userId).run(),
      ])
    );
  } catch (e) {
    console.error("Activity tracking error:", e);
  }
}
```

> **节流策略**：使用 KV 存储上次更新时间，1 分钟内的重复请求直接跳过。
> 这将 D1 写入频率从"每次请求"降至"每用户每分钟最多 1 次"。

### 6.3 Cron：统计在线人数

```typescript
// apps/worker/src/cron/online-stats.ts

import type { Bindings } from "../types";

export async function aggregateOnlineStats(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  let totalCount = 0;
  let cursor: string | undefined;
  
  // 分页遍历所有 online: 前缀的 key
  do {
    const result = await env.KV.list({ prefix: "online:", cursor, limit: 1000 });
    totalCount += result.keys.length;
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  
  // 更新当前在线人数缓存
  await env.KV.put("stats:online_count", String(totalCount), { expirationTtl: 300 });
  
  // 检查是否创造新峰值
  const peakData = await env.KV.get("stats:online_peak", "json") as {
    count: number;
    date: string;
    timestamp: number;
  } | null;
  
  if (!peakData || totalCount > peakData.count) {
    const newPeak = {
      count: totalCount,
      date: new Date().toISOString().split("T")[0],
      timestamp: now,
    };
    
    // 仅更新 KV（永久保留，无 TTL）
    // 不写入 D1 settings —— 峰值是统计数据，非配置项
    await env.KV.put("stats:online_peak", JSON.stringify(newPeak));
  }
}
```

### 6.4 Wrangler Cron 配置

```toml
# apps/worker/wrangler.toml

[triggers]
crons = ["*/5 * * * *"]  # 每 5 分钟执行一次
```

```typescript
// apps/worker/src/index.ts

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    // ... existing fetch handler
  },
  
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(aggregateOnlineStats(env));
  },
};
```

### 6.5 扩展现有 Stats Handler

在现有 `apps/worker/src/handlers/stats.ts` 中增加在线统计字段：

```typescript
// apps/worker/src/handlers/stats.ts（修改现有文件）

app.get("/", async (c) => {
  // 现有统计查询...
  const [userStats, threadStats, postStats, newestUser, onlineData] = await Promise.all([
    // ... 现有查询
    
    // 新增：从 KV 读取在线统计
    Promise.all([
      c.env.KV.get("stats:online_count"),
      c.env.KV.get("stats:online_peak", "json") as Promise<{
        count: number;
        date: string;
      } | null>,
    ]),
  ]);

  const [countStr, peakData] = onlineData;
  const onlineCount = countStr ? parseInt(countStr, 10) : 0;

  return c.json({
    users: userStats.count,
    threads: threadStats.count,
    posts: postStats.count,
    newestUser: newestUser ? mapUserRow(newestUser) : null,
    // 新增在线统计字段
    online: {
      total: onlineCount,
      peak: peakData?.count ?? 0,
      peakDate: peakData?.date ?? "",
    },
  });
});
```

> **注意**：修改现有 handler，不新建路由。前端 `loadSiteStats()` 无需改动调用方式。

---

## 7. 前端集成

### 7.1 现有数据流

首页已有完整的统计数据获取链路：

```
apps/web/src/app/(forum)/page.tsx
  └─ loadSiteStats()                    // 并行调用
      └─ apps/web/src/viewmodels/forum/stats.server.ts
          └─ GET /api/v1/stats          // Worker API
              └─ 返回 { users, threads, posts, newestUser, online }
```

`buildHomeFooterViewModel()` 已接收 `onlineStats` 参数（由页面层传入），无需改动。

### 7.2 需修改的文件

#### stats.server.ts — 解析新字段

```typescript
// apps/web/src/viewmodels/forum/stats.server.ts（修改现有）

export async function loadSiteStats(): Promise<SiteStats> {
  const res = await fetch(`${API_BASE}/stats`);
  const data = await res.json();
  
  return {
    users: data.users,
    threads: data.threads,
    posts: data.posts,
    newestUser: data.newestUser,
    // 新增：解析在线统计
    online: {
      totalOnline: data.online?.total ?? 0,
      peakOnline: data.online?.peak ?? 0,
      peakDate: data.online?.peakDate ?? "",
    },
  };
}
```

#### types.ts — 扩展类型定义

```typescript
// apps/web/src/viewmodels/forum/stats.server.ts 或 types

export interface SiteStats {
  users: number;
  threads: number;
  posts: number;
  newestUser: UserSummary | null;
  online: OnlineStats;  // 新增
}
```

### 7.3 页面层（已有，无需改动）

```typescript
// apps/web/src/app/(forum)/page.tsx（现有代码，无需修改）

const [settings, siteStats] = await Promise.all([
  fetchPublicSettings(),
  loadSiteStats(),
]);

const homeFooter = buildHomeFooterViewModel(settings, siteStats.online);
```

### 7.4 Footer 组件展示

```tsx
// apps/web/src/components/forum/home-footer.tsx（修改现有）

<div className="online-stats">
  <p>
    当前在线 <strong>{onlineStats.totalOnline}</strong> 人
  </p>
  {onlineStats.peakOnline > 0 && (
    <p className="text-sm text-gray-500">
      历史最高：{onlineStats.peakOnline} 人（{onlineStats.peakDate}）
    </p>
  )}
</div>
```

---

## 8. 用户在线时长展示

### 8.1 格式化函数（已存在）

```typescript
// apps/web/src/viewmodels/forum/user-profile.ts

export function formatOlTime(minutes: number): string | null {
  if (minutes <= 0) return null;
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0) {
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  }
  return `${mins} 分钟`;
}
```

### 8.2 用户资料展示

```tsx
// 用户资料页面
<div className="user-stats">
  <dt>在线时间</dt>
  <dd>{formatOlTime(user.olTime) || "暂无记录"}</dd>
</div>
```

---

## 9. 实施计划

### 9.1 原子化提交计划

每个提交独立可验证，包含对应的测试。

#### Commit 1: 在线追踪 Middleware

```
feat(worker): add online tracking middleware

Add middleware to track online users via KV with TTL.
- Write online:{userId} key on each authenticated request
- Store user info (uid, username, ip, page, timestamp)
- TTL 15 minutes for automatic expiration
- Async write via waitUntil to not block response

Files:
  apps/worker/src/middleware/online.ts
  apps/worker/src/types.ts (KV binding)
  apps/worker/tests/unit/middleware/online.test.ts
```

**变更文件：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/worker/src/middleware/online.ts` | 新增 | onlineMiddleware 实现 |
| `apps/worker/src/types.ts` | 修改 | 添加 KV binding 类型 |
| `apps/worker/wrangler.toml` | 修改 | 添加 KV namespace 绑定 |
| `apps/worker/tests/unit/middleware/online.test.ts` | 新增 | L1 单元测试 |

**验证命令：**
```bash
bun test apps/worker/tests/unit/middleware/online.test.ts
```

---

#### Commit 2: 活动时长追踪 Middleware

```
feat(worker): add activity tracking middleware

Add middleware to update user activity and accumulate online time.
- Update last_activity timestamp on each request
- Calculate and add ol_time based on activity gap
- Skip accumulation if gap > 30 minutes (session break)
- Throttle updates to max once per minute via KV

Files:
  apps/worker/src/middleware/activity.ts
  apps/worker/tests/unit/middleware/activity.test.ts
```

**变更文件：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/worker/src/middleware/activity.ts` | 新增 | activityMiddleware 实现 |
| `apps/worker/tests/unit/middleware/activity.test.ts` | 新增 | L1 单元测试 |

**验证命令：**
```bash
bun test apps/worker/tests/unit/middleware/activity.test.ts
```

---

#### Commit 3: Cron 聚合任务

```
feat(worker): add online stats cron aggregation

Add scheduled handler to aggregate online statistics.
- List all online:* keys from KV (paginated)
- Count total online users
- Update peak in KV if current count exceeds historical
- Cache current count in KV with 5min TTL
- No D1 writes — peak stored only in KV (permanent)

Files:
  apps/worker/src/cron/online-stats.ts
  apps/worker/src/index.ts (scheduled export)
  apps/worker/wrangler.toml (cron trigger)
  apps/worker/tests/unit/cron/online-stats.test.ts
```

**变更文件：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/worker/src/cron/online-stats.ts` | 新增 | aggregateOnlineStats 实现 |
| `apps/worker/src/index.ts` | 修改 | 添加 scheduled export |
| `apps/worker/wrangler.toml` | 修改 | 添加 cron trigger 配置 |
| `apps/worker/tests/unit/cron/online-stats.test.ts` | 新增 | L1 单元测试 |

**验证命令：**
```bash
bun test apps/worker/tests/unit/cron/online-stats.test.ts
```

---

#### Commit 4: 扩展 Stats API

```
feat(worker): extend stats api with online statistics

Add online statistics to existing GET /api/v1/stats endpoint.
- Read current online count from KV cache
- Read historical peak from KV (permanent key)
- Return { online: { total, peak, peakDate } } in response
- Fallback to zero if no data available

Files:
  apps/worker/src/handlers/stats.ts (modify existing)
  apps/worker/tests/unit/handlers/stats.test.ts (extend)
```

**变更文件：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/worker/src/handlers/stats.ts` | 修改 | 在现有 handler 中增加 online 字段 |
| `apps/worker/tests/unit/handlers/stats.test.ts` | 修改 | 扩展测试用例 |

**验证命令：**
```bash
bun test apps/worker/tests/unit/handlers/stats.test.ts
```

---

#### Commit 5: 集成 Middleware 到请求链

```
feat(worker): integrate online tracking in request chain

Wire online and activity middleware into the request chain.
- Apply to authenticated API routes
- Ensure non-blocking via waitUntil

Files:
  apps/worker/src/index.ts (middleware chain)
  apps/worker/tests/integration/online-tracking.test.ts
```

**变更文件：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/worker/src/index.ts` | 修改 | 集成 middleware 到路由链 |
| `apps/worker/tests/integration/online-tracking.test.ts` | 新增 | L2 集成测试 |

**验证命令：**
```bash
bun test apps/worker/tests/integration/online-tracking.test.ts
```

---

#### Commit 6: 前端类型与数据解析

```
feat(web): extend stats types and parser for online data

Update stats.server.ts to parse online statistics from API.
- Add online field to SiteStats interface
- Parse { total, peak, peakDate } from API response
- Existing loadSiteStats() call unchanged

Files:
  apps/web/src/viewmodels/forum/stats.server.ts
  tests/unit/viewmodels/forum/stats.test.ts
```

**变更文件：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/web/src/viewmodels/forum/stats.server.ts` | 修改 | 解析 online 字段 |
| `tests/unit/viewmodels/forum/stats.test.ts` | 修改 | 扩展测试 |

**验证命令：**
```bash
bun test tests/unit/viewmodels/forum/stats.test.ts
```

---

#### Commit 7: 首页 Footer 展示在线统计

```
feat(web): display online stats in homepage footer

Update HomeFooter component to show online statistics.
- Display current online count
- Display historical peak with date
- Graceful degradation when data unavailable

Files:
  apps/web/src/components/forum/home-footer.tsx
  tests/unit/components/forum/home-footer.test.tsx
```

**变更文件：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/web/src/components/forum/home-footer.tsx` | 修改 | 渲染在线统计 |
| `tests/unit/components/forum/home-footer.test.tsx` | 新增 | 组件测试 |

**验证命令：**
```bash
bun test tests/unit/components/forum/home-footer.test.tsx
```

---

### 9.2 提交依赖图

```
[1] online middleware ─────┐
                           ├──▶ [5] integrate middleware ──▶ [6] frontend viewmodel ──▶ [7] footer UI
[2] activity middleware ───┘                                         │
                                                                      │
[3] cron aggregation ──────▶ [4] stats API ───────────────────────────┘
```

### 9.3 质量门禁

每个提交必须通过以下检查：

| Gate | 命令 | 说明 |
|------|------|------|
| G1 Typecheck | `bun run typecheck` | TypeScript 类型检查 |
| L1 Unit Tests | `bun test <相关文件>` | 单元测试通过 |
| G2 Security | `gitleaks detect --no-banner` | 无敏感信息泄露 |

完整流程验证：
```bash
bun run typecheck && bun test apps/worker && bun test tests/unit/
```

---

## 10. 测试设计

### 10.1 测试层级概览

| 层级 | 范围 | 工具 | 文件 |
|------|------|------|------|
| L1 | 单元测试 | Bun test + mock | `apps/worker/tests/unit/**` |
| L2 | 集成测试 | Bun test + miniflare | `apps/worker/tests/integration/**` |
| L3 | E2E 测试 | Playwright | `tests/e2e/**` |

### 10.2 L1 单元测试

#### 10.2.1 Online Middleware 测试

```typescript
// apps/worker/tests/unit/middleware/online.test.ts

import { describe, expect, it, vi, beforeEach } from "vitest";
import { onlineMiddleware } from "../../../src/middleware/online";

describe("onlineMiddleware", () => {
  let mockContext: any;
  let mockKV: any;
  let mockNext: any;

  beforeEach(() => {
    mockKV = {
      put: vi.fn().mockResolvedValue(undefined),
    };
    mockNext = vi.fn().mockResolvedValue(undefined);
    mockContext = {
      env: { KV: mockKV },
      req: {
        url: "https://example.com/forums/1",
        header: vi.fn().mockReturnValue("1.2.3.4"),
      },
      res: { status: 200 },
      get: vi.fn((key: string) => {
        if (key === "userId") return 123;
        if (key === "username") return "testuser";
        return undefined;
      }),
      executionCtx: {
        waitUntil: vi.fn((p: Promise<any>) => p),
      },
    };
  });

  it("should call next middleware", async () => {
    await onlineMiddleware(mockContext, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it("should write online key for authenticated user", async () => {
    await onlineMiddleware(mockContext, mockNext);
    
    expect(mockKV.put).toHaveBeenCalledWith(
      "online:123",
      expect.stringContaining('"uid":123'),
      { expirationTtl: 900 }
    );
  });

  it("should skip KV write for error responses", async () => {
    mockContext.res.status = 401;
    await onlineMiddleware(mockContext, mockNext);
    
    expect(mockKV.put).not.toHaveBeenCalled();
  });

  it("should skip KV write for unauthenticated requests", async () => {
    mockContext.get = vi.fn().mockReturnValue(undefined);
    await onlineMiddleware(mockContext, mockNext);
    
    expect(mockKV.put).not.toHaveBeenCalled();
  });

  it("should include correct data in KV value", async () => {
    await onlineMiddleware(mockContext, mockNext);
    
    const putCall = mockKV.put.mock.calls[0];
    const value = JSON.parse(putCall[1]);
    
    expect(value).toMatchObject({
      uid: 123,
      username: "testuser",
      ip: "1.2.3.4",
      page: "/forums/1",
    });
    expect(value.ts).toBeTypeOf("number");
  });
});
```

#### 10.2.2 Activity Middleware 测试

```typescript
// apps/worker/tests/unit/middleware/activity.test.ts

import { describe, expect, it, vi, beforeEach } from "vitest";
import { activityMiddleware } from "../../../src/middleware/activity";

describe("activityMiddleware", () => {
  let mockContext: any;
  let mockDB: any;
  let mockKV: any;
  const NOW = 1711900800; // 固定时间戳

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);

    mockDB = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    mockKV = {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    };
    mockContext = {
      env: { DB: mockDB, KV: mockKV },
      res: { status: 200 },
      get: vi.fn((key: string) => (key === "userId" ? 123 : undefined)),
      executionCtx: {
        waitUntil: vi.fn((p: Promise<any>) => p),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should skip for unauthenticated requests", async () => {
    mockContext.get = vi.fn().mockReturnValue(undefined);
    await activityMiddleware(mockContext, vi.fn());
    
    expect(mockDB.prepare).not.toHaveBeenCalled();
  });

  it("should skip for error responses", async () => {
    mockContext.res.status = 500;
    await activityMiddleware(mockContext, vi.fn());
    
    expect(mockDB.prepare).not.toHaveBeenCalled();
  });

  it("should update last_activity without adding ol_time for first activity", async () => {
    mockDB.first.mockResolvedValue({ last_activity: 0, ol_time: 0 });
    
    await activityMiddleware(mockContext, vi.fn());
    
    expect(mockDB.prepare).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE users SET last_activity")
    );
    // gap > 30 minutes (from 0), should add 0 minutes
    expect(mockDB.bind).toHaveBeenCalledWith(NOW, 0, 123);
  });

  it("should accumulate ol_time for activity within 30 minutes", async () => {
    const lastActivity = NOW - 600; // 10 分钟前
    mockDB.first.mockResolvedValue({ last_activity: lastActivity, ol_time: 100 });
    
    await activityMiddleware(mockContext, vi.fn());
    
    // gap = 600 秒 = 10 分钟，应累加 10 分钟
    expect(mockDB.bind).toHaveBeenCalledWith(NOW, 10, 123);
  });

  it("should not accumulate ol_time for activity gap > 30 minutes", async () => {
    const lastActivity = NOW - 3600; // 1 小时前
    mockDB.first.mockResolvedValue({ last_activity: lastActivity, ol_time: 100 });
    
    await activityMiddleware(mockContext, vi.fn());
    
    // gap > 30 minutes, should add 0 minutes
    expect(mockDB.bind).toHaveBeenCalledWith(NOW, 0, 123);
  });

  it("should respect throttle (skip if updated within 1 minute)", async () => {
    mockKV.get.mockResolvedValue(String(NOW - 30)); // 30 秒前更新过
    
    await activityMiddleware(mockContext, vi.fn());
    
    expect(mockDB.prepare).not.toHaveBeenCalled();
  });
});
```

#### 10.2.3 Cron Aggregation 测试

```typescript
// apps/worker/tests/unit/cron/online-stats.test.ts

import { describe, expect, it, vi, beforeEach } from "vitest";
import { aggregateOnlineStats } from "../../../src/cron/online-stats";

describe("aggregateOnlineStats", () => {
  let mockEnv: any;
  const NOW = 1711900800;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);

    mockEnv = {
      KV: {
        list: vi.fn(),
        get: vi.fn(),
        put: vi.fn().mockResolvedValue(undefined),
      },
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({ success: true }),
        batch: vi.fn().mockResolvedValue([]),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should count online users from KV list", async () => {
    mockEnv.KV.list.mockResolvedValue({
      keys: [{ name: "online:1" }, { name: "online:2" }, { name: "online:3" }],
      list_complete: true,
    });
    mockEnv.KV.get.mockResolvedValue(null); // no existing peak

    await aggregateOnlineStats(mockEnv);

    expect(mockEnv.KV.put).toHaveBeenCalledWith(
      "stats:online_count",
      "3",
      { expirationTtl: 300 }
    );
  });

  it("should handle pagination for large user counts", async () => {
    mockEnv.KV.list
      .mockResolvedValueOnce({
        keys: Array(1000).fill({ name: "online:x" }),
        list_complete: false,
        cursor: "cursor1",
      })
      .mockResolvedValueOnce({
        keys: Array(500).fill({ name: "online:x" }),
        list_complete: true,
      });
    mockEnv.KV.get.mockResolvedValue(null);

    await aggregateOnlineStats(mockEnv);

    expect(mockEnv.KV.put).toHaveBeenCalledWith(
      "stats:online_count",
      "1500",
      expect.any(Object)
    );
  });

  it("should update peak when current count exceeds historical", async () => {
    mockEnv.KV.list.mockResolvedValue({
      keys: Array(100).fill({ name: "online:x" }),
      list_complete: true,
    });
    mockEnv.KV.get.mockResolvedValue({ count: 50, date: "2026-03-01" });

    await aggregateOnlineStats(mockEnv);

    expect(mockEnv.KV.put).toHaveBeenCalledWith(
      "stats:online_peak",
      expect.stringContaining('"count":100')
    );
    // 不写 D1 — 峰值仅存 KV
    expect(mockEnv.DB.batch).not.toHaveBeenCalled();
  });

  it("should not update peak when current count is lower", async () => {
    mockEnv.KV.list.mockResolvedValue({
      keys: Array(30).fill({ name: "online:x" }),
      list_complete: true,
    });
    mockEnv.KV.get.mockResolvedValue({ count: 50, date: "2026-03-01" });

    await aggregateOnlineStats(mockEnv);

    // Should update count but not peak
    expect(mockEnv.KV.put).toHaveBeenCalledTimes(1);
    expect(mockEnv.KV.put).toHaveBeenCalledWith(
      "stats:online_count",
      "30",
      expect.any(Object)
    );
  });
});
```

#### 10.2.4 Stats Handler 测试

```typescript
// apps/worker/tests/unit/handlers/stats.test.ts（扩展现有测试）

import { describe, expect, it, vi, beforeEach } from "vitest";

describe("GET /api/v1/stats — online field", () => {
  let mockKV: any;
  let mockDB: any;

  beforeEach(() => {
    mockKV = {
      get: vi.fn(),
    };
    mockDB = {
      prepare: vi.fn().mockReturnThis(),
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
    };
  });

  it("should include online stats from KV cache", async () => {
    // 模拟现有统计查询...
    mockDB.first.mockResolvedValue({ count: 100 });
    
    mockKV.get
      .mockResolvedValueOnce("123") // stats:online_count
      .mockResolvedValueOnce({ count: 456, date: "2026-04-01" }); // stats:online_peak

    // 调用 handler...
    const body = { /* response */ };

    expect(body.online).toEqual({
      total: 123,
      peak: 456,
      peakDate: "2026-04-01",
    });
  });

  it("should return zeros for online when no KV data", async () => {
    mockDB.first.mockResolvedValue({ count: 100 });
    mockKV.get.mockResolvedValue(null);

    // 调用 handler...
    const body = { /* response */ };

    expect(body.online).toEqual({
      total: 0,
      peak: 0,
      peakDate: "",
    });
  });
});
```
});
```

### 10.3 L2 集成测试

```typescript
// apps/worker/tests/integration/online-tracking.test.ts

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";

describe("Online Tracking Integration", () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    worker = await unstable_dev("src/index.ts", {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it("should track authenticated user as online", async () => {
    // 1. 登录获取 JWT
    const loginRes = await worker.fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: "testpass" }),
    });
    const { accessToken } = await loginRes.json();

    // 2. 发起认证请求
    await worker.fetch("/api/v1/forums", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    // 3. 触发 cron 聚合
    // Note: 在真实测试中需要等待或手动触发 cron
    
    // 4. 检查统计结果
    const statsRes = await worker.fetch("/api/v1/stats/online");
    const stats = await statsRes.json();

    expect(stats.online.total).toBeGreaterThanOrEqual(1);
  });

  it("should accumulate online time for active user", async () => {
    // 1. 获取用户初始 ol_time
    const user1 = await getUserProfile(worker, "testuser");
    const initialOlTime = user1.olTime;

    // 2. 模拟多次活动（间隔 > 1 分钟）
    // Note: 在真实测试中需要 mock 时间或使用真实等待

    // 3. 检查 ol_time 增加
    const user2 = await getUserProfile(worker, "testuser");
    expect(user2.olTime).toBeGreaterThanOrEqual(initialOlTime);
  });
});

async function getUserProfile(worker: UnstableDevWorker, username: string) {
  const res = await worker.fetch(`/api/v1/users/by-name/${username}`);
  return res.json();
}
```

### 10.4 L3 E2E 测试

```typescript
// tests/e2e/online-stats.spec.ts

import { test, expect } from "@playwright/test";

test.describe("Online Statistics", () => {
  test("should display online count on homepage", async ({ page }) => {
    await page.goto("/");
    
    // 等待 footer 加载
    const footer = page.locator(".home-footer");
    await expect(footer).toBeVisible();

    // 检查在线统计区域存在
    const onlineStats = footer.locator(".online-stats");
    await expect(onlineStats).toBeVisible();

    // 检查显示格式
    await expect(onlineStats).toContainText(/当前在线.*\d+.*人/);
  });

  test("should display peak when available", async ({ page }) => {
    await page.goto("/");
    
    const peakText = page.locator(".online-stats .peak");
    
    // 峰值可能不存在（新系统），检查格式正确即可
    const peakContent = await peakText.textContent();
    if (peakContent) {
      expect(peakContent).toMatch(/历史最高.*\d+.*人/);
    }
  });

  test("should show user online time in profile", async ({ page }) => {
    // 登录
    await page.goto("/login");
    await page.fill('input[name="username"]', "testuser");
    await page.fill('input[name="password"]', "testpass");
    await page.click('button[type="submit"]');

    // 访问个人资料
    await page.goto("/users/testuser");

    // 检查在线时长显示
    const olTimeRow = page.locator("dt:has-text('在线时间') + dd");
    await expect(olTimeRow).toBeVisible();
    
    // 格式可能是 "X 小时 Y 分钟" 或 "暂无记录"
    const text = await olTimeRow.textContent();
    expect(text).toMatch(/(小时|分钟|暂无记录)/);
  });
});
```

### 10.5 测试数据准备

```typescript
// apps/worker/tests/fixtures/online.ts

export const MOCK_ONLINE_USERS = [
  { uid: 1, username: "admin", ip: "10.0.0.1", page: "/admin", ts: 1711900000 },
  { uid: 2, username: "moderator", ip: "10.0.0.2", page: "/forums/1", ts: 1711900100 },
  { uid: 3, username: "user1", ip: "10.0.0.3", page: "/threads/123", ts: 1711900200 },
];

export const MOCK_PEAK_DATA = {
  count: 256,
  date: "2026-03-15",
  timestamp: 1710460800,
};

export function createMockKV(users = MOCK_ONLINE_USERS, peak = MOCK_PEAK_DATA) {
  const store = new Map<string, string>();
  
  // 填充在线用户
  for (const user of users) {
    store.set(`online:${user.uid}`, JSON.stringify(user));
  }
  
  // 填充统计缓存
  store.set("stats:online_count", String(users.length));
  store.set("stats:online_peak", JSON.stringify(peak));

  return {
    get: async (key: string, type?: string) => {
      const value = store.get(key);
      if (!value) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    list: async ({ prefix, cursor, limit }: any) => {
      const keys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}
```

### 10.6 测试覆盖率目标

| 模块 | 行覆盖率 | 分支覆盖率 |
|------|---------|-----------|
| `middleware/online.ts` | ≥90% | ≥85% |
| `middleware/activity.ts` | ≥90% | ≥85% |
| `cron/online-stats.ts` | ≥85% | ≥80% |
| `handlers/stats.ts` | ≥95% | ≥90% |

运行覆盖率报告：
```bash
bun test --coverage apps/worker/tests/unit/
```

---

## 11. 性能考量

### 11.1 KV 操作成本

| 操作 | 频率 | 成本影响 |
|------|------|---------|
| 写入 online:{uid} | 每次 API 请求 | 低（KV 写入便宜） |
| List online:* | 每 5 分钟 | 低（单次操作） |
| 读取 stats:* | 每次首页加载 | 极低（读取便宜） |

### 11.2 D1 写入优化

活动时长更新的写入可能频繁，优化策略：
1. **批量更新**：使用 `waitUntil` 异步执行，不阻塞响应
2. **节流**：如果距上次更新不足 1 分钟，跳过本次更新
3. **最终一致性**：允许少量时长损失，换取更低的写入压力

```typescript
// 节流策略：检查 KV 中的上次更新时间
const lastUpdate = await c.env.KV.get(`activity_throttle:${userId}`);
if (lastUpdate && now - parseInt(lastUpdate) < 60) {
  return; // 1 分钟内已更新，跳过
}
await c.env.KV.put(`activity_throttle:${userId}`, String(now), { expirationTtl: 120 });
```

---

## 12. 未来扩展

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 游客统计 | 基于 session ID 或 IP 统计游客数 | P2 |
| 在线用户列表 | 展示当前在线的用户名列表 | P2 |
| 版块在线统计 | 按版块统计当前浏览人数 | P3 |
| 24 小时在线趋势 | 记录每小时在线人数，绘制曲线 | P3 |
| 用户在线时长排行 | TOP N 在线时长用户榜单 | P3 |

---

## 13. 参考

- Discuz X3.4 源码：`source/class/discuz/discuz_session.php`
- Cloudflare KV 文档：https://developers.cloudflare.com/kv/
- Cloudflare Workers Cron：https://developers.cloudflare.com/workers/configuration/cron-triggers/
