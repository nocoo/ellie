# 04a — MVVM 与数据结构

> 基于 Doc02 D1 schema 推导前端 Model 层。定义 TypeScript 类型、权限模型、Repository 接口和内容格式规约。

## 前端 Model 与 D1 Schema 的关系

前端 Model 层的类型定义**严格对齐** Doc02 中的 5 张 D1 表。字段名从 snake_case 转为 camelCase，枚举值保持一致。

```
D1 Schema (Doc02)          Frontend Model (本文档)
─────────────────          ──────────────────────
users                  →   User interface
forums                 →   Forum interface
threads                →   Thread interface
posts                  →   Post interface
attachments            →   Attachment interface
```

---

## 核心类型定义

### 枚举

```typescript
// models/types.ts

/** 用户角色 — 对应 Doc02 users.role (来自 DZ adminid) */
export enum UserRole {
  User = 0,      // 普通用户
  Admin = 1,     // 管理员 — 全站权限
  SuperMod = 2,  // 超级版主 — 论坛前端所有版块版主操作
  Mod = 3,       // 版主 — 仅所辖版块（需 moderators 映射表）
}

/** 用户状态 — 对应 Doc02 users.status */
export enum UserStatus {
  Active = 0,    // 正常
  Banned = -1,   // 封禁/冻结 — 禁止登录
  Archived = -2, // 归档 — DZ 自动归档长期不登录用户，禁止登录
}

/** 置顶等级 — 对应 Doc02 threads.sticky (来自 DZ displayorder) */
export enum StickyLevel {
  None = 0,      // 普通
  Forum = 1,     // 版块置顶
  Global = 2,    // 全局置顶
  Category = 3,  // 分类置顶
}

/** 版块类型 — 对应 Doc02 forums.type */
export enum ForumType {
  Group = "group",  // 分类（顶级容器，不直接包含帖子）
  Forum = "forum",  // 版块（包含帖子的主要单元）
  Sub = "sub",      // 子版块
}
```

> **注意**：Thread.special 字段（0~5）不定义为枚举。值为 0=普通, 1=投票, 2=交易, 3=悬赏, 4=活动, 5=辩论，当前阶段仅作为只读标签展示（详见 04e）。

### 实体接口

以下接口与 Doc02 中对应表的**每一个字段**一一对应。

#### User

```typescript
/** 对应 Doc02 §users — 114 万行 */
export interface User {
  id: number;          // PK — DZ uid
  username: string;    // UNIQUE — 来自 uc_members
  email: string;       // 来自 uc_members
  avatar: string;      // R2 key: "avatars/{uid}.jpg" 或 ""（无头像）
  status: UserStatus;  // 0=正常, -1=封禁, -2=归档
  role: UserRole;      // 0=user, 1=admin, 2=super-mod, 3=mod
  regDate: number;     // Unix timestamp — DZ regdate
  lastLogin: number;   // Unix timestamp — DZ lastlogintime
  threads: number;     // 发帖数 — 来自 pre_common_member_count
  posts: number;       // 回帖数 — 来自 pre_common_member_count
  credits: number;     // 积分
}
```

> `password_hash` 和 `password_salt` **不进入前端 Model**。这两个字段仅在 API 认证层使用，前端永远看不到。

#### Forum

```typescript
/** 对应 Doc02 §forums — 213 行 */
export interface Forum {
  id: number;            // PK — DZ fid
  parentId: number;      // 父版块 fid，0=顶级分类
  name: string;
  description: string;   // 来自 pre_forum_forumfield
  icon: string;          // 版块图标路径
  displayOrder: number;  // 排序权重
  threads: number;       // 帖子数
  posts: number;         // 回帖数
  type: ForumType;       // "group" | "forum" | "sub"
  status: number;        // 0=隐藏, 1=正常
  lastThreadId: number;  // 最新帖子 tid
  lastPostAt: number;    // 最后发帖时间（Unix timestamp）
  lastPoster: string;    // 最后发帖人用户名
}
```

> 版块层级：`Group(type=group) → Forum(type=forum) → Sub(type=sub)`，通过 `parentId` 建立树形关系。

#### Thread

```typescript
/** 对应 Doc02 §threads — 79 万行 */
export interface Thread {
  id: number;            // PK — DZ tid
  forumId: number;       // FK → forums.id
  authorId: number;      // FK → users.id
  authorName: string;    // 反范式化用户名（即使用户被删也能展示）
  subject: string;       // 标题
  createdAt: number;     // Unix timestamp
  lastPostAt: number;    // 最后回复时间
  lastPoster: string;    // 最后回复者用户名
  replies: number;       // 回复数
  views: number;         // 浏览数
  closed: number;        // 0=开放, 1=锁定（>1 的合并帖已在迁移时过滤）
  sticky: StickyLevel;   // 置顶等级
  digest: number;        // 0=无, 1~3=精华等级
  special: number;       // 0=普通, 1=投票, 2=交易, 3=悬赏, 4=活动, 5=辩论
  highlight: number;     // 标题样式编码（颜色/粗体/斜体）
  recommends: number;    // 净推荐数
}
```

> `post_table_id` 不进入前端 Model。它是迁移时用于定位 DZ 分片表的内部字段，D1 统一存储后无意义。

#### Post

```typescript
/** 对应 Doc02 §posts — 940 万行 */
export interface Post {
  id: number;            // PK — DZ pid
  threadId: number;      // FK → threads.id
  forumId: number;       // FK → forums.id
  authorId: number;      // FK → users.id
  authorName: string;    // 反范式化用户名
  content: string;       // **sanitized HTML**（见下方内容格式规约）
  createdAt: number;     // Unix timestamp
  isFirst: boolean;      // true=主题首帖, false=回复
  position: number;      // 楼层号（从 1 开始）
}
```

#### Attachment

```typescript
/** 对应 Doc02 §attachments — 7.8 万行 */
export interface Attachment {
  id: number;            // PK — DZ aid
  threadId: number;      // FK → threads.id
  postId: number;        // FK → posts.id
  authorId: number;      // FK → users.id
  filename: string;      // 原始上传文件名
  filePath: string;      // R2 object key
  fileSize: number;      // 字节数
  isImage: boolean;      // 是否图片
  width: number;         // 图片宽度 px（非图片为 0）
  hasThumb: boolean;     // 是否有缩略图
  downloads: number;     // 下载次数（来自 DZ 索引表）
  createdAt: number;     // Unix timestamp
}
```

### 已知字段缺失（Doc02 辅助字段未迁移）

| Doc02 标记为"不存储" | 原始 DZ 字段 | 影响 |
|---------------------|-------------|------|
| `groupid` | pre_common_member.groupid | 无用户组权限分层 — 用 role 简化处理 |
| `readperm` | pre_forum_attachment_N.readperm | 无权限附件 — 所有附件视为公开 |
| `price` | pre_forum_attachment_N.price | 无付费附件 |
| `description` | pre_forum_attachment_N.description | 附件无备注文本 — 只展示文件名 |
| `invisible` (≠0) | pre_forum_post.invisible | 无被删除/待审核帖子数据 — 删除操作为物理删除（D1 DELETE），不可恢复 |

---

## 权限模型

### 角色与权限矩阵

| 操作 | User(0) | Mod(3) | SuperMod(2) | Admin(1) |
|------|---------|--------|-------------|----------|
| 浏览公开版块 | ✅ | ✅ | ✅ | ✅ |
| 发帖/回帖 | ✅ | ✅ | ✅ | ✅ |
| 删除自己的帖子 | ✅ | ✅ | ✅ | ✅ |
| 版主操作（置顶/加精/关闭/移动/删除） | ❌ | ✅ 所辖版块 | ✅ 所有版块 | ✅ |
| 访问管理后台 `/admin` | ❌ | ❌ | ❌ | ❌ |

> **Admin Console 独立于论坛用户体系**：管理后台通过 Google OAuth + `ADMIN_GOOGLE_IDS` 白名单认证，与论坛用户角色无关。上表中"版主操作"指论坛前端 `/api/v1/moderation/*` 端点，走 Key A + 论坛 JWT。

### 权限纯函数

```typescript
// models/permission.ts — 0 依赖纯函数，L1 测试覆盖

export function canViewForum(user: User | null, forum: Forum): boolean {
  return forum.status !== 0; // status=0 的版块不可见（管理员手动隐藏，D1 初始无此数据）
}

export function canCreateThread(user: User | null, _forum: Forum): boolean {
  if (!user) return false;
  return user.status === UserStatus.Active;
}

export function canReplyToThread(user: User | null, thread: Thread): boolean {
  if (!user) return false;
  if (user.status !== UserStatus.Active) return false;
  return thread.closed === 0; // 锁定帖不可回复
}

/**
 * 版主操作权限（置顶/加精/锁定/移动/删除他人帖子）。
 * 在论坛前端（/api/v1/moderation/*）中使用，走 Key A + 论坛用户 JWT。
 * - Admin (1) / SuperMod (2) / Mod (3)：均可在论坛前端执行版主操作
 * - 未来：Mod 需查询 moderators 表确认是否管辖该版块
 * 注意：此函数与 Admin Console 无关。Admin Console 通过 Google OAuth 认证。
 */
export function canModerate(user: User | null, _forumId: number): boolean {
  if (!user) return false;
  if (user.role === UserRole.Admin || user.role === UserRole.SuperMod) return true;
  if (user.role === UserRole.Mod) return true; // 简化：当前阶段无 moderators 表
  return false;
}

/**
 * @deprecated Admin Console 已改为 Google OAuth 认证，不再通过论坛用户角色判断。
 * 此函数仅用于论坛前端的历史兼容（如显示版主标识等），不用于 Admin Console 准入判断。
 */
export function canAccessAdmin(user: User | null): boolean {
  if (!user) return false;
  return user.role === UserRole.Admin || user.role === UserRole.SuperMod;
}

export function canManageUsers(user: User | null): boolean {
  if (!user) return false;
  return user.role === UserRole.Admin;
}

export function canDeletePost(
  user: User | null, post: Post, forumId: number,
): boolean {
  if (!user) return false;
  if (user.id === post.authorId) return true; // 作者可删自己
  return canModerate(user, forumId);
}
```

### 已知简化与未来扩展

| 简化 | 当前行为 | 未来需补充 |
|------|---------|-----------|
| 版主-版块映射 | Mod 拥有**所有**版块管理权限 | 新增 `moderators` 表（user_id + forum_id），`canModerate` 查询此表 |
| 用户组 | 不区分用户组 | 如需精细分层（如 VIP），新增 `user_groups` 表 |
| 发帖权限 | 所有 Active 用户可在所有版块发帖 | 如需版块级发帖限制，查询版块权限配置 |

---

## Repository 接口（Contract）

**Contract 先行**：以下接口在写任何 View 组件之前必须用 L1 测试锁定。Mock 实现和未来的 API 实现都必须满足同一套接口。

### 通用类型

```typescript
// data/repositories/types.ts

/** Keyset 分页结果 — 对应 Doc02 §分页策略 */
export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;  // null = 没有下一页
  prevCursor: string | null;  // null = 没有上一页（第一页）
  total: number;              // 近似总数（COUNT 查询，展示"共约 N 条"）
}

/** 通用分页参数 */
export interface PaginationParams {
  cursor?: string;            // 省略 = 第一页
  direction?: "forward" | "backward";  // 默认 "forward"
  limit?: number;             // 默认 20，上限 50
}
```

**Cursor 结构**：cursor 是 opaque string，内部编码为 `base64(JSON({ sortValue, id }))`。不同排序方式使用不同的 sortValue：
- `latest` 排序 → `{ sticky, lastPostAt, id }`  ← 注意：含 sticky，处理置顶帖
- `newest` 排序 → `{ createdAt, id }`
- `hot` 排序 → `{ replies, id }`

**Total 精度**：total 来自 `SELECT COUNT(*) FROM ... WHERE ...`，在 D1 上对已索引列是高效的。展示为"共约 N 条"，不保证实时精确。

### ForumRepository

```typescript
export interface UpdateForumInput {
  name?: string;
  description?: string;
  icon?: string;
  status?: number;          // 0=隐藏, 1=正常
  displayOrder?: number;
}

export interface ForumRepository {
  /** 获取所有版块（213 行，全量返回，不分页） */
  listAll(): Promise<Forum[]>;

  /** 按 ID 获取版块 */
  getById(id: number): Promise<Forum | null>;

  /** 更新版块信息（管理后台 04c 使用） */
  update(id: number, input: UpdateForumInput): Promise<void>;
}
```

### ThreadRepository

```typescript
export interface ThreadListParams extends PaginationParams {
  forumId?: number;          // 按版块筛选
  authorId?: number;         // 按作者筛选
  digest?: boolean;          // true = 只看精华
  createdAfter?: number;     // Unix timestamp — 仪表盘"今日新帖"
  sort?: "latest" | "newest" | "hot";
  // latest = 按 lastPostAt 降序（默认）
  // newest = 按 createdAt 降序
  // hot = 按 replies 降序
}

export interface ThreadSearchParams extends PaginationParams {
  /** 标题前缀匹配（LIKE 'query%'，pattern ≤50 bytes） */
  titlePrefix?: string;
  /** 作者精确匹配（WHERE author_name = 'xxx'） */
  authorName?: string;
}

export interface CreateThreadInput {
  forumId: number;
  subject: string;
  content: string;           // sanitized HTML
}

export interface ThreadRepository {
  list(params: ThreadListParams): Promise<PaginatedResult<Thread>>;
  search(params: ThreadSearchParams): Promise<PaginatedResult<Thread>>;
  getById(id: number): Promise<Thread | null>;
  create(input: CreateThreadInput): Promise<Thread>;
  delete(id: number): Promise<void>;
  /** 版主操作 */
  setSticky(id: number, level: StickyLevel): Promise<void>;
  setDigest(id: number, level: number): Promise<void>;
  setClosed(id: number, closed: boolean): Promise<void>;
  move(id: number, targetForumId: number): Promise<void>;
}
```

> **搜索限制**：`titlePrefix` 和 `authorName` 至少提供一个，否则抛出参数错误。D1 LIKE pattern 限 50 bytes。搜索结果按 `createdAt DESC` 排序，total 为精确计数。

### PostRepository

```typescript
export interface PostListParams extends PaginationParams {
  threadId?: number;         // 按帖子筛选（帖子详情页）
  authorId?: number;         // 按作者筛选（用户主页回帖历史）
}

export interface CreatePostInput {
  threadId: number;
  content: string;           // sanitized HTML
}

export interface PostRepository {
  list(params: PostListParams): Promise<PaginatedResult<Post>>;
  create(input: CreatePostInput): Promise<Post>;
  delete(id: number): Promise<void>;
}
```

> `PostListParams` 必须提供 `threadId` 或 `authorId` 至少一个，禁止全表扫描。

### UserRepository

```typescript
export interface UserListParams extends PaginationParams {
  search?: string;           // 按用户名模糊搜索（LIKE '%query%'）
  role?: UserRole;           // 按角色筛选
  status?: UserStatus;       // 按状态筛选
  lastLoginAfter?: number;   // Unix timestamp — 仪表盘"今日活跃用户"
  sort?: "newest" | "lastLogin";
  // newest = 按 regDate 降序（默认）
  // lastLogin = 按 lastLogin 降序
}

export interface UserRepository {
  list(params: UserListParams): Promise<PaginatedResult<User>>;
  getById(id: number): Promise<User | null>;
  /** 管理操作 */
  setStatus(id: number, status: UserStatus): Promise<void>;
  setRole(id: number, role: UserRole): Promise<void>;
}
```

### AttachmentRepository

```typescript
export interface AttachmentRepository {
  /** 获取帖子的附件列表 */
  listByPostId(postId: number): Promise<Attachment[]>;
  /** 获取主题的附件列表 */
  listByThreadId(threadId: number): Promise<Attachment[]>;
}
```

### Repository 工厂

```typescript
// data/index.ts
import type {
  ForumRepository, ThreadRepository, PostRepository,
  UserRepository, AttachmentRepository,
} from "./repositories/types";

// 当前阶段返回 Mock 实现
// Phase 2 Worker 就绪后切换为 API 实现
export function createRepositories(): {
  forums: ForumRepository;
  threads: ThreadRepository;
  posts: PostRepository;
  users: UserRepository;
  attachments: AttachmentRepository;
} {
  // ... 返回 Mock 或 API 实现
}
```

---

## 内容格式规约

### 唯一格式：sanitized HTML

| 阶段 | 流程 | 存储格式 |
|------|------|---------|
| 迁移（已完成） | DZ BBCode → `scripts/migrate/transform/bbcode.ts` → sanitized HTML | D1 posts.content |
| 运行时（新帖） | Tiptap 编辑器 → HTML 输出 → sanitize | D1 posts.content |
| 展示 | `posts.content` → AttachmentResolver → React `dangerouslySetInnerHTML` | — |

**运行时不做 BBCode 转换。** 所有 BBCode→HTML 在迁移阶段一次性完成。

### 附件渲染链路

迁移器将 `[attach]aid[/attach]` 转为 `<attachment data-aid="123"></attachment>` 占位元素（见 Doc03 §BBCode 转换表、`scripts/migrate/transform/bbcode.ts:180`）。

**客户端解析流程：**

```
D1 posts.content (含 <attachment data-aid="...">)
    │
    ▼
AttachmentResolver 组件（客户端）
    │  1. 解析 HTML 中的 <attachment data-aid> 元素
    │  2. 查询 AttachmentRepository.listByPostId(postId) 获取附件列表
    │  3. 用 aid 匹配附件记录，替换为实际渲染：
    │     - 图片附件 → <img src="R2_PUBLIC_URL/filePath">
    │     - 文件附件 → 下载链接
    │     - 匹配不到 → 展示"附件不存在"占位
    ▼
最终 HTML → dangerouslySetInnerHTML
```

**filePath → 公开 URL 规则：**

```typescript
// lib/attachment.ts
const R2_PUBLIC_BASE = process.env.NEXT_PUBLIC_R2_URL ?? "https://r2.example.com";

/** 将 Attachment.filePath (R2 object key) 转为公开访问 URL */
export function attachmentUrl(filePath: string): string {
  return `${R2_PUBLIC_BASE}/${filePath}`;
}

/** 缩略图 URL 规则：在 filePath 后追加 .thumb.jpg */
export function thumbnailUrl(filePath: string): string {
  return `${R2_PUBLIC_BASE}/${filePath}.thumb.jpg`;
}
```

**缩略图规则：**
- 只有 `hasThumb === true` 的图片附件才有缩略图
- 缩略图在迁移阶段已生成并上传到 R2（与原图同路径，追加 `.thumb.jpg`）
- 列表/帖子内嵌展示用缩略图，点击查看原图

### 表情处理

| 场景 | 处理方式 |
|------|---------|
| 旧帖 Smiley | 迁移阶段 BBCode 转换器已将 `{:smiley_code:}` 转为 `<img src="/smileys/...">` |
| 新帖 Emoji | Tiptap + emoji-mart 插入 Unicode Emoji，存为 HTML 文本节点 |

### Sanitize 规则

**迁移时（bbcode.ts，已实现）和运行时（新帖写入）使用同一套规则。** 以迁移器现有实现为 source of truth：

- **URL 协议白名单**：`http:`, `https:`, `ftp:`, `mailto:` + 相对路径（`/path`, `./path`, `#anchor`）
- 禁止 `javascript:`, `data:`, `vbscript:` 等危险协议
- 禁止 `<script>`, `<style>`, `on*` 事件属性
- 禁止 `<iframe>`, `<embed>`, `<object>`, `<applet>`, `<form>`, `<base>`, `<meta>`, `<link>` 标签
- CSS 值白名单：`color`（hex/命名色/rgb()）、`font-size`（SIZE_MAP 值或 Npx）、`text-align`（left/center/right/justify）
- `<img src>` 允许 R2 域名、`/smileys/` 路径、以及迁移数据中的合法相对路径
- `<attachment data-aid="N">` 是合法标签（由迁移器产出，客户端 AttachmentResolver 处理）

> **为什么允许 ftp: 和相对路径？** 迁移器 (`bbcode.ts:42`) 已经实现了此规则，D1 中已存储的历史数据包含这些 URL。运行时 sanitize 必须与迁移时一致，否则渲染会出错。新帖中 ftp: 链接极少出现（2026 年了），不值得为此增加两套规则。

### 隐藏版块说明

Doc02/Doc03 迁移查询 `WHERE f.status = 1`，**隐藏版块（status=0）未迁移到 D1**。因此：
- D1 中不存在 `status=0` 的版块记录
- 04c 版块管理的"隐藏/显示"操作：将 status 设为 0 意味着在前端隐藏，但数据仍在 D1 中（这是新数据，不是迁移遗漏）
- 04d 前端只展示 `status=1` 的版块，这是正确行为
- `canViewForum()` 的 `forum.status !== 0` 检查仍然有意义——它过滤管理员手动隐藏的版块

---

## 已知数据缺口汇总

| 功能 | 缺失内容 | 影响 | 处理方式 | 涉及文档 |
|------|---------|------|---------|---------|
| 版主映射 | 无 `moderators` 表 | Mod 无法绑定到具体版块 | 当前全局化，Phase 2 补表 | 04c |
| 私信 | 无 PM schema | 站内私信不可用 | 后置到 04e | 04e |
| 特殊帖子交互 | 无 poll/reward/trade 表 | 投票等交互不可用 | 只展示标签 | 04e |
| 帖子恢复 | invisible≠0 未迁移 | 无历史被删数据 | 删除为物理删除，不可恢复 | 04c |
| 权限/付费附件 | readperm/price 未迁移 | 所有附件公开 | 后置 | 04e |
| 附件描述 | description 未迁移 | 附件无备注 | 只展示文件名 | 04d |
| 全文搜索 | D1 不支持中文全文搜索 | 无内容级搜索 | MVP 仅标题前缀匹配 | 04e |
