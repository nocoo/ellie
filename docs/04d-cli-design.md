# 04d — CLI 客户端设计

> TUI 论坛客户端，基于 Ellie Worker API，提供只读浏览 + 用户登录体验。

## 概述

Ellie CLI 是一个终端 TUI（Text User Interface）应用，连接 Cloudflare Worker API 浏览同济网论坛数据。采用类似 [llmfit-tui](https://github.com/AlexsJones/llmfit) 的全屏交互式架构，而非传统的子命令模式。

**核心原则：**
- **只读模式** — 浏览版块、主题、帖子、用户资料，不提供发帖/回复功能
- **登录可选** — 匿名即可浏览，登录后可查看需要权限的内容
- **全屏 TUI** — 键盘驱动的交互式界面，非一次性命令输出

---

## API 连接

### Worker 端点

```
Base URL: https://ellie.worker.hexly.ai
备用:     https://ellie.nocoo.workers.dev
```

### 双层认证模型

所有请求需经过两层认证：

**Layer 1 — API Key（必须）**

每个请求（除 `GET /api/live`）必须携带 `X-API-Key` header：

```
X-API-Key: <client-credential>
```

API Key 是**公开的客户端凭证**（类似移动 App 的 API Key），随 CLI 发行包一起分发。它的作用是基本的访问控制——区分"经过授权的客户端"与"任意爬虫/扫描器"，而非机密保护。任何拥有 CLI 的用户都能看到这个值，这是预期行为。

**Layer 2 — JWT Token（可选，登录后获取）**

用户登录后获取 JWT，后续请求携带 `Authorization: Bearer <token>`。当前所有读取接口不强制 JWT，但未来可能按权限区分内容可见性。

### 认证流程

```
启动 CLI
  │
  ├─ API Key 内置于 CLI 发行包，自动注入所有请求
  │
  ├─ 有已保存的 JWT？
  │   ├─ 未过期 → 自动附加到请求
  │   └─ 已过期 → 清除本地 token，提示用户重新登录
  │
  └─ 无 JWT → 匿名模式（仅 API Key 认证）
```

> **注意：** Worker 登录接口会返回 `refreshToken`（存储在 KV，30 天有效），但当前 Worker
> **尚未实现** `POST /api/v1/auth/refresh` 端点。CLI 暂不使用 refreshToken 续期，
> JWT 过期后要求用户重新登录。后续 Worker 实现 refresh 端点后再启用静默续期。

### 登录接口

```
POST /api/v1/auth/login
Content-Type: application/json
X-API-Key: <key>

{ "username": "alice", "password": "secret" }

→ 200:
{
  "data": {
    "token": "<JWT, 7天有效>",
    "refreshToken": "<UUID, 30天有效>",
    "user": { "userId": 123, "username": "alice", "role": 1 }
  }
}
```

### 配置文件

路径：`~/.config/ellie/config.json`

```json
{
  "apiUrl": "https://ellie.worker.hexly.ai",
  "apiKey": "<client-credential, shipped with CLI>",
  "auth": {
    "token": "<JWT>",
    "user": {
      "userId": 123,
      "username": "alice",
      "role": 1
    }
  },
  "theme": "default"
}
```

### API Client

```typescript
class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private token: string | null = null;

  constructor(config: { apiUrl: string; apiKey: string; token?: string }) {
    this.baseUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.token = config.token ?? null;
  }

  /** Core request — merges caller headers with auth headers (caller wins on conflict) */
  async request<T>(path: string, options?: RequestInit): Promise<T> {
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "X-API-Key": this.apiKey,
    };
    if (this.token) {
      authHeaders["Authorization"] = `Bearer ${this.token}`;
    }

    const mergedHeaders = { ...authHeaders, ...(options?.headers ?? {}) };
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: mergedHeaders,
    });

    if (!res.ok) {
      const body = await res.json();
      const code = body?.error?.code;

      // Only treat as session expiry when we had a token and server says it expired.
      // Other 401s (bad API Key, wrong credentials, INVALID_TOKEN) are plain ApiErrors.
      if (res.status === 401 && this.token && code === "TOKEN_EXPIRED") {
        this.token = null;
        throw new AuthExpiredError();
      }
      throw new ApiError(res.status, body);
    }
    return res.json();
  }

  /**
   * Login — stores JWT in memory only.
   * Caller (store/config layer) is responsible for persisting token to disk.
   */
  async login(username: string, password: string): Promise<{
    token: string;
    refreshToken: string;
    user: AuthUser;
  }> {
    const data = await this.request<{
      data: { token: string; refreshToken: string; user: AuthUser };
    }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    this.token = data.data.token;
    // Return full payload so caller can persist to config.json
    return data.data;
  }

  /** Clear local auth state */
  logout(): void {
    this.token = null;
  }

  get isAuthenticated(): boolean {
    return this.token !== null;
  }
}
```

### 可用端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/live` | 健康检查（无需 API Key） |
| `GET` | `/api/v1/forums` | 版块列表 |
| `GET` | `/api/v1/forums/:id` | 版块详情 |
| `GET` | `/api/v1/threads?forumId=X&limit=N&cursor=C` | 主题列表（游标分页） |
| `GET` | `/api/v1/threads/:id` | 主题详情 |
| `GET` | `/api/v1/posts?threadId=X&limit=N&cursor=C` | 帖子列表（游标分页） |
| `GET` | `/api/v1/posts/:id` | 帖子详情 |
| `GET` | `/api/v1/users/:id` | 用户资料 |
| `POST` | `/api/v1/auth/login` | 用户登录 |

---

## 功能设计

### 只读功能清单

| 功能 | 描述 | 快捷键 |
|------|------|--------|
| 版块浏览 | 树形展示所有版块（父子层级） | 默认首屏 |
| 主题列表 | 进入版块查看主题，置顶优先 | `Enter` |
| 帖子阅读 | 查看主题内所有回帖，支持翻页 | `Enter` |
| 用户资料 | 查看发帖人信息 | `u` |
| 搜索过滤 | 在当前列表中搜索 | `/` |
| 登录 | 输入用户名密码认证 | `L` |
| 主题统计 | 查看回复数、浏览数、最后回复 | 列表内联 |

### 不实现的功能

- ~~发帖 / 回复~~ — 只读
- ~~私信~~ — 只读
- ~~管理操作~~ — 只读
- ~~附件上传~~ — 只读

### 视图导航

```
版块列表 (ForumList)
  │ Enter
  ▼
主题列表 (ThreadList)
  │ Enter
  ▼
帖子阅读 (PostView)
  │ u
  ▼
用户资料 (UserProfile)

任意视图按 Esc/Backspace 返回上一层
按 q 退出程序
```

---

## 技术架构

### 参考项目

架构完全参考 [llmfit-tui](https://github.com/AlexsJones/llmfit)，将其 Rust/ratatui 模式映射到 TypeScript/Bun 生态。

### 技术栈

| 依赖 | 说明 | 对应 llmfit |
|------|------|-------------|
| `ink` | React for CLI — 组件化 TUI 渲染 | `ratatui` |
| `ink-text-input` | 文本输入组件 | `crossterm` key events |
| `@ellie/types` | 共享类型定义 | `llmfit-core` types |
| `zustand` | 轻量状态管理 | `App` struct |
| `@inkjs/ui` | 高级 UI 组件（Spinner、Select） | ratatui widgets |

**移除的依赖（不再需要）：**
- ~~commander~~ — 不再使用子命令模式
- ~~inquirer~~ — ink 自带交互能力
- ~~ora~~ — ink 有 Spinner 组件
- ~~cli-cursor~~ — ink 自动管理

### 核心架构（TEA 模式）

遵循 The Elm Architecture（State → View → Event → Update），与 llmfit-tui 完全一致：

```
┌─────────────────────────────────────────────────┐
│                    main.tsx                       │
│  ink render(<App />) — 启动 TUI                  │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐ │
│  │  State    │──▶│  View    │──▶│  Terminal     │ │
│  │ (store)   │   │ (React)  │   │  Output      │ │
│  └──────────┘   └──────────┘   └──────────────┘ │
│       ▲                                           │
│       │         ┌──────────┐   ┌──────────────┐ │
│       └─────────│  Update  │◀──│  Keyboard    │ │
│                 │ (actions)│   │  Input       │ │
│                 └──────────┘   └──────────────┘ │
│                                                   │
├─────────────────────────────────────────────────┤
│                  client.ts                        │
│  ApiClient — HTTP 请求，认证 header 注入          │
└─────────────────────────────────────────────────┘
```

### 文件结构

> **当前状态：** `packages/cli/src/` 只有 `index.ts`（commander 骨架）和 `client.ts`。
> 以下为目标架构，实现后 `index.ts` 将被 `main.tsx` 替代。

```
packages/cli/src/
├── main.tsx              # 入口：ink render，终端初始化（替代当前 index.ts）
├── store.ts              # 全局状态（对应 llmfit tui_app.rs App struct）
├── client.ts             # API Client（已有，需重写）
├── config.ts             # ~/.config/ellie/ 读写
├── theme.ts              # 主题定义（对应 llmfit theme.rs）
├── components/
│   ├── App.tsx           # 根组件：布局 + 视图切换 + 键盘事件
│   ├── StatusBar.tsx     # 底部状态栏：模式 + 快捷键提示
│   ├── ForumList.tsx     # 版块树形列表
│   ├── ThreadList.tsx    # 主题列表（表格 + 分页）
│   ├── PostView.tsx      # 帖子阅读视图
│   ├── UserProfile.tsx   # 用户资料卡片
│   ├── LoginForm.tsx     # 登录表单（覆盖层）
│   └── SearchBar.tsx     # 搜索输入
└── types.ts              # CLI 内部类型（InputMode, ViewState 等）
```

### 状态管理

对应 llmfit 的 `App` struct + `InputMode` enum：

```typescript
// types.ts
type InputMode = "normal" | "search" | "login";

/** Per-view list state — each view in the stack keeps its own cursor/filter/pagination */
interface ListState {
  selectedRow: number;
  searchQuery: string;
  filteredIndices: number[];  // 对应 llmfit filtered_fits
  nextCursor: string | null;
  hasMore: boolean;
}

type ViewState =
  | { view: "forums"; list: ListState }
  | { view: "threads"; forumId: number; forumName: string; list: ListState }
  | { view: "posts"; threadId: number; subject: string; list: ListState }
  | { view: "user"; userId: number };

// store.ts — 对应 llmfit tui_app.rs
interface AppState {
  // 生命周期
  mode: InputMode;
  loading: boolean;

  // 导航栈（支持 Esc 返回）— 每个视图携带自己的列表状态
  viewStack: ViewState[];
  currentView: ViewState;

  // 数据缓存（按视图类型分区）
  forums: Forum[];
  threads: Thread[];
  posts: Post[];
  currentUser: User | null;

  // 认证
  auth: {
    token: string | null;
    user: { userId: number; username: string; role: number } | null;
  };

  // 主题
  theme: Theme;
}
```

**设计要点：** `ListState` 内嵌在每个 `ViewState` 中，当用户 push 进入子视图时，
父视图的 `selectedRow` / `searchQuery` / `nextCursor` 等状态保留在 `viewStack` 里。
pop 回来时完整恢复，无需重新加载或重置滚动位置。这直接对应 llmfit 中
`all_fits` + `filtered_fits` 与 `selected_index` 的组合模式。

### 键盘操作（对应 llmfit tui_events.rs）

**Normal 模式：**

| 键 | 动作 |
|----|------|
| `j` / `↓` | 下移光标 |
| `k` / `↑` | 上移光标 |
| `Enter` | 进入选中项 |
| `Esc` / `Backspace` | 返回上一层 |
| `/` | 进入搜索模式 |
| `L` | 登录 |
| `u` | 查看当前项作者资料 |
| `n` | 下一页（加载更多） |
| `g` | 跳到顶部 |
| `G` | 跳到底部 |
| `r` | 刷新当前视图 |
| `t` | 切换主题 |
| `q` | 退出 |

**Search 模式：**

| 键 | 动作 |
|----|------|
| 字符输入 | 追加到搜索词 |
| `Backspace` | 删除字符 |
| `Enter` / `Esc` | 退出搜索，回到 Normal |

**Login 模式：**

| 键 | 动作 |
|----|------|
| `Tab` | 切换用户名/密码字段 |
| `Enter` | 提交登录 |
| `Esc` | 取消登录 |

### 界面布局

对应 llmfit 的 4 行垂直布局：

```
┌─────────────────────────────────────────────────┐ ← Row 0: Header (1行)
│ 🏛 Ellie Forum — 同济网                [alice]  │   标题 + 登录状态
├─────────────────────────────────────────────────┤ ← Row 1: Breadcrumb (1行)
│ 版块 > 校园交流 > 新生报到                       │   导航路径
├─────────────────────────────────────────────────┤ ← Row 2: Content (弹性)
│                                                   │
│  ▸ [置顶] 2024级新生入学指南    alice   128/3.2k  │   当前视图内容
│    求推荐校园周边美食          bob      42/856    │   （列表 / 帖子 / 资料）
│    图书馆自习室怎么预约        carol    15/234    │
│    ...                                            │
│                                                   │
├─────────────────────────────────────────────────┤ ← Row 3: Status (1行)
│ NORMAL  j/k:移动 Enter:进入 /:搜索 q:退出       │   模式 + 快捷键提示
└─────────────────────────────────────────────────┘
```

### 主题系统（对应 llmfit theme.rs）

```typescript
interface ThemeColors {
  bg: string;
  fg: string;
  muted: string;
  border: string;
  accent: string;
  highlight: string;
  error: string;
  sticky: string;    // 置顶帖颜色
  digest: string;    // 精华帖颜色
}

const themes = {
  default: { ... },
  dracula: { ... },
  nord: { ... },
};
```

主题持久化到 `~/.config/ellie/config.json`，`t` 键循环切换。

---

## 开发路线

### Phase 1 — 基础框架
- [ ] 替换依赖：移除 commander/inquirer/ora，引入 ink
- [ ] 实现 config.ts（读写 `~/.config/ellie/config.json`）
- [ ] 更新 client.ts（base URL + X-API-Key + JWT headers）
- [ ] 实现 store.ts（全局状态 + actions）
- [ ] 实现 App.tsx 根组件 + StatusBar.tsx

### Phase 2 — 核心视图
- [ ] ForumList.tsx — 树形版块列表
- [ ] ThreadList.tsx — 主题列表 + 游标分页
- [ ] PostView.tsx — 帖子阅读 + 翻页
- [ ] 视图导航栈（push/pop）

### Phase 3 — 交互增强
- [ ] SearchBar.tsx — 列表内过滤
- [ ] LoginForm.tsx — 登录覆盖层
- [ ] UserProfile.tsx — 用户资料卡片
- [ ] 主题切换

### Phase 4 — 打磨
- [ ] 错误处理 + 重试
- [ ] 加载状态 / Skeleton
- [ ] 键盘快捷键帮助面板（`?`）
- [ ] 单元测试

---

## 本地运行

> **当前：** `bun run packages/cli/src/index.ts`（commander 骨架，无 TUI 功能）

改造完成后：

```bash
cd packages/cli
bun run src/main.tsx
```

环境变量覆盖：
```bash
ELLIE_API_URL=http://localhost:8787 bun run src/main.tsx
```
