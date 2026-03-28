# 04d — 论坛前端

> 论坛前端的布局、核心页面、分页策略、搜索和交互设计。
>
> **前置依赖**：04a（类型 + Repository 接口）、04b（架构 + 设计系统）

## 布局

论坛前端采用经典的顶部导航 + 内容区 + 页脚结构，面向所有用户（含未登录访客）。

```
┌───────────────────────────────────────────────────────────┐
│  TopBar (h-10) — 登录状态 / 快捷链接 / 主题切换 🌙          │
├───────────────────────────────────────────────────────────┤
│  ForumNavbar (h-14) — Logo + 主导航（首页/版块/精华/搜索）   │
├───────────────────────────────────────────────────────────┤
│  Breadcrumbs (h-10) — 首页 > 版块 > 帖子                   │
├───────────────────────────────────────────────────────────┤
│  Content (max-w-[1200px] mx-auto px-4)                    │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Page Content (bg-card rounded-[14px] p-6)          │  │
│  │  ┌─────────────────────────────────────────────┐    │  │
│  │  │  Inner Cards (bg-secondary rounded-[10px])   │    │  │
│  │  └─────────────────────────────────────────────┘    │  │
│  └─────────────────────────────────────────────────────┘  │
├───────────────────────────────────────────────────────────┤
│  SiteFooter — 版权 / 链接 / 备案号                          │
└───────────────────────────────────────────────────────────┘
```

### 路由结构

```
src/app/(forum)/
├── layout.tsx                    # ForumLayout: TopBar + Navbar + Breadcrumbs + Content + Footer
├── page.tsx                      # / — 论坛首页（版块列表）
├── forums/
│   └── [id]/page.tsx             # /forums/:id — 版块帖子列表
├── threads/
│   ├── [id]/page.tsx             # /threads/:id — 帖子详情 + 回复
│   └── new/page.tsx              # /threads/new?forumId=xx — 发帖（需登录）
├── users/
│   └── [id]/page.tsx             # /users/:id — 用户主页
├── digest/page.tsx               # /digest — 精华帖列表
└── search/page.tsx               # /search — 搜索结果
```

### 组件清单

```
src/components/forum/
├── ForumCard.tsx                  # 版块卡片（图标 + 名称 + 统计 + 最新帖）
├── ForumGroup.tsx                 # 版块分组（Group 标题 + 下属 Forum 列表）
├── ThreadList.tsx                 # 帖子列表容器
├── ThreadItem.tsx                 # 帖子行（标题 + 标签 + 作者 + 统计）
├── ThreadBadge.tsx                # 帖子标签（置顶/精华/锁定/特殊类型）
├── PostCard.tsx                   # 回复卡片（作者信息 + 内容 + 楼层号）
├── PostEditor.tsx                 # 富文本编辑器（→ 04e Tiptap）
├── UserCard.tsx                   # 帖子中的用户信息侧栏
├── UserAvatar.tsx                 # 用户头像（R2 路径）
├── ForumPagination.tsx            # Keyset 分页控件
└── SearchBar.tsx                  # 搜索输入框
```

### 布局组件

```
src/components/layout/
├── ForumLayout.tsx                # 整体壳：TopBar + Navbar + Breadcrumbs + Outlet + Footer
├── TopBar.tsx                     # 顶部工具栏
├── ForumNavbar.tsx                # 主导航栏
├── SiteFooter.tsx                 # 页脚
├── Breadcrumbs.tsx                # 面包屑导航（共享组件）
└── ThemeToggle.tsx                # 主题切换（共享组件）
```

**响应式行为**（与 04b 一致）：
- Desktop (>1024px): 全功能布局，max-w-[1200px] 居中
- Tablet (768-1024px): 导航折叠为汉堡菜单，内容区全宽
- Mobile (<768px): 单列布局，汉堡菜单，帖子列表简化（隐藏统计列）

---

## 核心页面

### 论坛首页（/）

展示所有版块的分组列表，按 Group → Forum → Sub 三级层次组织。

**展示内容：**

```
┌─ Group: 同济生活 ──────────────────────────────────────────┐
│                                                             │
│  ┌─ ForumCard ─────────────────────────────────────────┐   │
│  │ 🏫 同济新闻   "校园新闻和公告"                        │   │
│  │  帖子 12,345 · 回帖 98,765 · 最新: xxx 发表于 2h ago  │   │
│  │  └─ Sub: 院系动态 · 招聘信息                          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─ ForumCard ─────────────────────────────────────────┐   │
│  │ 💬 水源地    "灌水区，自由讨论"                         │   │
│  │  帖子 56,789 · 回帖 234,567 · 最新: yyy 发表于 5m ago │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**数据源：**
- `ForumRepository.listAll()` — 全量 213 个版块，前端构建树
- 复用 04a 的 `buildForumTree()` 纯函数

**ViewModel：**

```typescript
// viewmodels/useForumListViewModel.ts
export function useForumListViewModel() {
  const forums = useForumRepository();

  const tree = useMemo(() => buildForumTree(allForums), [allForums]);

  // 过滤隐藏版块（status=0）
  // 注：D1 中初始无 status=0 的版块（迁移时已过滤），
  // 但管理员可手动将版块 status 设为 0 进行隐藏
  const visibleTree = useMemo(
    () => tree.filter(group => filterVisibleForums(group)),
    [tree],
  );

  return {
    tree: visibleTree,
    loading, error,
  };
}
```

---

### 版块帖子列表（/forums/:id）

展示指定版块的帖子列表，支持排序、筛选和 keyset 分页。

**展示内容：**

```
┌─ 版块信息卡 ─────────────────────────────────────────────┐
│  🏫 同济新闻                                              │
│  校园新闻和公告                                            │
│  帖子 12,345 · 回帖 98,765                                │
└──────────────────────────────────────────────────────────┘

排序: [最新回复 ▼] [最新发布] [热门]   筛选: [只看精华]

┌─ 帖子列表 ───────────────────────────────────────────────┐
│  📌 [精华] 2024 级新生入学指南            浏览 12K · 回复 89│
│       作者: admin · 最后回复: 2h ago by user123            │
│                                                           │
│  🗳️ [投票] 食堂最佳窗口评选              浏览 5.6K · 回复 234│
│       作者: student01 · 最后回复: 30m ago by user456       │
│                                                           │
│  普通帖子标题                             浏览 123 · 回复 5 │
│       作者: user789 · 最后回复: 1d ago by user012          │
└──────────────────────────────────────────────────────────┘

                    [← 上一页] [下一页 →]
```

**数据源：**
- `ForumRepository.getById(id)` — 版块信息
- `ThreadRepository.list({ forumId, sort, digest?, cursor, limit })` — 帖子列表（keyset 分页）

**排序策略：**
- 置顶帖 (sticky > 0) 始终排在最前，按 sticky 降序
- 普通帖按用户选择的排序方式：
  - `latest`（默认）：按 lastPostAt 降序 — 最新回复的帖子靠前
  - `newest`：按 createdAt 降序 — 最新发布的帖子靠前
  - `hot`：按 replies 降序 — 回复最多的帖子靠前

**ViewModel：**

```typescript
// viewmodels/useThreadListViewModel.ts
export function useThreadListViewModel(forumId: number) {
  const forums = useForumRepository();
  const threads = useThreadRepository();
  const [sort, setSort] = useState<"latest" | "newest" | "hot">("latest");
  const [digestOnly, setDigestOnly] = useState(false);

  // ... 调用 threads.list() 并处理分页

  return {
    forum: { /* 版块信息 */ },
    items: threads.map(t => ({
      ...t,
      badges: getThreadBadges(t),           // model 函数：计算标签列表
      highlightStyle: decodeHighlight(t.highlight), // model 函数：解码标题样式
    })),
    loading, error,
    sort, setSort,
    digestOnly, setDigestOnly,
    pagination: { hasMore, hasPrev, loadMore, loadPrev },
  };
}
```

---

### 帖子详情（/threads/:id）

展示帖子的完整内容和楼层式回复列表。

**展示内容：**

```
┌─ 帖子标题区 ─────────────────────────────────────────────┐
│  [精华] 2024 级新生入学指南                                │
│  版块: 同济新闻 · 作者: admin · 发布于 2024-09-01          │
│  浏览 12,345 · 回复 89 · 推荐 +23                         │
│  [版主操作: 置顶 | 加精 | 锁定 | 移动 | 删除]              │
└──────────────────────────────────────────────────────────┘

┌─ 1 楼 (主帖) ────────────────────────────────────────────┐
│  ┌─ UserCard ──┐  ┌─ Content ───────────────────────┐    │
│  │  [avatar]   │  │                                  │    │
│  │  admin      │  │  <sanitized HTML content>        │    │
│  │  管理员     │  │                                  │    │
│  │  帖: 1234   │  │  [附件区: 图片/文件列表]           │    │
│  │  注册: 2010 │  │                                  │    │
│  └────────────┘  │  发布于 2024-09-01 10:30          │    │
│                   └──────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘

┌─ 2 楼 ──────────────────────────────────────────────────┐
│  ┌─ UserCard ──┐  ┌─ Content ───────────────────────┐    │
│  │  [avatar]   │  │  回复内容...                      │    │
│  │  user123    │  │                                  │    │
│  │  普通用户   │  │  发布于 2024-09-01 11:45          │    │
│  └────────────┘  └──────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘

                    [← 上一页] [下一页 →]

┌─ 回复编辑器 ────────────────────────────────────────────┐
│  [富文本工具栏: B I U 链接 图片 代码 表情]                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │  输入回复内容...                                   │   │
│  └──────────────────────────────────────────────────┘   │
│                                       [发表回复]         │
└──────────────────────────────────────────────────────────┘
```

**数据源：**
- `ThreadRepository.getById(id)` — 帖子元信息
- `PostRepository.list({ threadId, cursor, limit })` — 回复列表（keyset 分页）
- `AttachmentRepository.listByThreadId(threadId)` — 附件列表
- `UserRepository.getById(authorId)` — 作者详细信息（用于 UserCard）

**楼层展示规则：**
- 1 楼 (isFirst=true) 为主帖，样式加强
- 2 楼起为回复，按 position 升序排列
- 每页 20 条回复
- 附件跟随对应楼层展示（通过 postId 关联）

**版主操作面板：**

仅当 `canModerate(user, forumId)` 为 true 时展示。Admin (1) / SuperMod (2) / Mod (3) 均可使用。这些操作走 Key A + 论坛用户 JWT + `/api/v1/moderation/*` 端点，与 Admin Console（Key B + Google OAuth）无关：

| 操作 | 调用 | 说明 |
|------|------|------|
| 置顶 | `ThreadRepository.setSticky(id, level)` | 可选择版块/全局/分类置顶 |
| 加精 | `ThreadRepository.setDigest(id, level)` | 1~3 级精华 |
| 锁定 | `ThreadRepository.setClosed(id, true)` | 锁定后不可回复 |
| 移动 | `ThreadRepository.move(id, targetForumId)` | 移动到其他版块 |
| 删除 | `ThreadRepository.delete(id)` | 物理删除（D1 DELETE，不可恢复） |

**ViewModel：**

```typescript
// viewmodels/useThreadDetailViewModel.ts
export function useThreadDetailViewModel(threadId: number) {
  const threads = useThreadRepository();
  const posts = usePostRepository();
  const attachments = useAttachmentRepository();

  // ... 加载帖子 + 回复 + 附件

  // 将附件按 postId 分组
  const attachmentsByPost = useMemo(
    () => groupBy(allAttachments, a => a.postId),
    [allAttachments],
  );

  return {
    thread: { /* 帖子元信息 + badges */ },
    posts: postItems.map(p => ({
      ...p,
      attachments: attachmentsByPost[p.id] ?? [],
      canDelete: canDeletePost(currentUser, p, thread.forumId),
    })),
    loading, error,
    pagination: { hasMore, hasPrev, loadMore, loadPrev },
    modActions: {
      setSticky: (level) => threads.setSticky(threadId, level),
      setDigest: (level) => threads.setDigest(threadId, level),
      setClosed: (closed) => threads.setClosed(threadId, closed),
      move: (targetForumId) => threads.move(threadId, targetForumId),
      deleteThread: () => threads.delete(threadId),
      deletePost: (postId) => posts.delete(postId),
    },
  };
}
```

---

### 用户主页（/users/:id）

展示用户的公开资料和发帖历史。

**展示内容：**

```
┌─ 用户资料卡 ─────────────────────────────────────────────┐
│  [大头像]                                                 │
│  username                                                │
│  角色: 管理员 · 状态: 正常                                 │
│  注册时间: 2010-01-15 · 最后登录: 2h ago                  │
│  发帖: 1,234 · 回帖: 5,678 · 积分: 9,999                 │
└──────────────────────────────────────────────────────────┘

Tab: [发帖历史] [回帖历史]

┌─ 发帖列表 ───────────────────────────────────────────────┐
│  帖子标题 1                    版块: 同济新闻 · 3d ago     │
│  帖子标题 2                    版块: 水源地 · 1w ago       │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘

                    [← 上一页] [下一页 →]
```

**数据源：**
- `UserRepository.getById(id)` — 用户资料
- `ThreadRepository.list({ authorId, sort: "newest", cursor, limit })` — 发帖历史
- `PostRepository.list({ authorId, cursor, limit })` — 回帖历史

**ViewModel：**

```typescript
// viewmodels/useUserProfileViewModel.ts
export function useUserProfileViewModel(userId: number) {
  const users = useUserRepository();
  const threads = useThreadRepository();
  const posts = usePostRepository();
  const [tab, setTab] = useState<"threads" | "posts">("threads");

  // ... 加载用户资料 + 按 tab 加载发帖/回帖历史

  return {
    user: { /* 用户资料 + 格式化字段 */ },
    tab, setTab,
    threads: { items, loading, pagination },     // tab === "threads"
    replies: { items, loading, pagination },     // tab === "posts"
  };
}
```

> **隐私约束**：用户主页不展示 email。仅 Admin 后台（04c）可查看 email。

---

### 精华列表（/digest）

跨版块展示所有精华帖，按 lastPostAt 降序。

**数据源：**
- `ThreadRepository.list({ digest: true, sort: "latest", cursor, limit })` — 全站精华

**ViewModel：**

```typescript
// viewmodels/useDigestListViewModel.ts
export function useDigestListViewModel() {
  const threads = useThreadRepository();
  // ... 调用 threads.list({ digest: true })
  return { items, loading, error, pagination };
}
```

---

### 搜索（/search）

**MVP 搜索能力**（受 Doc02 D1 限制）：
- 标题前缀匹配：`WHERE subject LIKE '搜索词%'`（LIKE pattern ≤50 bytes）
- 作者精确匹配：`WHERE author_name = '用户名'`
- 不支持中文全文搜索（D1/SQLite 不支持中文 FTS）

> 全文搜索方案（Workers AI + Vectorize）后置到 Phase 4，详见 04e。

**展示内容：**

```
搜索: [________________] [🔍]

Tab: [按标题搜索] [按作者搜索]

找到 123 条结果 (0.05s)

┌─ 搜索结果 ───────────────────────────────────────────────┐
│  帖子标题（匹配词高亮）              版块: xxx · 3d ago    │
│  帖子标题 2                         版块: yyy · 1w ago    │
└──────────────────────────────────────────────────────────┘
```

**ViewModel：**

```typescript
// viewmodels/useSearchViewModel.ts
export function useSearchViewModel() {
  const threads = useThreadRepository();
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<"title" | "author">("title");
  const debouncedQuery = useDebounce(query, 300);

  // 调用 ThreadRepository.search()
  // searchType === "title" → { titlePrefix: debouncedQuery }
  // searchType === "author" → { authorName: debouncedQuery }

  return {
    query, setQuery,
    searchType, setSearchType,
    results: { items, total, loading, error },
    pagination: { hasMore, hasPrev, loadMore, loadPrev },
  };
}
```

---

## 分页策略

### Keyset 分页（与 04a 一致）

**为什么不用 OFFSET？** D1/SQLite 上 `OFFSET 10000` 需要扫描前 10000 行，在 940 万行的 posts 表上是灾难性的。

**Keyset 原理：**

```sql
-- 第一页
SELECT * FROM threads WHERE forum_id = 42
ORDER BY last_post_at DESC
LIMIT 20;

-- 下一页（用上一页最后一条的 last_post_at 和 id 作为 cursor）
SELECT * FROM threads WHERE forum_id = 42
  AND (last_post_at < :cursor_time
       OR (last_post_at = :cursor_time AND id < :cursor_id))
ORDER BY last_post_at DESC
LIMIT 20;
```

**前端分页组件：**

```
[← 上一页]  第 X 页  [下一页 →]
```

- 不显示总页数（keyset 分页无法高效计算精确总页数）
- 显示"共约 N 条"（来自 PaginatedResult.total，近似值）
- 上一页 (prevCursor !== null 时可用) / 下一页 (nextCursor !== null 时可用)
- 没有跳页功能（keyset 分页不支持）

**分页 hook：**

```typescript
// viewmodels/shared/usePagination.ts
export function usePagination<T>(
  fetchFn: (params: PaginationParams) => Promise<PaginatedResult<T>>,
  initialLimit: number = 20,
) {
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [prevCursor, setPrevCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [hasPrev, setHasPrev] = useState(false);

  const loadMore = async () => { /* direction: "forward" */ };
  const loadPrev = async () => { /* direction: "backward" */ };
  const reset = () => { /* ... */ };

  return { items, hasMore, hasPrev, loadMore, loadPrev, reset, loading, error };
}
```

---

## 发帖与回帖

### 发帖流程

```
ForumNavbar [发帖按钮] 或 版块页 [发新帖]
        │
        ▼
  /threads/new?forumId=42
        │
        ├─ 未登录 → 重定向到 /login?redirect=/threads/new?forumId=42
        │
        └─ 已登录 →
            ├─ 选择版块（如果从首页进入，需手动选择）
            ├─ 输入标题
            ├─ 富文本编辑器输入内容（→ 04e Tiptap）
            ├─ [发布]
            │
            ├─ POST /api/v1/threads { forumId, subject, content }
            │   ├─ 成功 → 跳转到 /threads/:newId
            │   └─ 失败 → 显示错误提示
            │
            └─ [取消] → 返回上一页
```

### 回帖流程

```
帖子详情页底部 [回复编辑器]
        │
        ├─ 未登录 → 显示"请先登录"提示
        │
        └─ 已登录 →
            ├─ 帖子已锁定 (closed=1) → 编辑器禁用，显示"帖子已锁定"
            │
            └─ 帖子开放 →
                ├─ 富文本编辑器输入内容
                ├─ [发表回复]
                │
                ├─ POST /api/v1/posts { threadId, content }
                │   ├─ 成功 → 刷新回复列表，滚动到新回复
                │   └─ 失败 → 显示错误提示
                │
                └─ [取消] → 清空编辑器
```

**ViewModel：**

```typescript
// viewmodels/usePostEditorViewModel.ts
export function usePostEditorViewModel(
  mode: "thread" | "reply",
  targetId: number,  // forumId (thread mode) 或 threadId (reply mode)
) {
  const threads = useThreadRepository();
  const posts = usePostRepository();
  const [content, setContent] = useState("");
  const [subject, setSubject] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    try {
      if (mode === "thread") {
        const thread = await threads.create({ forumId: targetId, subject, content });
        return { success: true, threadId: thread.id };
      } else {
        await posts.create({ threadId: targetId, content });
        return { success: true };
      }
    } catch (err) {
      return { success: false, error: (err as Error).message };
    } finally {
      setSubmitting(false);
    }
  };

  return {
    content, setContent,
    subject, setSubject,       // 仅 thread mode
    submitting,
    submit,
    canSubmit: mode === "thread"
      ? subject.trim().length > 0 && content.trim().length > 0
      : content.trim().length > 0,
  };
}
```

---

## 帖子展示细节

### 标签系统 (ThreadBadge)

每个帖子可同时拥有多个标签，按以下优先级排列：

| 标签 | 条件 | 样式 | 说明 |
|------|------|------|------|
| 全局置顶 | `sticky === 2` | 红色 | 全站醒目 |
| 分类置顶 | `sticky === 3` | 橙色 | 分类级别 |
| 版块置顶 | `sticky === 1` | 蓝色 | 版块级别 |
| 精华 I/II/III | `digest > 0` | 绿色 | 精华等级 |
| 🔒 锁定 | `closed === 1` | 灰色 | 不可回复 |
| 🗳️ 投票 | `special === 1` | 紫色 | 特殊类型标签 |
| 💰 交易 | `special === 2` | 橙色 | |
| 🏆 悬赏 | `special === 3` | 金色 | |
| 📅 活动 | `special === 4` | 青色 | |
| ⚖️ 辩论 | `special === 5` | 靛色 | |

**Model 纯函数：**

```typescript
// models/thread.ts
export interface ThreadBadge {
  type: string;
  label: string;
  variant: "destructive" | "warning" | "default" | "success" | "secondary";
}

export function getThreadBadges(thread: Thread): ThreadBadge[] {
  const badges: ThreadBadge[] = [];
  if (thread.sticky === StickyLevel.Global) badges.push({ type: "sticky", label: "全局置顶", variant: "destructive" });
  if (thread.sticky === StickyLevel.Category) badges.push({ type: "sticky", label: "分类置顶", variant: "warning" });
  if (thread.sticky === StickyLevel.Forum) badges.push({ type: "sticky", label: "置顶", variant: "default" });
  if (thread.digest > 0) badges.push({ type: "digest", label: `精华${thread.digest > 1 ? " " + "I".repeat(thread.digest) : ""}`, variant: "success" });
  if (thread.closed === 1) badges.push({ type: "closed", label: "锁定", variant: "secondary" });
  // special type badges — 详见 04e
  return badges;
}
```

### 标题高亮 (highlight)

DZ 的 `highlight` 字段是编码后的样式信息：

```typescript
// models/thread.ts
export interface HighlightStyle {
  color: string | null;   // 十六进制颜色
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

/** 解码 DZ highlight 字段为样式对象 */
export function decodeHighlight(highlight: number): HighlightStyle | null {
  if (highlight === 0) return null;
  // DZ highlight 编码规则：低 24 位为颜色 RGB，高位标记粗体/斜体/下划线
  // 具体解码逻辑基于 DZ source/function/function_forum.php
  // ...
  return { color, bold, italic, underline };
}
```

### 内容渲染

帖子内容为 sanitized HTML（04a §内容格式规约）。内容中可能包含 `<attachment data-aid="N">` 占位元素，需要客户端解析。

**渲染流程：**

```tsx
// components/forum/PostContent.tsx
// 1. 从 AttachmentRepository 获取本楼附件列表
// 2. 解析 HTML 中的 <attachment data-aid> 元素
// 3. 替换为实际的图片 <img> 或下载链接
// 4. 将处理后的 HTML 通过 dangerouslySetInnerHTML 渲染

<div
  className="prose prose-sm max-w-none"
  dangerouslySetInnerHTML={{ __html: resolvedHtml }}
/>
```

**安全保障**：
- 内容在写入 D1 前已经过 sanitize（迁移阶段和运行时写入都执行同一套规则）
- Sanitize 规则详见 04a §Sanitize 规则（以 `bbcode.ts` 现有实现为 source of truth）
- URL 协议白名单：`http:`, `https:`, `ftp:`, `mailto:` + 相对路径
- `<attachment>` 标签由客户端 AttachmentResolver 处理，不会传递到 innerHTML

### 附件展示

附件通过两种方式出现在帖子中：

1. **内嵌附件**：帖子内容中的 `<attachment data-aid="N">` 占位元素，由 PostContent 组件的 AttachmentResolver 逻辑解析为内嵌图片或下载链接
2. **附件列表**：跟随楼层底部展示未内嵌的剩余附件

**URL 规则**（04a §附件渲染链路）：
- `attachmentUrl(filePath)` → `R2_PUBLIC_BASE/filePath` — 原图/文件下载
- `thumbnailUrl(filePath)` → `R2_PUBLIC_BASE/filePath.thumb.jpg` — 缩略图（仅 hasThumb=true）

展示：
- **图片附件** (isImage=true)：内嵌或列表中展示缩略图，点击查看原图
- **文件附件** (isImage=false)：展示文件名 + 大小 + 下载按钮

```
┌─ 附件区 ─────────────────────────────────────────────────┐
│  📷 [缩略图1] [缩略图2] [缩略图3]                          │
│  📎 report.pdf (2.3 MB) [下载]                            │
│  📎 data.xlsx (456 KB) [下载]                              │
└──────────────────────────────────────────────────────────┘
```

---

## 导航组件

### TopBar

固定在页面最顶部的工具栏：

```
┌──────────────────────────────────────────────────────────┐
│  [登录]  或  [avatar] username · 登出                [🌙] │
└──────────────────────────────────────────────────────────┘
```

> MVP 不含注册入口（04d §登录页）和消息通知（04e §站内私信后置）。

### ForumNavbar

主导航栏，包含 Logo 和导航链接：

```
┌──────────────────────────────────────────────────────────┐
│  [Logo] Ellie   首页  版块  精华  最新   [🔍 搜索...]     │
└──────────────────────────────────────────────────────────┘
```

Mobile 下折叠为汉堡菜单。

### Breadcrumbs

面包屑导航，标示用户在论坛层级中的位置：

```
首页 > 同济生活 > 同济新闻 > 2024 级新生入学指南
```

层级关系：
- 首页 → Group → Forum → Sub（可选）→ Thread

### SiteFooter

页脚信息：

```
┌──────────────────────────────────────────────────────────┐
│  © 2024 同济网 · Powered by Ellie                         │
│  关于我们 · 使用条款 · 隐私政策 · ICP 备案号              │
└──────────────────────────────────────────────────────────┘
```

---

## 登录页（/login）

```
┌─────────────────────────────────────────┐
│                                         │
│         [Logo] Ellie                    │
│                                         │
│    ┌───────────────────────────────┐    │
│    │  用户名                       │    │
│    │  [________________]           │    │
│    │                               │    │
│    │  密码                         │    │
│    │  [________________]           │    │
│    │                               │    │
│    │  [      登 录      ]          │    │
│    │                               │    │
│    │  没有账号？联系管理员          │    │
│    └───────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

> 当前阶段不开放注册（MVP 无注册流程）。登录通过 NextAuth Credentials Provider 处理（04b §认证方案）。

**ViewModel：**

```typescript
// viewmodels/useAuthViewModel.ts
export function useAuthViewModel() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const login = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await signIn("credentials", {
        username, password, redirect: false,
      });
      if (result?.error) setError("用户名或密码错误");
      return result;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await signOut({ redirect: true, callbackUrl: "/" });
  };

  return {
    username, setUsername,
    password, setPassword,
    error, loading,
    login, logout,
    canSubmit: username.trim().length > 0 && password.trim().length > 0,
  };
}
```
