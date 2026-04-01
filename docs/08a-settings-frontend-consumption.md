# 08a — 前端消费 Settings

> 将管理后台可配置的 settings 值接入论坛前端，替换散落在多个文件中的 hardcode。
>
> **前置依赖**：08（settings 基建已完成）、04d（论坛前端架构）

---

## 1. 背景

08 完成了 settings 的完整写入链路（DB → KV → Admin API → Admin UI），但论坛前端仍在消费 hardcode 值。管理员在后台修改设置后，前端无任何变化。

### 1.1 现状对照

| 设置 key | 前端应使用的位置 | 当前实际状态 |
|----------|-----------------|-------------|
| `general.site.name` | `<title>` 后缀、页脚品牌 | 硬编码 `"同济网 TONGJI.NET"`（`site-footer.tsx:37`） |
| `general.site.subtitle` | `<title>` 副标题（如 `同济网 - TONGJI.NET`） | 未使用，值为 `"Ellie admin console"` |
| `general.site.copyright` | 页脚版权行 | 硬编码 `"Comsenz Inc."`（`footer.ts:116`） |
| `general.site.powered_by` | 页脚 powered by | 硬编码 `"Discuz! X3.2"`（`footer.ts:115`） |
| `general.og.*` | `<meta>` OG / Twitter Card 标签 | Root layout metadata 为静态值 |
| `general.assets.avatar_cdn_base` | 头像 URL 拼接 | 硬编码 `"https://t.no.mt/avatar"`（`avatar.ts:4`） |
| `general.navigation.header_links` | 顶部导航栏 tab | 硬编码 `HEADER_NAV_TABS`（`header.ts:59-71`，11 项） |
| `general.navigation.friend_links` | 首页底部友情链接 | 硬编码 `FRIEND_LINKS`（`footer.ts:60-89`，28 项） |
| — | HTML `<title>` | 全站所有页面（含管理后台）均显示 `"Ellie Admin"`（`layout.tsx:12`），无 per-page title、无 title template |

### 1.2 已就绪的基建

- ✅ 公共 API：`GET /api/v1/settings`（KV 缓存 24h，写入时立即失效）
- ✅ 桥接函数：`fetchPublicSettings()` 已定义在 `viewmodels/forum/settings.server.ts`
- ✅ 管理 UI：通用设置 + 导航链接 + 友情链接三个页面已上线
- ❌ **缺失**：论坛前端没有任何 consumer 调用 `fetchPublicSettings()`

---

## 2. 设计原则

### 2.1 Layout / Page 各自 fetch，依赖 Next.js 去重

`fetchPublicSettings()` 在 `(forum)/layout.tsx` 和 `(forum)/page.tsx` 中各调用一次。Layout 无法直接向 Page 传递 props（Next.js 限制），因此两处独立 fetch，依赖 **Next.js Server Component 的请求级去重**（同一渲染周期内相同 URL 只发一次实际请求）。

**理由**：
- Layout 需要 settings 来构建 header / footer ViewModel
- Page 需要 settings 来构建 homeFooter ViewModel（友情链接）
- Next.js 的 `fetch` 去重保证两次调用只产生一次网络请求，无性能损失
- 避免引入 Context / Provider 等额外复杂度

### 2.2 Builder 函数签名变更

当前 `buildHeaderViewModel` 已有 `user` 和 `stats` 参数（均有默认值），`buildGlobalFooterViewModel` 和 `buildHomeFooterViewModel` 为零参数。统一在现有参数基础上追加 `settings: SettingsMap` 参数：

```ts
// Before
export function buildHeaderViewModel(
    user?: HeaderUserInfo | null,
    stats?: HeaderStats,
): HeaderViewModel

// After — 追加 settings 参数
export function buildHeaderViewModel(
    settings: SettingsMap,
    user?: HeaderUserInfo | null,
    stats?: HeaderStats,
): HeaderViewModel
```

hardcode 常量作为 `settings` 中对应 key 缺失时的 fallback 默认值，确保即使 API 异常也不会白屏。

### 2.3 组件层需配合改动

大部分变更在 ViewModel 层和 Layout 层完成，但以下组件存在硬编码或未消费 VM 字段的问题，需要配合修改：

| 组件 | 问题 | 改动 |
|------|------|------|
| `site-footer.tsx` | 硬编码 `"同济网 TONGJI.NET"`（:37）；版权行硬编码 `"2002-{year} TONGJI.NET"`（:41）；`vm.poweredBy` / `vm.copyrightHolder` / `vm.icpNumber` 已定义但从未渲染 | 改为消费 `vm.siteName`、`vm.copyrightHolder`、`vm.poweredBy` |
| `forum-header.tsx` | 直接调用 `getAvatarUrl(user.uid, "middle")`（:65），无法接收 cdnBase | 改为调用 `getAvatarUrl(user.uid, "middle", vm.avatarCdnBase)` |

> **头像 CDN 其余调用点**（`post-card.tsx`、`post-sidebar.tsx`、`messages-page.tsx`、`users/[id]/page.tsx`）本次不改。`avatar.ts` 新增的 `cdnBase` 参数有默认值，现有调用不传参仍使用原 CDN，不会 break。全站头像 CDN 统一改造放入 §8 后续工作。

### 2.4 HTML `<title>` 策略

当前全站所有页面 `<title>` 均为 `"Ellie Admin"`。需要分前后台分别处理。

#### 2.4.1 后台 Title

格式：**`管理控制台 | {品牌名}`**

通过 `(admin)/layout.tsx` 的 `generateMetadata` 从 settings 读取 `general.site.name`。后台各页面无需 per-page title（管理页面不需要 SEO）。

示例：`管理控制台 | 同济网`

#### 2.4.2 前台 Title

格式：**`{面包屑} - {品牌名} - {副标题}`**

- 品牌名 ← `general.site.name`（如 `同济网`）
- 副标题 ← `general.site.subtitle`（如 `TONGJI.NET`）
- 面包屑 ← 各页面已有的数据（thread.subject、forum.name 等）

**Title 拼接规则**：

| 页面 | `<title>` 示例 | 数据来源 |
|------|---------------|---------|
| 首页 `/` | `同济网 - TONGJI.NET` | `site.name` + `site.subtitle` |
| 版块 `/forums/2` | `就业实习 - 同济网 - TONGJI.NET` | `forum.name` |
| 帖子 `/threads/123` | `求租嘉定校区附近一室户 - 同济网 - TONGJI.NET` | `thread.subject` |
| 用户 `/users/456` | `张三的个人资料 - 同济网 - TONGJI.NET` | `user.username` |
| 搜索 `/search?q=租房` | `搜索: 租房 - 同济网 - TONGJI.NET` | URL param `q` |
| 发帖 `/forums/2/new-thread` | `发表帖子 - 就业实习 - 同济网 - TONGJI.NET` | `forumName` |
| 消息 `/messages` | `消息 - 同济网 - TONGJI.NET` | 静态 |
| 精华 `/digest` | `精华帖 - 同济网 - TONGJI.NET` | 静态 |
| 登录 `/login` | `登录 - 同济网 - TONGJI.NET` | 静态 |
| 注册 `/register` | `注册 - 同济网 - TONGJI.NET` | 静态 |

**实现方式**：

- **`(forum)/layout.tsx`** 设置 title template：`{ template: "%s - 同济网 - TONGJI.NET", default: "同济网 - TONGJI.NET" }`
- **动态页面**（thread、forum、user、search、new-thread）在各自 `page.tsx` 中 export `generateMetadata`，仅返回面包屑部分（如 `{ title: thread.subject }`），Next.js 自动套入 template
- **静态页面**（login、register、messages、digest）export `metadata = { title: "登录" }` 即可
- **不需要额外 API 调用**——动态页面已有 fetch 数据（thread.subject、forum.name 等），`generateMetadata` 可调用相同的 loader

#### 2.4.3 Root Layout 角色变更

`app/layout.tsx` 的 `metadata` 仅作为最终兜底（所有 layout/page 都没设 title 时才用），改为：

```ts
export const metadata: Metadata = {
    title: "Ellie",
    description: "",
};
```

实际 title 由 `(admin)/layout.tsx` 和 `(forum)/layout.tsx` 各自的 `generateMetadata` 覆盖。

### 2.5 OG Metadata

Next.js 的 `generateMetadata()` 是 layout/page 级 export，不走 ViewModel 层。直接在 `(forum)/layout.tsx` 的 `generateMetadata` 中读取 `general.og.*` 设置，生成 OpenGraph 和 Twitter Card 标签。

---

## 3. 变更文件清单

| # | 文件 | 变更类型 | 说明 |
|---|------|---------|------|
| F1 | `apps/web/src/viewmodels/forum/settings.server.ts` | 增强 | 增加 typed helper（`getStr`、`getNum`、`getArr`） |
| F2 | `apps/web/src/viewmodels/forum/header.ts` | 改造 | `buildHeaderViewModel(settings, user, stats)` 从 settings 读取 `header_links`，并将 `avatarCdnBase` 注入 VM |
| F3 | `apps/web/src/viewmodels/forum/footer.ts` | 改造 | `buildGlobalFooterViewModel(settings)` + `buildHomeFooterViewModel(settings)` 从 settings 读取品牌、友链 |
| F4 | `apps/web/src/lib/avatar.ts` | 改造 | `getAvatarUrl` 接受 `cdnBase` 参数，保留默认值向后兼容 |
| F5 | `apps/web/src/app/(forum)/layout.tsx` | 改造 | 变为 `async`，调用 `fetchPublicSettings()`，注入 builder；export `generateMetadata`（title template + OG） |
| F6 | `apps/web/src/app/(forum)/page.tsx` | 改造 | 调用 `fetchPublicSettings()`（去重），传递给 `buildHomeFooterViewModel(settings)` |
| F7 | `apps/web/src/components/forum/site-footer.tsx` | 改造 | 移除硬编码品牌名 / 版权行，改为消费 `vm.siteName`、`vm.copyrightHolder`、`vm.poweredBy` |
| F8 | `apps/web/src/components/forum/forum-header.tsx` | 微调 | `getAvatarUrl` 调用传入 `vm.avatarCdnBase` |
| F9 | `apps/web/src/app/layout.tsx` | 微调 | Root metadata 改为纯兜底 |
| F10 | `apps/web/src/app/(admin)/layout.tsx` | 改造 | 新增 `generateMetadata`，title 设为 `"管理控制台 \| {品牌名}"` |
| F11 | `apps/web/src/app/(forum)/threads/[id]/page.tsx` | 新增 | export `generateMetadata`，title = `thread.subject` |
| F12 | `apps/web/src/app/(forum)/forums/[id]/page.tsx` | 新增 | export `generateMetadata`，title = `forum.name` |
| F13 | `apps/web/src/app/(forum)/users/[id]/page.tsx` | 新增 | export `generateMetadata`，title = `"{用户名}的个人资料"` |
| F14 | `apps/web/src/app/(forum)/search/page.tsx` | 新增 | export `generateMetadata`，title = `"搜索: {query}"` 或 `"搜索"` |
| F15 | `apps/web/src/app/(forum)/forums/[id]/new-thread/page.tsx` | 新增 | export `generateMetadata`，title = `"发表帖子 - {forumName}"` |
| F16 | 静态页面（login、register、messages、digest） | 新增 | 各 export `metadata = { title: "页面名" }` |

---

## 4. 详细变更设计

### 4.1 F1 — settings.server.ts 增强

在现有 `fetchPublicSettings()` 基础上，增加类型安全的 helper 函数：

```ts
// 已有
export async function fetchPublicSettings(): Promise<SettingsMap> { ... }

// 新增：typed accessor helpers
export function getStr(settings: SettingsMap, key: string, fallback: string): string;
export function getNum(settings: SettingsMap, key: string, fallback: number): number;
export function getArr<T>(settings: SettingsMap, key: string, fallback: T[]): T[];
```

**理由**：`SettingsMap` 的 value 是 `string | number | boolean | object` 联合类型，直接取值需要大量类型断言。Helper 函数封装类型转换 + fallback 逻辑。

---

### 4.2 F2 — header.ts 改造

**变更前**：

```ts
const HEADER_NAV_TABS: NavTab[] = [
    { label: "同济网论坛", href: "/" },
    { label: "就业实习",   href: "/forums/2" },
    // ... 11 items hardcoded
];

export function buildHeaderViewModel(
    user: HeaderUserInfo | null = PLACEHOLDER_USER,
    stats: HeaderStats = PLACEHOLDER_STATS,
): HeaderViewModel {
    return {
        user,
        navTabs: HEADER_NAV_TABS,
        hotKeywords: HOT_KEYWORDS,
        stats,
    };
}
```

**变更后**：

```ts
import type { SettingsMap } from "./settings.server";
import { getArr, getStr } from "./settings.server";

// HEADER_NAV_TABS 保留为 fallback 默认值
const DEFAULT_NAV_TABS: NavTab[] = [ /* 原数据不动 */ ];

export function buildHeaderViewModel(
    settings: SettingsMap,
    user: HeaderUserInfo | null = PLACEHOLDER_USER,
    stats: HeaderStats = PLACEHOLDER_STATS,
): HeaderViewModel {
    const headerLinks = getArr<{ label: string; url: string }>(
        settings, "general.navigation.header_links", []
    );

    // settings 中的 link 结构 { label, url } → NavTab 结构 { label, href }
    const navTabs: NavTab[] = headerLinks.length > 0
        ? headerLinks.map(link => ({ label: link.label, href: link.url }))
        : DEFAULT_NAV_TABS;

    const avatarCdnBase = getStr(settings, "general.assets.avatar_cdn_base", "https://t.no.mt/avatar");

    return {
        user,
        navTabs,
        hotKeywords: HOT_KEYWORDS,
        stats,
        avatarCdnBase,  // 新增，供组件传给 getAvatarUrl
    };
}
```

**注意**：
- `settings` 作为第一个参数（必填），`user` 和 `stats` 仍保留默认值
- Settings 中 link 格式 `{ label, url }` → NavTab 格式 `{ label, href }`，需做字段映射
- `avatarCdnBase` 注入 `HeaderViewModel`，供 `forum-header.tsx` 传给 `getAvatarUrl`

---

### 4.3 F3 — footer.ts 改造

**两个 builder 都改为接受 `settings` 参数。**

#### buildGlobalFooterViewModel(settings)

```ts
// Before
export function buildGlobalFooterViewModel(): GlobalFooterViewModel {
    return {
        poweredBy: "Discuz! X3.2",
        copyrightHolder: "Comsenz Inc.",
        // ...
    };
}

// After
export function buildGlobalFooterViewModel(settings: SettingsMap): GlobalFooterViewModel {
    return {
        siteName:        getStr(settings, "general.site.name", "Ellie"),
        poweredBy:       getStr(settings, "general.site.powered_by", "Powered by Ellie"),
        copyrightHolder: getStr(settings, "general.site.copyright", "同济网"),
        // ...
    };
}
```

**GlobalFooterViewModel 接口新增 `siteName` 字段**，供 `site-footer.tsx` 替换硬编码。

#### buildHomeFooterViewModel(settings)

```ts
// Before
export function buildHomeFooterViewModel(): HomeFooterViewModel {
    return {
        friendLinks: FRIEND_LINKS,    // 28 条 hardcoded
        onlineStats: PLACEHOLDER_ONLINE_STATS,
    };
}

// After
export function buildHomeFooterViewModel(settings: SettingsMap): HomeFooterViewModel {
    const friendLinks = getArr<{ label: string; url: string }>(
        settings, "general.navigation.friend_links", []
    );

    return {
        friendLinks: friendLinks.map(link => ({
            label: link.label,
            href: link.url,
        })),
        onlineStats: PLACEHOLDER_ONLINE_STATS,
    };
}
```

**注意**：Settings 中的格式 `{ label, url }` 映射为 `FriendLink` 的 `{ label, href }`——字段名是 `label`（不是 `name`），与 `FriendLink` 接口定义和 `home-footer.tsx` 的消费方式一致。

---

### 4.4 F4 — avatar.ts 改造

```ts
// Before
const AVATAR_CDN_BASE = "https://t.no.mt/avatar";

export function getAvatarUrl(uid: number, size?: "small" | "middle" | "big"): string {
    // 使用 AVATAR_CDN_BASE
}

// After
const DEFAULT_CDN_BASE = "https://t.no.mt/avatar";

export function getAvatarUrl(
    uid: number,
    size?: "small" | "middle" | "big",
    cdnBase: string = DEFAULT_CDN_BASE,
): string {
    // 使用 cdnBase 参数
}
```

`cdnBase` 有默认值，所以**现有所有调用点不加参数也不会 break**。本次仅改造 `forum-header.tsx`（通过 HeaderViewModel 已有通道），其余调用点保持使用默认值。

**本次改造**：

| 调用点 | 改造方式 |
|--------|---------|
| `forum-header.tsx:65` | 从 `vm.avatarCdnBase` 读取（Header VM 已注入） |

**后续改造**（见 §8）：

| 调用点 | 改造思路 |
|--------|---------|
| `post-card.tsx:58` | 通过 props 从父组件接收 `avatarCdnBase` |
| `post-sidebar.tsx:39` | 同上 |
| `users/[id]/page.tsx:91` | Server Component，可独立 `fetchPublicSettings()` 后传入 |
| `messages-page.tsx:180` | Client Component，无法直接调 `settings.server.ts`；需由路由页 `messages/page.tsx`（Server Component）读取 settings 后通过 props / VM 传入 |

### 4.4a F8 — forum-header.tsx 微调

```tsx
// Before
<img src={getAvatarUrl(user.uid, "middle")} ... />

// After
<img src={getAvatarUrl(user.uid, "middle", vm.avatarCdnBase)} ... />
```

---

### 4.5 F5 — (forum)/layout.tsx 改造

这是核心接线点。

```tsx
// Before
import { buildHeaderViewModel } from "@/viewmodels/forum/header";
import { buildGlobalFooterViewModel } from "@/viewmodels/forum/footer";

export default function ForumLayout({ children }) {
    const headerVm = buildHeaderViewModel();
    const footerVm = buildGlobalFooterViewModel();
    // ...
}

// After
import { fetchPublicSettings } from "@/viewmodels/forum/settings.server";
import { getStr } from "@/viewmodels/forum/settings.server";
import { buildHeaderViewModel } from "@/viewmodels/forum/header";
import { buildGlobalFooterViewModel } from "@/viewmodels/forum/footer";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
    const settings = await fetchPublicSettings();
    const siteName = getStr(settings, "general.site.name", "Ellie");
    const subtitle = getStr(settings, "general.site.subtitle", "");

    // 拼接后缀：`同济网 - TONGJI.NET` 或仅 `同济网`
    const suffix = subtitle ? `${siteName} - ${subtitle}` : siteName;

    return {
        title: {
            template: `%s - ${suffix}`,   // 子页面：`帖子标题 - 同济网 - TONGJI.NET`
            default: suffix,               // 首页：`同济网 - TONGJI.NET`
        },
        description: getStr(settings, "general.og.description", ""),
        openGraph: {
            title:       getStr(settings, "general.og.title", "") || undefined,
            description: getStr(settings, "general.og.description", "") || undefined,
            siteName:    getStr(settings, "general.og.site_name", "") || undefined,
            images:      getStr(settings, "general.og.image", "")
                             ? [getStr(settings, "general.og.image", "")]
                             : undefined,
            url:         getStr(settings, "general.og.url", "") || undefined,
        },
        twitter: {
            card: (getStr(settings, "general.og.twitter_card", "summary")) as "summary",
            site: getStr(settings, "general.og.twitter_site", "") || undefined,
        },
    };
}

export default async function ForumLayout({ children }) {
    const settings = await fetchPublicSettings();

    const headerVm = buildHeaderViewModel(settings);
    const footerVm = buildGlobalFooterViewModel(settings);

    return (
        <ForumLayoutShell headerVm={headerVm} footerVm={footerVm}>
            <SessionGuard />
            {children}
        </ForumLayoutShell>
    );
}
```

**关键点**：
- Layout 变为 `async` Server Component
- `title` 使用 Next.js **template 模式**：子页面 export `{ title: "帖子标题" }` 后自动套入 `"%s - 同济网 - TONGJI.NET"`
- `fetchPublicSettings()` 在 `generateMetadata` 和 `default export` 中各调用一次，Next.js 会自动去重
- Settings 通过参数注入 builder，不新增 Context / Provider

### 4.5a F9 — app/layout.tsx 微调

Root layout 仅作为最终兜底：

```ts
// Before
export const metadata: Metadata = {
    title: "Ellie Admin",
    description: "Ellie admin console",
};

// After
export const metadata: Metadata = {
    title: "Ellie",
    description: "",
};
```

### 4.5b F10 — (admin)/layout.tsx 改造

管理后台新增 `generateMetadata`，从 settings 读取品牌名：

```tsx
import { fetchPublicSettings } from "@/viewmodels/forum/settings.server";
import { getStr } from "@/viewmodels/forum/settings.server";

export async function generateMetadata(): Promise<Metadata> {
    const settings = await fetchPublicSettings();
    const siteName = getStr(settings, "general.site.name", "Ellie");

    return {
        title: `管理控制台 | ${siteName}`,
    };
}
```

### 4.5c F11–F16 — 各论坛页面 per-page title

**动态页面**通过 `generateMetadata` 返回面包屑部分，Layout template 自动拼接后缀：

```tsx
// threads/[id]/page.tsx
export async function generateMetadata({ params }): Promise<Metadata> {
    const data = await loadThreadDetail({ threadId: params.id });
    return { title: data.thread.subject };
}
// 最终 <title>：求租嘉定校区附近一室户 - 同济网 - TONGJI.NET

// forums/[id]/page.tsx
export async function generateMetadata({ params }): Promise<Metadata> {
    const data = await loadThreadListPaged({ forumId: params.id });
    return { title: data.forum.name };
}
// 最终 <title>：就业实习 - 同济网 - TONGJI.NET

// users/[id]/page.tsx
export async function generateMetadata({ params }): Promise<Metadata> {
    const data = await loadUserProfile({ userId: params.id });
    return { title: `${data.user.username}的个人资料` };
}
// 最终 <title>：张三的个人资料 - 同济网 - TONGJI.NET

// search/page.tsx
export async function generateMetadata({ searchParams }): Promise<Metadata> {
    const query = searchParams.q;
    return { title: query ? `搜索: ${query}` : "搜索" };
}

// forums/[id]/new-thread/page.tsx
export async function generateMetadata({ params }): Promise<Metadata> {
    const data = await loadNewThreadPageData(params.id);
    return { title: `发表帖子 - ${data.forumName}` };
}
```

**静态页面**直接 export `metadata` 常量：

```tsx
// login/page.tsx
export const metadata: Metadata = { title: "登录" };

// register/page.tsx
export const metadata: Metadata = { title: "注册" };

// messages/page.tsx
export const metadata: Metadata = { title: "消息" };

// digest/page.tsx
export const metadata: Metadata = { title: "精华帖" };
```

> **注意**：动态页面的 `generateMetadata` 和 `default export` 会各自调用 loader——Next.js 对同一 fetch URL 做请求级去重，不会产生双倍 API 调用。

---

### 4.6 F6 — (forum)/page.tsx 改造

Layout 无法向 Page 传 props，所以 page.tsx 独立调用 `fetchPublicSettings()`。Next.js 在同一渲染周期会对相同 URL 去重，实际只产生一次网络请求。

```tsx
// Before
import { buildHomeFooterViewModel } from "@/viewmodels/forum/footer";

// 内部
<HomeFooter vm={buildHomeFooterViewModel()} />

// After
import { fetchPublicSettings } from "@/viewmodels/forum/settings.server";
import { buildHomeFooterViewModel } from "@/viewmodels/forum/footer";

export default async function HomePage() {
    const settings = await fetchPublicSettings(); // Next.js 去重，与 layout 不产生重复请求

    // ...
    return (
        <>
            {/* ... */}
            <HomeFooter vm={buildHomeFooterViewModel(settings)} />
        </>
    );
}
```

---

### 4.7 F7 — site-footer.tsx 改造

当前 `site-footer.tsx` 存在多处硬编码，且 VM 中已有的 `poweredBy` / `copyrightHolder` / `icpNumber` 字段完全未被渲染：

```tsx
// Before (line 37) — 品牌名硬编码
<span>同济网 TONGJI.NET</span>

// Before (line 41) — 版权行硬编码
© 2002-{new Date().getFullYear()} TONGJI.NET, All rights reserved.

// vm.poweredBy、vm.copyrightHolder、vm.icpNumber 均未渲染
```

**变更后**：

```tsx
// 品牌名从 VM 读取
<span>{vm.siteName}</span>

// 版权行从 VM 读取
© {vm.copyrightYears} {vm.copyrightHolder}, All rights reserved.

// powered by 从 VM 读取（新增渲染位置）
<span>{vm.poweredBy}</span>
```

**前提**：§4.3 中 `GlobalFooterViewModel` 已新增 `siteName` 字段。`poweredBy`、`copyrightHolder`、`copyrightYears`、`icpNumber` 字段接口中已有定义，此处是让组件真正消费它们。

---

## 5. 数据流全景

```
┌─────────────────────────────────────────────────────────────────┐
│                       Admin 写入路径（已完成）                    │
│  Admin UI → BFF proxy → PUT /api/admin/settings → D1 + KV 失效  │
└─────────────────────────────────────────────────────────────────┘
                              ↓ 数据已持久化
┌─────────────────────────────────────────────────────────────────┐
│                      Forum 读取路径（本次新增）                   │
│                                                                 │
│  fetchPublicSettings() ─── Next.js 请求级去重 ───┐              │
│       │                                          │              │
│  (forum)/layout.tsx                       (forum)/page.tsx      │
│       │                                          │              │
│       ├─ generateMetadata()                      │              │
│       │    ├─ title: { template: "%s - 品牌 - 副标题" }          │
│       │    └─ OG tags ← general.og.*             │              │
│       │                                          │              │
│       ├─ buildHeaderViewModel(settings)          │              │
│       │    ├─ navTabs ← general.navigation.*     │              │
│       │    └─ avatarCdnBase ← general.assets.*   │              │
│       │                                          │              │
│       └─ buildGlobalFooterViewModel(settings)    │              │
│            └─ siteName, copyright, poweredBy     │              │
│               ← general.site.*                   │              │
│                                       buildHomeFooterViewModel  │
│                                        └─ friendLinks           │
│                                           ← general.navigation.*│
│                                                                 │
│  各 page.tsx（threads, forums, users, ...）                     │
│       └─ generateMetadata() → { title: 面包屑 }                 │
│          Next.js template 自动拼接: 面包屑 - 品牌 - 副标题      │
│                                                                 │
│  (admin)/layout.tsx                                             │
│       └─ generateMetadata()                                     │
│            └─ title: "管理控制台 | 品牌名"                      │
│                                                                 │
│  avatar.ts                                                      │
│       └─ cdnBase 参数化，默认值向后兼容                          │
│          第一阶段仅 forum-header 传入 vm.avatarCdnBase           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 实现步骤

按依赖顺序，每步一个原子化 commit：

| Step | 任务 | 涉及文件 | 说明 |
|------|------|---------|------|
| 1 | settings.server.ts 增加 typed helpers | F1 | 纯工具函数，无副作用 |
| 2 | header.ts 接受 settings 参数 | F2 | builder 签名变更（settings 插入为第一参数），hardcode 降级为 fallback；HeaderViewModel 新增 `avatarCdnBase` |
| 3 | footer.ts 接受 settings 参数 | F3 | 两个 builder 签名变更；GlobalFooterViewModel 新增 `siteName`；FriendLink 映射 `{ label, href }` |
| 4 | avatar.ts 参数化 cdnBase | F4 | 新增 `cdnBase` 可选参数，默认值保持向后兼容 |
| 5 | Root layout 改为兜底 | F9 | title 改为 `"Ellie"`，去掉 `"Ellie Admin"` |
| 6 | Forum layout 接线 | F5 | Layout 变 async + generateMetadata（title template + OG） |
| 7 | Admin layout 接线 | F10 | 新增 generateMetadata，title = `"管理控制台 \| {品牌名}"` |
| 8 | Forum page 接线 | F6 | Homepage 独立 fetch（去重），传递给 homeFooter builder |
| 9 | 组件层改造 | F7, F8 | site-footer 消费 VM 品牌/版权字段；forum-header 传入 avatarCdnBase |
| 10 | 各页面 per-page title | F11–F16 | 动态页面 generateMetadata + 静态页面 metadata export |
| 11 | 清理死代码 | F2, F3 | 确认无引用后删除原 hardcode 常量（如 FRIEND_LINKS、HEADER_NAV_TABS） |

```
Step 1 → Step 2 ─┐
                  ├→ Step 6 ─→ Step 8 ─→ Step 10 ─→ Step 11
Step 1 → Step 3 ─┘                │
Step 1 → Step 4 ─────────────────→ Step 9
Step 5 ──────────→ Step 6
                  → Step 7
```

---

## 7. 验证清单

- [ ] 管理后台修改 `general.site.name` → 论坛页脚品牌名同步更新
- [ ] 管理后台修改 `general.site.copyright` → 论坛页脚版权行同步更新
- [ ] 管理后台修改 `general.site.powered_by` → 论坛页脚署名同步更新
- [ ] 管理后台修改 `general.navigation.header_links`（增删改排序）→ 论坛顶部导航同步更新
- [ ] 管理后台修改 `general.navigation.friend_links` → 首页友情链接区域同步更新
- [ ] 管理后台配置 `general.og.*` → 页面源码包含正确 `<meta>` OG 标签
- [ ] 管理后台修改 `general.assets.avatar_cdn_base` → 头像 URL 使用新 CDN
- [ ] **后台 title**：管理页面 `<title>` 显示 `"管理控制台 | {品牌名}"`
- [ ] **前台首页 title**：`<title>` 显示 `"{品牌名} - {副标题}"`（如 `同济网 - TONGJI.NET`）
- [ ] **帖子页 title**：`<title>` 显示 `"{帖子标题} - {品牌名} - {副标题}"`
- [ ] **版块页 title**：`<title>` 显示 `"{版块名} - {品牌名} - {副标题}"`
- [ ] **用户页 title**：`<title>` 显示 `"{用户名}的个人资料 - {品牌名} - {副标题}"`
- [ ] **静态页面 title**：登录/注册/消息/精华帖 `<title>` 正确显示页面名 + 后缀
- [ ] Settings API 不可达时 → 页面使用 fallback 默认值正常渲染，不白屏
- [ ] `bun run typecheck` 通过
- [ ] `bun test apps/worker` 无回归
- [ ] `bun test tests/unit/` 无回归

---

## 8. 不在本次范围

| 后续工作 | 说明 |
|---------|------|
| 其余头像调用点传入 cdnBase | `post-card.tsx`、`post-sidebar.tsx`、`users/[id]/page.tsx` 可直接改造；`messages-page.tsx` 是 Client Component，需由路由页 `messages/page.tsx`（Server Component）读取 settings 后通过 props 传入 |
| Worker handler 消费分页设置 | thread / post handler 的 `DEFAULT_PAGE_SIZE` → `getSetting()` 动态读取 |
| 前端 `HOT_KEYWORDS` 动态化 | 搜索热词目前 hardcoded，需新增 settings key |
| 前端 `FOOTER_QUICK_LINKS` 动态化 | 页脚快速链接，需新增 settings key |
| Logo URL 动态化 | 页头 / 页脚 logo 图片 URL 需新增 settings key |
| 前端 ISR / revalidate | 当前依赖 Next.js 默认 fetch cache；如需更精确的缓存控制可添加 `revalidate` 配置 |
