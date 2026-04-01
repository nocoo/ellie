# 在线统计功能

恢复 Discuz 风格的在线用户统计与用户在线时长统计功能。

## 概述

Discuz X3.4 的在线统计功能包括：
- **实时在线人数**：当前活跃用户数（含游客）
- **历史峰值**：最高在线人数及日期
- **用户在线时长**：每个用户的累计在线时间

Ellie 需要在 Cloudflare Workers + D1 + KV 架构下重新实现这些功能。

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
│  │  D1: settings (general.stats.online_*)               │       │
│  └─────────────────────────────────────────────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 数据模型

### 4.1 KV 存储结构

#### 在线用户 Key

```
Key:   online:{userId}           // 登录用户
       online:guest:{sessionId}  // 游客（可选）

Value: {
  "uid": 12345,                  // 用户 ID（游客为 0）
  "username": "张三",            // 用户名（游客为空）
  "ip": "1.2.3.4",               // IP 地址
  "page": "/forums/1",           // 当前页面
  "ua": "Mozilla/5.0...",        // User-Agent（可选）
  "ts": 1711900800               // 写入时间戳
}

TTL:   900 秒（15 分钟）
```

#### 统计缓存 Key

```
Key:   stats:online_count
Value: "123"                     // 当前在线人数
TTL:   300 秒（5 分钟）

Key:   stats:online_peak
Value: {
  "count": 456,
  "date": "2026-04-01",
  "timestamp": 1711900800
}
TTL:   无（永久）
```

### 4.2 D1 Settings 存储

将峰值数据持久化到 `settings` 表：

```sql
-- 插入峰值记录
INSERT OR REPLACE INTO settings (key, value, type, updated_at)
VALUES 
  ('general.stats.online_peak_count', '456', 'number', 1711900800),
  ('general.stats.online_peak_date', '2026-04-01', 'string', 1711900800);
```

### 4.3 用户表字段（已存在）

```sql
-- users 表已有字段
ol_time        INTEGER NOT NULL DEFAULT 0,  -- 累计在线分钟数
last_activity  INTEGER NOT NULL DEFAULT 0   -- 最后活动时间戳
```

---

## 5. API 设计

### 5.1 在线统计 API

```
GET /api/v1/stats/online

Response 200:
{
  "online": {
    "total": 123,           // 当前在线总人数
    "members": 45,          // 登录用户数
    "guests": 78            // 游客数（可选）
  },
  "peak": {
    "count": 456,           // 历史峰值
    "date": "2026-04-01"    // 峰值日期
  }
}
```

### 5.2 在线用户列表（可选扩展）

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

export async function activityMiddleware(c: Context<{ Bindings: Bindings }>, next: Next) {
  await next();

  const userId = c.get("userId");
  if (!userId || c.res.status >= 400) return;

  try {
    const now = Math.floor(Date.now() / 1000);
    
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
    
    // 更新 last_activity 和 ol_time
    c.executionCtx.waitUntil(
      c.env.DB.prepare(
        "UPDATE users SET last_activity = ?, ol_time = ol_time + ? WHERE id = ?"
      ).bind(now, addMinutes, userId).run()
    );
  } catch (e) {
    console.error("Activity tracking error:", e);
  }
}
```

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
    
    // 更新 KV
    await env.KV.put("stats:online_peak", JSON.stringify(newPeak));
    
    // 持久化到 D1
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR REPLACE INTO settings (key, value, type, updated_at) VALUES (?, ?, 'number', ?)"
      ).bind("general.stats.online_peak_count", String(totalCount), now),
      env.DB.prepare(
        "INSERT OR REPLACE INTO settings (key, value, type, updated_at) VALUES (?, ?, 'string', ?)"
      ).bind("general.stats.online_peak_date", newPeak.date, now),
    ]);
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

### 6.5 Stats Handler

```typescript
// apps/worker/src/handlers/stats.ts

import { Hono } from "hono";
import type { Bindings } from "../types";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/online", async (c) => {
  // 从 KV 读取缓存的统计数据
  const [countStr, peakData] = await Promise.all([
    c.env.KV.get("stats:online_count"),
    c.env.KV.get("stats:online_peak", "json") as Promise<{
      count: number;
      date: string;
    } | null>,
  ]);
  
  const total = countStr ? parseInt(countStr, 10) : 0;
  
  return c.json({
    online: {
      total,
      members: total,  // TODO: 区分登录用户和游客
      guests: 0,
    },
    peak: peakData || { count: 0, date: "" },
  });
});

export { app as statsRoutes };
```

---

## 7. 前端集成

### 7.1 ViewModel 更新

```typescript
// apps/web/src/viewmodels/forum/footer.ts

export async function fetchOnlineStats(): Promise<OnlineStats> {
  try {
    const res = await fetch("/api/v1/stats/online");
    if (!res.ok) return DEFAULT_ONLINE_STATS;
    
    const data = await res.json();
    return {
      totalOnline: data.online.total,
      peakOnline: data.peak.count,
      peakDate: data.peak.date,
    };
  } catch {
    return DEFAULT_ONLINE_STATS;
  }
}

export async function buildHomeFooterViewModel(
  settings: SettingsMap,
): Promise<HomeFooterViewModel> {
  const onlineStats = await fetchOnlineStats();
  // ... rest of implementation
}
```

### 7.2 首页 Footer 展示

```tsx
// apps/web/src/components/forum/home-footer.tsx

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

| Phase | 任务 | 复杂度 | 依赖 |
|-------|------|--------|------|
| 1.1 | 创建 `onlineMiddleware`，写入 KV | 中 | - |
| 1.2 | 创建 `activityMiddleware`，更新 `last_activity` + `ol_time` | 中 | - |
| 1.3 | 创建 Cron handler `aggregateOnlineStats` | 中 | 1.1 |
| 1.4 | 创建 `GET /api/v1/stats/online` API | 低 | 1.3 |
| 2.1 | 前端 `fetchOnlineStats()` 函数 | 低 | 1.4 |
| 2.2 | Footer 组件集成在线统计 | 低 | 2.1 |
| 3.1 | L1 单元测试：middleware、cron、handler | 中 | 1.* |
| 3.2 | L2 集成测试：端到端在线统计流程 | 中 | 2.* |

### 9.1 提交计划

```
feat(worker): add online tracking middleware
feat(worker): add activity tracking middleware  
feat(worker): add online stats cron aggregation
feat(worker): add stats api endpoint
feat(web): integrate online stats in footer
test(worker): add online stats tests
```

---

## 10. 性能考量

### 10.1 KV 操作成本

| 操作 | 频率 | 成本影响 |
|------|------|---------|
| 写入 online:{uid} | 每次 API 请求 | 低（KV 写入便宜） |
| List online:* | 每 5 分钟 | 低（单次操作） |
| 读取 stats:* | 每次首页加载 | 极低（读取便宜） |

### 10.2 D1 写入优化

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

## 11. 未来扩展

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 游客统计 | 基于 session ID 或 IP 统计游客数 | P2 |
| 在线用户列表 | 展示当前在线的用户名列表 | P2 |
| 版块在线统计 | 按版块统计当前浏览人数 | P3 |
| 24 小时在线趋势 | 记录每小时在线人数，绘制曲线 | P3 |
| 用户在线时长排行 | TOP N 在线时长用户榜单 | P3 |

---

## 12. 参考

- Discuz X3.4 源码：`source/class/discuz/discuz_session.php`
- Cloudflare KV 文档：https://developers.cloudflare.com/kv/
- Cloudflare Workers Cron：https://developers.cloudflare.com/workers/configuration/cron-triggers/
