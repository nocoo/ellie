# 04c — 管理后台

> Admin 控制台的布局、功能模块和 ViewModel 设计。通过管理后台对论坛全部数据进行管理。
>
> **前置依赖**：04a（类型 + Repository 接口）、04b（架构 + 设计系统）

## 布局

复用 basalt 的 Sidebar + Content 布局模式。

```
┌───────────────────────────────────────────────────────┐
│  Sidebar (260px / 68px collapsed)  │  Main Area       │
│                                    │                  │
│  ┌─ Brand ──────────────────────┐  │  ┌─ Header ────┐│
│  │  Ellie Admin    v0.1.0       │  │  │ 页面标题  🌙 ││
│  ├─ Navigation ─────────────────┤  │  ├─────────────┤│
│  │  📊 仪表盘                    │  │  │             ││
│  │  👤 用户管理                   │  │  │  Content    ││
│  │  📝 内容审核                   │  │  │  bg-card    ││
│  │  📂 版块管理                   │  │  │  rounded-20 ││
│  │  ⚙️ 系统设置                   │  │  │             ││
│  ├─ User ───────────────────────┤  │  │             ││
│  │  [avatar] Admin · 登出        │  │  └─────────────┘│
│  └──────────────────────────────┘  │                  │
└───────────────────────────────────────────────────────┘
```

### 路由结构

```
src/app/(admin)/
├── layout.tsx                  # AdminLayout: Sidebar + Header + Content
└── admin/
    ├── page.tsx                # /admin — 仪表盘
    ├── users/page.tsx          # /admin/users — 用户管理
    ├── content/page.tsx        # /admin/content — 内容审核
    ├── forums/page.tsx         # /admin/forums — 版块管理
    └── settings/page.tsx       # /admin/settings — 系统设置（后置）
```

### 组件清单

```
src/components/admin/
├── StatCard.tsx                # 统计指标卡片
├── ChartWidgets.tsx            # 趋势图（Recharts）
├── UserTable.tsx               # 用户管理表格
├── ContentTable.tsx            # 内容审核表格
└── ForumTree.tsx               # 版块树形管理
```

### AdminLayout 组件

```
src/components/layout/
├── AdminLayout.tsx             # 整体壳：Sidebar + Header + Outlet
├── AdminSidebar.tsx            # 侧边栏：品牌 + 导航分组 + 用户信息
```

**响应式行为**（与 basalt 一致）：
- Desktop (>1024px): Sidebar 260px，可折叠到 68px（icon-only）
- Tablet (768-1024px): Sidebar 默认 collapsed (68px)
- Mobile (<768px): Sidebar 隐藏，通过汉堡按钮触发 overlay 抽屉

---

## 功能模块

### 仪表盘（/admin）

| 指标 | 数据源 | 组件 |
|------|--------|------|
| 总用户数 | `UserRepository.list({ limit: 0 }).total` | StatCard |
| 总帖子数 | 所有 forums 的 posts 之和 | StatCard |
| 今日新帖 | `ThreadRepository.list({ createdAfter: todayStart }).total` | StatCard |
| 今日活跃用户 | `UserRepository.list({ lastLoginAfter: todayStart }).total` | StatCard |
| 7 天发帖趋势 | 按日聚合 thread 创建数（`ThreadRepository.list({ createdAfter: weekAgo })` 前端聚合） | Recharts AreaChart |
| 最近注册用户 | `UserRepository.list({ sort: "newest", limit: 5 })` | 列表 |
| 最近发帖 | `ThreadRepository.list({ sort: "newest", limit: 5 })` | 列表 |

**ViewModel：**

```typescript
// viewmodels/admin/useDashboardViewModel.ts
export function useDashboardViewModel() {
  // ... 聚合上述所有数据源
  return {
    stats: { totalUsers, totalPosts, todayThreads, todayActiveUsers },
    trendData: [...],       // 7 天趋势
    recentUsers: [...],
    recentThreads: [...],
    loading, error,
  };
}
```

---

### 用户管理（/admin/users）

**列表功能：**
- 表格展示：ID、用户名、邮箱、角色、状态、注册时间、最后登录、发帖数
- 搜索：按用户名模糊匹配
- 筛选：按角色（全部/Admin/SuperMod/Mod/User）、按状态（全部/正常/封禁/归档）
- 分页：keyset 分页

**操作功能：**

| 操作 | 权限要求 | 说明 |
|------|---------|------|
| 封禁用户 | Admin | `UserRepository.setStatus(id, Banned)` |
| 解封用户 | Admin | `UserRepository.setStatus(id, Active)` |
| 变更角色 | Admin | `UserRepository.setRole(id, role)` — Admin 不可降级自己 |
| 查看详情 | Admin, SuperMod | 跳转到用户详情弹窗 |

> 归档用户（status=-2）在列表中可见但操作受限：只能查看，不能封禁/解封（归档是迁移产物，不是管理行为）。

**ViewModel：**

```typescript
// viewmodels/admin/useUserManagementViewModel.ts
export function useUserManagementViewModel() {
  const users = useUserRepository();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | null>(null);
  const [statusFilter, setStatusFilter] = useState<UserStatus | null>(null);

  // ... 组合过滤参数调用 users.list()

  return {
    items: [...],
    loading, error,
    pagination: { hasMore, loadMore },
    filters: { search, setSearch, roleFilter, setRoleFilter, statusFilter, setStatusFilter },
    actions: {
      banUser: (id) => users.setStatus(id, UserStatus.Banned),
      unbanUser: (id) => users.setStatus(id, UserStatus.Active),
      changeRole: (id, role) => users.setRole(id, role),
    },
  };
}
```

---

### 内容审核（/admin/content）

**列表功能：**
- 表格展示：ID、标题/内容摘要、作者、版块、创建时间、状态
- Tab 切换：帖子 (threads) / 回复 (posts)
- 筛选：按版块
- 分页：keyset 分页

**操作功能：**

| 操作 | 权限要求 | 说明 |
|------|---------|------|
| 删除帖子 | Admin, SuperMod | 物理删除（D1 DELETE）。Mod 不能进入管理后台，但可通过论坛前端（04d）执行删除 |
| 删除回复 | Admin, SuperMod | 同上 |
| 预览内容 | Admin, SuperMod | 弹窗展示帖子完整 HTML 内容 |

> **无"恢复"功能**：迁移时跳过了 invisible≠0 的记录（Doc02/Doc03），不存在历史被删数据。删除操作为物理删除（D1 DELETE），不可恢复。

**ViewModel：**

```typescript
// viewmodels/admin/useContentModerationViewModel.ts
export function useContentModerationViewModel() {
  const threads = useThreadRepository();
  const posts = usePostRepository();
  const [tab, setTab] = useState<"threads" | "posts">("threads");
  const [forumFilter, setForumFilter] = useState<number | null>(null);

  // ... 按 tab 调用对应 repository

  return {
    items: [...],
    tab, setTab,
    loading, error,
    pagination: { hasMore, loadMore },
    filters: { forumFilter, setForumFilter },
    actions: {
      deleteThread: (id) => threads.delete(id),
      deletePost: (id) => posts.delete(id),
    },
  };
}
```

---

### 版块管理（/admin/forums）

**展示功能：**
- 树形视图：Group → Forum → Sub 三级层次
- 每个节点展示：名称、帖子数、回帖数、状态（正常/隐藏）

> D1 中初始无隐藏版块（迁移时 `WHERE status=1` 过滤掉了）。管理员可通过本页面将版块 status 设为 0 进行隐藏。

**操作功能：**

| 操作 | 说明 |
|------|------|
| 编辑版块 | 修改名称、描述、图标 |
| 隐藏/显示 | 切换 status（0/1） |
| 调整排序 | 修改 displayOrder |

> **后置功能**（MVP 不含）：
> - 添加/删除子版块 — 需要 CREATE/DELETE forum 的 API
> - 版主分配 — 需要 `moderators` 表（04a §已知数据缺口）
> - 拖拽排序 — 优先级低，手动输入 displayOrder 即可

**ViewModel：**

```typescript
// viewmodels/admin/useForumManagementViewModel.ts
export function useForumManagementViewModel() {
  const forums = useForumRepository();

  // forums.listAll() 返回全部 213 个版块，在前端构建树
  const tree = useMemo(() => buildForumTree(allForums), [allForums]);

  return {
    tree,          // 已构建的树形结构
    loading, error,
    actions: {
      updateForum: (id, data) => forums.update(id, data),
      toggleVisibility: (id, currentStatus) => forums.update(id, { status: currentStatus === 1 ? 0 : 1 }),
      updateOrder: (id, order) => forums.update(id, { displayOrder: order }),
    },
  };
}
```

**树形构建纯函数（在 models/forum.ts 中）：**

```typescript
// models/forum.ts
export interface ForumTreeNode extends Forum {
  children: ForumTreeNode[];
}

/** 将平铺的 Forum[] 构建为 Group → Forum → Sub 树形 */
export function buildForumTree(forums: Forum[]): ForumTreeNode[] {
  // 1. 按 parentId 分组
  // 2. 递归挂载子节点
  // 3. 按 displayOrder 排序
}
```

---

### 系统设置（/admin/settings）— 后置

当前 MVP 不实现。需要 Phase 2 提供 config 存储方案（KV 或 D1 新表）。

预留功能：
- 站点名称、描述、Logo
- 注册开关
- 敏感词过滤配置

---

## 权限守卫

### 页面级

Admin Route Group 的 `layout.tsx` 检查当前用户 role：

```typescript
// src/app/(admin)/layout.tsx
export default async function AdminLayout({ children }) {
  const session = await auth();
  if (!canAccessAdmin(session?.user)) {
    redirect("/login");
  }
  return <AdminShell>{children}</AdminShell>;
}
```

### API 级

Admin API Routes 使用 `resolveAdmin()` 守卫：

```typescript
// 在每个 /api/admin/* route handler 中
const user = await resolveAdmin(request);
if (!user) return new Response("Forbidden", { status: 403 });
```

### 操作级

用户管理操作（封禁/角色变更）进一步检查 `canManageUsers()`：

```typescript
if (!canManageUsers(user)) return new Response("Forbidden", { status: 403 });
```
