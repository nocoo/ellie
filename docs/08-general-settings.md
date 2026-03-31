# 08 — 通用设置

> 站点全局配置的数据库设计、KV 缓存策略、API 端点、前端管理页面。
>
> **前置依赖**：02（数据库设计）、05（Worker API）、04c（管理后台）

---

## 1. 背景

当前 Ellie 存在大量 hardcode 配置值分散在多个文件中：

| 类别 | 现状 | 问题 |
|------|------|------|
| 站点名称 | `"Ellie"` 出现在 8+ 个文件 | 无单一数据源 |
| 版权信息 | `"同济网"` 写死在 footer | 不可配置 |
| OG 元数据 | 零配置 | 社交分享无法优化 |
| 分页大小 | 前后端不一致（20 vs 100） | 管理员无法调整 |
| 头像 CDN | `"https://t.no.mt/avatar"` 写死 | 迁移困难 |

本方案新增 `settings` 表 + KV 缓存 + 管理页面，实现统一配置管理。

---

## 2. 数据库设计

### 2.1 settings 表

```sql
CREATE TABLE IF NOT EXISTS settings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT    NOT NULL UNIQUE,
    value      TEXT    NOT NULL DEFAULT '',
    type       TEXT    NOT NULL DEFAULT 'string'
               CHECK(type IN ('string', 'number', 'boolean', 'json')),
    updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_key ON settings(key);
```

| 列 | 说明 |
|----|------|
| `key` | 命名空间格式，如 `general.site.name`，按 `.` 分隔归类 |
| `value` | 统一 TEXT 存储，前端/后端按 `type` 字段解析 |
| `type` | **存储类型**元数据，指导后端解析（`"number"` → `Number()`，`"boolean"` → `=== "true"`）。前端渲染控件由 `SETTING_GROUPS` 的 `inputType` 独立决定（见 §6.3） |
| `updated_at` | Unix 时间戳，记录最后修改时间 |

**设计决策**：
- `id` 仅为 schema 一致性保留，实际查询以 `key` 为主键
- 不设 `description` 列——所有字段描述由前端 `SETTING_GROUPS` 常量维护，避免 DB 与 UI 同步问题
- 仅 `UPDATE` 不 `INSERT`——所有 key 由 migration seed，白名单防注入
- **`type` 与 `inputType` 职责分离**：`type` 是存储/解析类型（string / number / boolean / json），`inputType` 是 UI 渲染控件类型（text / number / url / textarea），二者独立。例如 `general.og.image` 的 `type = "string"` 但 `inputType = "url"`

### 2.2 Seed 数据（18 个 key）

#### general.site — 站点品牌

| Key | 默认值 | Type | 说明 |
|-----|--------|------|------|
| `general.site.name` | `Ellie` | string | 站点名称 |
| `general.site.subtitle` | `Ellie admin console` | string | 站点副标题/描述 |
| `general.site.copyright` | `同济网` | string | 版权持有者 |
| `general.site.powered_by` | `Powered by Ellie` | string | 页脚署名文本 |
| `general.site.version` | `v0.1` | string | 站点版本号 |

#### general.og — Open Graph / 社交媒体

| Key | 默认值 | Type | 说明 |
|-----|--------|------|------|
| `general.og.title` | *(空)* | string | og:title |
| `general.og.description` | *(空)* | string | og:description |
| `general.og.site_name` | *(空)* | string | og:site_name |
| `general.og.image` | *(空)* | string | og:image URL |
| `general.og.url` | *(空)* | string | og:url |
| `general.og.twitter_card` | `summary` | string | twitter:card 类型 |
| `general.og.twitter_site` | *(空)* | string | twitter:site @handle |

#### general.pagination — 分页与限制

| Key | 默认值 | Type | 说明 |
|-----|--------|------|------|
| `general.pagination.threads_per_page` | `100` | number | 版块主题列表每页数 |
| `general.pagination.posts_per_page` | `20` | number | 帖子详情每页回帖数 |
| `general.pagination.user_history_per_page` | `20` | number | 用户历史记录每页数 |
| `general.pagination.max_post_length` | `50000` | number | 帖子内容最大字数 |
| `general.pagination.admin_page_size` | `20` | number | 管理列表默认每页数 |

#### general.assets — 资源配置

| Key | 默认值 | Type | 说明 |
|-----|--------|------|------|
| `general.assets.avatar_cdn_base` | `https://t.no.mt/avatar` | string | 头像 CDN 基础 URL（不含尾部斜杠） |

### 2.3 文件清单

| 文件 | 操作 |
|------|------|
| `packages/db/src/schema.ts` | `TABLES` + `INDEXES` 追加 `settings` |
| `apps/worker/migrations/0007_create_settings.sql` | 建表 + 建索引 + seed 18 行 |

---

## 3. 缓存策略（KV）

### 3.1 架构

```
读取路径:  getSettings(env)
           │
           ├─ KV.get("settings:all") → hit → 返回 parsed map
           │
           └─ miss → DB.prepare("SELECT * FROM settings").all()
                      │
                      ├─ 解析 value（number/boolean/json/string）
                      ├─ KV.put("settings:all", JSON, { ttl: 86400 })
                      └─ 返回 parsed map

写入路径:  upsertSettings(env, entries)
           │
           ├─ DB.batch([UPDATE ... WHERE key = ?])  ← 原子事务
           └─ KV.delete("settings:all")             ← 立即失效
```

### 3.2 设计决策

| 决策 | 理由 |
|------|------|
| **单 KV key** `settings:all` | 18 个 key payload < 2KB，1 次 GET 比 18 次便宜 |
| **TTL 24 小时** | 兜底过期，正常流程靠写入时 delete 失效 |
| **Read-through** | 首次访问自动回填，无需预热 |
| **UPDATE only** | 所有 key 由 migration seed，禁止运行时新增 key |
| **D1 batch** | 批量 UPDATE 在单一事务中执行，保证原子性 |

### 3.3 缓存辅助模块

新建 `apps/worker/src/lib/settings.ts`：

| 导出函数 | 签名 | 用途 |
|---------|------|------|
| `getSettings` | `(env: Env) → Promise<SettingsMap>` | 返回 typed map（number 已解析），供 handler 和公共端点使用 |
| `getSetting` | `(env: Env, key: string, defaultValue: T) → Promise<T>` | 获取单个值，带类型默认值 |
| `getSettingsDetailed` | `(env: Env) → Promise<SettingsDetailMap>` | 返回完整元数据（value + type + updatedAt），供管理页面 |
| `upsertSettings` | `(env: Env, entries: Record<string, string>) → Promise<void>` | 批量 UPDATE + 删除 KV 缓存 |

**类型定义**：

```ts
type SettingsMap = Record<string, string | number | boolean | object>;

interface SettingEntry {
    value: string;
    type: "string" | "number" | "boolean" | "json";
    updatedAt: number;
}
type SettingsDetailMap = Record<string, SettingEntry>;
```

---

## 4. Worker API 端点

### 4.1 不使用 CRUD 工厂

Settings 的操作模式是"获取全部 + 批量更新"，与标准 CRUD（分页列表 / 单条查删改）不匹配。使用自定义 handler。

### 4.2 管理端点（Key B 鉴权）

| # | Method | Path | Handler | 说明 |
|---|--------|------|---------|------|
| #62 | `GET` | `/api/admin/settings` | `list` | 返回 `SettingsDetailMap`（含 type/updatedAt），支持 `?prefix=general.site` 按命名空间过滤 |
| #63 | `PUT` | `/api/admin/settings` | `bulkUpdate` | 接受 `{ "general.site.name": "新名字", ... }`，批量更新 |

**安全措施**：
- Handler 内维护 `ALLOWED_KEYS: Set<string>` 白名单（18 个 key）
- 请求中包含未知 key → 400 拒绝
- `number` 类型 key 验证值为正数

**文件**: `apps/worker/src/handlers/admin/settings.ts`

### 4.3 公共端点（Key A 鉴权，只读）

| # | Method | Path | Handler | 说明 |
|---|--------|------|---------|------|
| #12b | `GET` | `/api/v1/settings` | `list` | 返回 `SettingsMap`（typed 值），支持 `?prefix=` |

**文件**: `apps/worker/src/handlers/settings.ts`

### 4.4 路由注册

在 `apps/worker/src/index.ts` 中：

```
Public routes (#2-#11)
  ↓
#12b  GET /api/v1/settings  ← 新增（公共只读）
  ↓
Auth routes (#12-#15)
  ...
Admin routes (#18-#61)
  ↓
── I. Settings (Admin) #62-#63 ──  ← 新增
#62  GET  /api/admin/settings
#63  PUT  /api/admin/settings
  ↓
404 fallback
```

---

## 5. Next.js 数据链路

### 5.1 读取链路概览

本项目有两条独立的 server-side 读取链路（均为 Server Component 直连 Worker，不经浏览器）：

| 链路 | Client | Next.js 环境变量 | 用途 |
|------|--------|-----------------|------|
| `adminApi`（`admin-api.ts`） | Key B，server-only | `ADMIN_API_KEY` | Admin Server Component 读取（如 `dashboard.server.ts`） |
| `forumApi`（`forum-api.ts`） | Key A，server-only | `FORUM_API_KEY` | Forum Server Component 读取（如 `thread-list.server.ts`） |

> **Key A 命名说明**：Worker 端环境变量为 `API_KEY`，Next.js 端为了与 `ADMIN_API_KEY` 对称而命名为 `FORUM_API_KEY`，实际是同一个密钥值。部署时需确保 `FORUM_API_KEY` = Worker 的 `API_KEY`。

Admin 管理页面的写操作走浏览器 → `/api/admin/*` BFF 代理 → Worker（需 CSRF + OAuth 鉴权）。

### 5.2 Admin Settings 读取（Server Component 直连）

沿用 admin 基线模式：**Server Component 读数据直连 Worker，Client Component 仅处理写操作**。

新建 `apps/web/src/viewmodels/admin/settings.server.ts`（`"server-only"`）：

```ts
import "server-only";
import { adminApi } from "@/lib/admin-api";

export async function fetchSettingsDetailed(): Promise<SettingsDetailMap> {
    const res = await adminApi.get<SettingsDetailMap>("/api/admin/settings");
    return res.data;
}
```

参考: `apps/web/src/viewmodels/admin/dashboard.server.ts` 使用相同模式。

### 5.3 Forum Settings 读取（Server Component 直连）

新建 `apps/web/src/viewmodels/forum/settings.server.ts`（`"server-only"`）：

```ts
import "server-only";
import { forumApi } from "@/lib/forum-api";

export async function fetchPublicSettings(): Promise<SettingsMap> {
    const res = await forumApi.get<SettingsMap>("/api/v1/settings");
    return res.data;
}
```

此函数供论坛前端的 Server Component（layout、page）在渲染时调用，经 Key A 直连 Worker 公共端点，读取 KV 缓存。

> **不需要** `apps/web/src/app/api/v1/settings/route.ts`——forum 端的 Server Component 通过 `forumApi` 直连 Worker，不走 Next.js Route Handler 代理。这与现有 forum 页面（thread-list、thread-detail 等）的读取模式完全一致。

### 5.4 Admin Settings 写入（BFF 代理）

新建 `apps/web/src/app/api/admin/settings/route.ts`：

| Method | 逻辑 |
|--------|------|
| `PUT` | `createProxyHandler` → `adminApi.raw("PUT", "/api/admin/settings", body)` → `passthrough` |

> 此文件**只需 PUT**（写入代理）。Admin 端的 GET 由 Server Component 通过 `adminApi` 直连完成，不经代理。

### 5.5 apiClient 扩展

在 `apps/web/src/lib/api-client.ts` 的 `apiClient` 对象中新增：

```ts
async put<T>(path: string, body: unknown): Promise<ApiResponse<T>>
```

供 Client Component 的写操作使用。

---

## 6. 前端管理页面

### 6.1 导航

修改 `apps/web/src/lib/navigation.ts`：

| 变更 | 内容 |
|------|------|
| `NAV_GROUPS` 追加 | `{ label: "设置", items: [{ href: "/admin/settings", label: "通用设置", icon: "Settings" }] }` |
| `ROUTE_LABELS` 追加 | `settings: "通用设置"` |

> `Settings` icon 已在 `sidebar.tsx` 的 `ICON_MAP` 中注册，无需修改。

### 6.2 ViewModel

**`apps/web/src/viewmodels/admin/settings.ts`**（纯类型 + 纯函数 + client API，非 server-only）：

| 导出 | 类型 | 说明 |
|------|------|------|
| `SettingEntry` | interface | `{ value, type, updatedAt }` |
| `SettingsDetailMap` | type | `Record<string, SettingEntry>` |
| `SettingsUpdatePayload` | type | `Record<string, string>` |
| `SETTING_GROUPS` | const | 4 组表单字段定义 |
| `toFormValues()` | function | `SettingsDetailMap → Record<string, string>` |
| `getChangedSettings()` | function | diff formValues vs saved → payload |
| `updateSettings()` | async | `PUT /api/admin/settings`（通过 `apiClient.put`） |

**`apps/web/src/viewmodels/admin/settings.server.ts`**（server-only 读取）：

| 导出 | 说明 |
|------|------|
| `fetchSettingsDetailed()` | 通过 `adminApi.get` 直连 Worker（见 §5.2） |

### 6.3 SETTING_GROUPS 定义

```ts
interface SettingFieldDef {
    key: string;        // 对应 DB 的 settings.key，如 "general.site.name"
    label: string;      // 中文标签
    placeholder?: string;
    inputType?: "text" | "number" | "url" | "textarea";
        // UI 渲染控件类型，与 DB 的 type 列独立
        // 默认 "text"；"url" 仍对应 DB type="string"
    hint?: string;      // 字段下方提示
}

interface SettingGroupDef {
    title: string;       // 卡片标题
    description: string; // 卡片描述
    prefix: string;      // 命名空间前缀
    fields: SettingFieldDef[];
}
```

4 个组：**站点品牌** / **OG 社交媒体元数据** / **分页与限制** / **资源配置**

### 6.4 页面架构

采用 **Server Component 读 + Client Component 写** 分层模式，与 admin 基线一致：

**`apps/web/src/app/(admin)/admin/settings/page.tsx`**（Server Component）：

```tsx
import { fetchSettingsDetailed } from "@/viewmodels/admin/settings.server";
import { SettingsForm } from "@/components/admin/settings-form";

export default async function SettingsPage() {
    const settings = await fetchSettingsDetailed();
    return <SettingsForm initialSettings={settings} />;
}
```

**`apps/web/src/components/admin/settings-form.tsx`**（`"use client"`）：

接收 `initialSettings` 作为 props（Server Component 已完成数据读取，无首屏 loading），负责：
- 表单状态管理（formValues、dirty、saving）
- 用户交互（编辑、重置、保存）
- 写操作走 `apiClient.put("/api/admin/settings", changed)` → BFF 代理

### 6.5 页面布局

```
┌─────────────────────────────────────────────────────────┐
│  通用设置                                   [重置] [保存] │
│  配置站点全局参数，更改将在保存后立即生效                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ 站点品牌 ─────────────────────────────────────────┐ │
│  │  配置站点名称、版权信息等基本标识                    │ │
│  │                                                     │ │
│  │  站点名称 [______]    │  站点描述 [______]          │ │
│  │  版权持有者 [______]   │  页脚署名 [______]          │ │
│  │  版本号 [______]       │                             │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ OG 社交媒体元数据 ───────────────────────────────┐ │
│  │  配置 Open Graph 和 Twitter Card 标签              │ │
│  │                                                     │ │
│  │  og:title [______]    │  og:description [______]    │ │
│  │  og:site_name [______] │ og:image [______]          │ │
│  │  og:url [______]      │  twitter:card [______]      │ │
│  │  twitter:site [______] │                             │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ 分页与限制 ──────────────────────────────────────┐ │
│  │  配置列表分页大小和内容长度限制                      │ │
│  │                                                     │ │
│  │  版块主题每页数 [100]  │  帖子回帖每页数 [20]       │ │
│  │  用户历史每页数 [20]   │  帖子最大字数 [50000]      │ │
│  │  管理列表每页数 [20]   │                             │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ 资源配置 ────────────────────────────────────────┐ │
│  │  配置 CDN 地址和外部资源路径                        │ │
│  │                                                     │ │
│  │  头像 CDN 基础 URL [https://t.no.mt/avatar]        │ │
│  │  不含尾部斜杠                                       │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 6.6 交互行为

| 行为 | 说明 |
|------|------|
| 加载 | Server Component 读取 settings → 作为 props 传入表单（**无首屏 loading**） |
| 编辑 | 修改任意字段 → `dirty = true` → 激活"保存"和"重置" |
| 保存 | Client Component 仅发送变更 key（diff）→ BFF 代理 → Worker → 成功后用 `router.refresh()` 触发 Server Component 重新读取 |
| 重置 | 恢复为 `initialSettings` 的值 |
| 反馈 | 成功绿色提示 / 失败红色提示 |

**UI 组件**：复用 `Button`, `Input`, `Label`（from `@/components/ui/`），每组 `rounded-xl border bg-card p-6`。

---

## 7. 实现步骤

按依赖顺序，每步一个原子化 commit：

| Step | 任务 | 关键文件 |
|------|------|---------|
| 1 | DB schema + migration | `packages/db/src/schema.ts`, `apps/worker/migrations/0007_create_settings.sql` |
| 2 | KV 缓存辅助模块 | `apps/worker/src/lib/settings.ts` |
| 3 | Worker 管理端点 + 公共端点 + 路由注册 | `handlers/admin/settings.ts`, `handlers/settings.ts`, `index.ts` |
| 4 | BFF 写入代理 + apiClient.put | `app/api/admin/settings/route.ts`, `api-client.ts` |
| 5 | ViewModel（types + server reader + client writer） | `viewmodels/admin/settings.ts`, `viewmodels/admin/settings.server.ts` |
| 6 | 导航 + Server Page + Client Form | `navigation.ts`, `settings/page.tsx`, `components/admin/settings-form.tsx` |

```
Step 1 → Step 2 → Step 3 → Step 4 ─┐
                                     ├→ Step 6
                     Step 5 ─────────┘
```

---

## 8. 验证清单

- [ ] D1 migration 成功：表创建 + 18 行 seed 数据
- [ ] `GET /api/admin/settings` 返回 18 个 key 的完整 SettingsDetailMap
- [ ] `GET /api/admin/settings?prefix=general.site` 仅返回 5 个 site key
- [ ] `PUT /api/admin/settings` 修改值 → 再次 GET 确认更新
- [ ] `PUT /api/admin/settings` 包含未知 key → 400 拒绝
- [ ] `PUT /api/admin/settings` number key 传负数 → 400 拒绝
- [ ] KV 缓存：首次 GET 写入 KV → 第二次 GET 命中 KV → PUT 后 KV 被 delete
- [ ] `GET /api/v1/settings` 公共端点返回 typed 值（number 已解析为数字）
- [ ] 管理页面加载 → 4 个卡片正确显示所有字段（无 loading spinner，Server Component 直出）
- [ ] 修改字段 → 保存 → 刷新页面 → 确认持久化
- [ ] 重置按钮恢复为 initialSettings 的值
- [ ] `bun run typecheck` 通过
- [ ] `bun test apps/worker` 无回归

---

## 9. 不在本次范围

| 后续工作 | 说明 |
|---------|------|
| 替换前端 hardcode 值 | sidebar 站点名、footer 版权、avatar CDN 等 → 通过 `fetchPublicSettings()` 在 forum Server Component 中读取后 prop drilling |
| 替换 worker handler 分页值 | thread.ts / post.ts 的 `DEFAULT_PAGE_SIZE` → 改为 `getSetting(env, ...)` 动态读取 |
| 更多设置 namespace | `security.*`, `email.*`, `notification.*` 等 → 按需扩展 |
