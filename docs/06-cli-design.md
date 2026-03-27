# 06 — CLI 客户端设计

> Rust TUI 论坛客户端，基于 ratatui/crossterm，连接 Ellie Worker API。

## 概述

Ellie CLI 是一个终端 TUI（Text User Interface）应用，使用 Rust 编写，通过 Cloudflare Worker API 浏览同济网论坛数据。架构参考 [llmfit-tui](https://github.com/AlexsJones/llmfit) 的状态机 + 事件循环模式。

**核心原则**：
- **只读模式** — 浏览版块、主题、帖子、用户资料，不提供发帖/回复功能
- **登录可选** — 匿名即可浏览，登录后可查看需要权限的内容
- **全屏 TUI** — 键盘驱动的交互式界面，非一次性命令输出
- **质量优先** — 按 6 维质量体系（L1/L2/L3 + G1/G2 + D1）构建

**前置依赖**：05（Worker API 设计）

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

> **注意**：Worker 登录接口会返回 `refreshToken`（存储在 KV，30 天有效），但当前 Worker **尚未实现** `POST /api/v1/auth/refresh` 端点。CLI 暂不使用 refreshToken 续期，JWT 过期后要求用户重新登录。后续 Worker 实现 refresh 端点后再启用静默续期。

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

路径：`~/.config/ellie/config.json`（**唯一配置文件**，theme 等所有设置均存于此处）

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

```rust
use anyhow::Result;
use ureq::Agent;
use serde::{Deserialize, Serialize};

/// Structured error for auth expiry — callers match on this to trigger re-login UI.
#[derive(Debug)]
pub struct AuthExpiredError;
impl std::fmt::Display for AuthExpiredError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "authentication token expired")
    }
}
impl std::error::Error for AuthExpiredError {}

pub struct ApiClient {
    agent: Agent,
    base_url: String,
    api_key: String,
    token: Option<String>,
}

impl ApiClient {
    pub fn new(base_url: String, api_key: String) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(10))
            .build();
        Self { agent, base_url, api_key, token: None }
    }

    /// Core request — merges auth headers (caller wins on conflict).
    ///
    /// ureq 3.x returns HTTP 4xx/5xx as `Err(ureq::Error::StatusCode(..))`,
    /// so we must match on the Result to extract the response body for
    /// structured error handling (e.g. TOKEN_EXPIRED).
    fn request<T: for<'de> Deserialize<'de>>(&self, method: &str, path: &str, body: Option<&serde_json::Value>) -> Result<T> {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.agent.request(method, &url);

        // Inject auth headers
        req = req.set("X-API-Key", &self.api_key);
        if let Some(token) = &self.token {
            req = req.set("Authorization", &format!("Bearer {}", token));
        }

        let result = if let Some(body) = body {
            req.set("Content-Type", "application/json")
                .send_string(&body.to_string())
        } else {
            req.call()
        };

        match result {
            Ok(res) => Ok(res.into_json()?),
            Err(ureq::Error::StatusCode(status)) => {
                // ureq consumed the request but gave us an error status.
                // Re-read the response body from the error to get our API error envelope.
                let err_res = status;  // ureq::Error::StatusCode wraps the Response
                self.handle_error_response(err_res)
            }
            Err(e) => Err(e.into()),  // transport / DNS / timeout errors
        }
    }

    /// Parse the Worker's `{ error: { code, message } }` envelope from an error response.
    fn handle_error_response<T>(&self, res: ureq::Response) -> Result<T> {
        let status = res.status();
        let body: std::result::Result<ErrorResponse, _> = res.into_json();

        match body {
            Ok(err) if status == 401 && err.error.code == "TOKEN_EXPIRED" => {
                Err(AuthExpiredError.into())
            }
            Ok(err) => Err(anyhow::anyhow!("[{}] {}", err.error.code, err.error.message)),
            Err(_) => Err(anyhow::anyhow!("HTTP {status} with unparseable body")),
        }
    }

    /// Login — returns full payload for caller to persist
    pub fn login(&mut self, username: &str, password: &str) -> Result<LoginResponse> {
        let body = serde_json::json!({ "username": username, "password": password });
        let res: ApiResponse<LoginData> = self.request("POST", "/api/v1/auth/login", Some(&body))?;
        self.token = Some(res.data.token.clone());
        Ok(LoginResponse {
            token: res.data.token,
            refresh_token: res.data.refresh_token,
            user: res.data.user,
        })
    }

    /// Clear local auth state
    pub fn logout(&mut self) {
        self.token = None;
    }

    pub fn is_authenticated(&self) -> bool {
        self.token.is_some()
    }

    // Typed API methods
    pub fn get_forums(&self) -> Result<ApiResponse<Vec<Forum>>> {
        self.request("GET", "/api/v1/forums", None)
    }

    /// Note: cursor values are base64-encoded and may contain `=`, `+`, `/`.
    /// URL-encode them to avoid corrupting the query string.
    pub fn get_threads(&self, forum_id: u64, limit: usize, cursor: Option<&str>) -> Result<ApiResponse<Vec<Thread>>> {
        let path = format!("/api/v1/threads?forumId={}&limit={}{}",
            forum_id, limit,
            cursor.map(|c| format!("&cursor={}", urlencoding::encode(c))).unwrap_or_default()
        );
        self.request("GET", &path, None)
    }

    /// Note: cursor values are base64-encoded and may contain `=`, `+`, `/`.
    /// URL-encode them to avoid corrupting the query string.
    pub fn get_posts(&self, thread_id: u64, limit: usize, cursor: Option<&str>) -> Result<ApiResponse<Vec<Post>>> {
        let path = format!("/api/v1/posts?threadId={}&limit={}{}",
            thread_id, limit,
            cursor.map(|c| format!("&cursor={}", urlencoding::encode(c))).unwrap_or_default()
        );
        self.request("GET", &path, None)
    }

    pub fn get_user(&self, user_id: u64) -> Result<ApiResponse<User>> {
        let path = format!("/api/v1/users/{}", user_id);
        self.request("GET", &path, None)
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

架构完全参考 [llmfit-tui](https://github.com/AlexsJones/llmfit)，将其 Rust/ratatui 模式映射到 Ellie 领域。

### 技术栈

| 依赖 | 版本 | 说明 | 对应 llmfit |
|------|------|------|-------------|
| `ratatui` | 0.30 | TUI 渲染框架 | `ratatui` |
| `crossterm` | 0.29 | 终端后端（事件、raw mode） | `crossterm` |
| `ureq` | 3.x | 同步 HTTP 客户端 | `ureq` |
| `serde` / `serde_json` | 1.x | JSON 序列化 | `serde` |
| `clap` | 4.x | CLI 参数解析（derive） | `clap` |
| `directories` | latest | XDG 配置路径 | - |
| `anyhow` | latest | 错误处理 | - |
| `urlencoding` | latest | URL 编码 cursor 等查询参数 | - |
| `base64` | latest | Cursor 编解码 | - |

**移除的依赖（llmfit 有但 Ellie 不需要）**：
- ~~`sysinfo`~~ — 不需要硬件检测
- ~~`tabled`~~ — TUI 自己渲染
- ~~`colored`~~ — ratatui 内置颜色
- ~~`arboard`~~ — 暂不需要剪贴板
- ~~`axum` / `tokio`~~ — TUI 不需要 HTTP 服务器

### 核心架构（TEA 模式）

遵循 The Elm Architecture（State → View → Event → Update），与 llmfit-tui 完全一致：

```
┌─────────────────────────────────────────────────┐
│                    main.rs                       │
│  crossterm terminal setup + event loop           │
├─────────────────────────────────────────────────┤
│                                                   │
│  ┌──────────┐   ┌──────────┐   ┌──────────────┐ │
│  │  State    │──▶│  View    │──▶│  Terminal     │ │
│  │  (App)    │   │ (ui.rs)  │   │  Output      │ │
│  └──────────┘   └──────────┘   └──────────────┘ │
│       ▲                                           │
│       │         ┌──────────┐   ┌──────────────┐ │
│       └─────────│  Update  │◀──│  Keyboard    │ │
│       └─────────│ (app.rs) │   │  Input       │ │
│       │         └──────────┘   └──────────────┘ │
│       │                                            │
├─────────────────────────────────────────────────┤
│                  client.rs                        │
│  ApiClient — HTTP 请求，认证 header 注入          │
└─────────────────────────────────────────────────┘
```

### Crate 结构

```
packages/cli-rs/
├── Cargo.toml              # Workspace root (edition 2024, resolver 3)
├── rustfmt.toml            # hard_tabs = true, max_width = 100
├── clippy.toml             # deny warnings
├── ellie-core/             # Library crate
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs
│       ├── types.rs        # Domain types (User, Forum, Thread, Post, enums)
│       ├── client.rs       # HTTP client with X-API-Key + JWT auth
│       ├── config.rs       # ~/.config/ellie/config.json read/write
│       └── pagination.rs   # Cursor encode/decode utilities
└── ellie-tui/              # Binary crate
    ├── Cargo.toml
    └── src/
        ├── main.rs         # Entry point: clap + terminal setup + event loop
        ├── app.rs          # App struct, InputMode, ViewState
        ├── events.rs       # Keyboard event handlers (per mode)
        ├── ui.rs           # 4-zone layout rendering
        ├── theme.rs        # Theme system (default/dracula/nord)
        └── views/
            ├── mod.rs
            ├── forum_list.rs
            ├── thread_list.rs
            ├── post_view.rs
            ├── user_profile.rs
            ├── login_form.rs
            ├── status_bar.rs
            └── search_bar.rs
```

### 状态管理

对应 llmfit 的 `App` struct + `InputMode` enum：

```rust
// app.rs

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum InputMode {
    Normal,
    Search,
    Login,
}

#[derive(Clone)]
pub struct ListState {
    pub selected_row: usize,
    pub search_query: String,
    pub filtered_indices: Vec<usize>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

impl Default for ListState {
    fn default() -> Self {
        Self {
            selected_row: 0,
            search_query: String::new(),
            filtered_indices: Vec::new(),
            next_cursor: None,
            has_more: true,
        }
    }
}

#[derive(Clone)]
pub enum ViewState {
    Forums { list: ListState },
    Threads { forum_id: u64, forum_name: String, list: ListState },
    Posts { thread_id: u64, subject: String, list: ListState },
    User { user_id: u64 },
}

pub struct App {
    // Lifecycle
    pub should_quit: bool,
    pub input_mode: InputMode,
    pub loading: bool,

    // Navigation stack (each view keeps its own list state)
    pub view_stack: Vec<ViewState>,
    pub current_view: ViewState,

    // Data caches
    pub forums: Vec<Forum>,
    pub threads: Vec<Thread>,
    pub posts: Vec<Post>,
    pub current_user: Option<User>,

    // Auth
    pub auth_token: Option<String>,
    pub logged_in_user: Option<LoggedUser>,

    // Config (single source of truth: ~/.config/ellie/config.json)
    pub config: Config,

    // Theme (derived from config.theme on load, persisted back to config on change)
    pub theme: Theme,
}

impl App {
    pub fn new(config: Config) -> Self {
        let theme = Theme::load(&config);
        Self {
            should_quit: false,
            input_mode: InputMode::Normal,
            loading: false,
            view_stack: Vec::new(),
            current_view: ViewState::Forums { list: ListState::default() },
            forums: Vec::new(),
            threads: Vec::new(),
            posts: Vec::new(),
            current_user: None,
            auth_token: config.auth.as_ref().map(|a| a.token.clone()),
            logged_in_user: config.auth.as_ref().map(|a| a.user.clone()),
            config,
            theme,
        }
    }

    pub fn push_view(&mut self, view: ViewState) {
        self.view_stack.push(self.current_view.clone());
        self.current_view = view;
    }

    pub fn pop_view(&mut self) -> bool {
        if let Some(view) = self.view_stack.pop() {
            self.current_view = view;
            true
        } else {
            false
        }
    }
}
```

**设计要点**：`ListState` 内嵌在每个 `ViewState` 中，当用户 push 进入子视图时，父视图的 `selected_row` / `search_query` / `next_cursor` 等状态保留在 `view_stack` 里。pop 回来时完整恢复，无需重新加载或重置滚动位置。这直接对应 llmfit 中 `all_fits` + `filtered_fits` 与 `selected_index` 的组合模式。

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

```rust
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Theme {
    Default,
    Dracula,
    Nord,
}

impl Theme {
    pub fn label(&self) -> &str {
        match self {
            Self::Default => "default",
            Self::Dracula => "dracula",
            Self::Nord => "nord",
        }
    }

    pub fn from_label(label: &str) -> Self {
        match label {
            "dracula" => Self::Dracula,
            "nord" => Self::Nord,
            _ => Self::Default,
        }
    }

    pub fn colors(&self) -> ThemeColors {
        match self {
            Self::Default => ThemeColors {
                bg: Color::Reset,
                fg: Color::Reset,
                muted: Color::DarkGray,
                border: Color::DarkGray,
                accent: Color::Cyan,
                highlight: Color::Blue,
                // ...
            },
            Self::Dracula => ThemeColors { /* ... */ },
            Self::Nord => ThemeColors { /* ... */ },
        }
    }

    pub fn next(&self) -> Self {
        match self {
            Self::Default => Self::Dracula,
            Self::Dracula => Self::Nord,
            Self::Nord => Self::Default,
        }
    }

    /// Persist theme to the unified config file at ~/.config/ellie/config.json.
    /// Theme is stored as the `theme` field — no separate file.
    pub fn save(&self, config: &mut Config) {
        config.theme = self.label().to_string();
        config.write();
    }

    /// Load theme from the unified config file.
    pub fn load(config: &Config) -> Self {
        Self::from_label(&config.theme)
    }
}

pub struct ThemeColors {
    pub bg: Color,
    pub fg: Color,
    pub muted: Color,
    pub border: Color,
    pub accent: Color,
    pub highlight: Color,
    pub error: Color,
    pub sticky: Color,    // 置顶帖颜色
    pub digest: Color,    // 精华帖颜色
}
```

---

## 质量体系（6 维）

遵循六维质量体系：**三层测试（L1/L2/L3）+ 两道门控（G1/G2）+ 一道隔离（D1）**。

### L1 Unit/Component — 基础逻辑验证

- **验证对象**：逻辑单元、状态机、纯函数、工具函数
- **覆盖率要求**：≥ 90%（UI 薄壳组件豁免）
- **运行时机**：pre-commit（<30s）
- **工具**：`cargo test` + `cargo-llvm-cov`

```bash
# Coverage script
cargo llvm-cov --all-areas --html
# Fail if coverage < 90%
```

### L2 Integration/API — 真实网络验证

- **验证对象**：HTTP 请求（真实网络调用，非 mock）
- **要求**：100% API 端点覆盖
- **运行时机**：pre-push（<3min）
- **隔离**：必须连接测试资源，严禁触碰生产数据

```rust
// ellie-core/tests/integration.rs
#[test]
#[ignore]  // Run with: cargo test --test integration -- --ignored
fn get_forums_e2e() {
    let client = ApiClient::new(
        std::env::var("ELLIE_API_URL").unwrap_or_else(|_| "http://localhost:8787".to_string()),
        std::env::var("ELLIE_API_KEY").expect("ELLIE_API_KEY must be set"),
    );

    let result: ApiResponse<Vec<Forum>> = client.get_forums().unwrap();
    assert!(!result.data.is_empty());
}
```

### L3 System/E2E — 端到端流程验证

- **验证对象**：真实用户视角的端到端流程
- **运行时机**：CI 或按需手动触发
- **工具**：手动 smoke test（TUI 难以自动化）

**Manual Checklist**：
- [ ] 启动 CLI 显示版块列表
- [ ] Enter 进入版块显示主题列表
- [ ] Enter 进入主题显示帖子
- [ ] Esc 返回上一级视图
- [ ] `/` 进入搜索模式，输入文本过滤
- [ ] `L` 打开登录表单，输入凭证登录成功
- [ ] `t` 切换主题

### G1 Static Analysis — 代码质量门控

- **运行时机**：pre-commit，与 L1 并行
- **要求**：0 error + 0 warning，strict 模式

```bash
# clippy.toml
warn-on-all-wildcard-imports = true

# Commands
cargo fmt --check --all
cargo clippy --all-targets --all-features -- -D warnings
```

### G2 Security/Perf — 安全与性能门控

- **运行时机**：pre-push，与 L2 并行
- **安全扫描**：
  - `osv-scanner --lockfile Cargo.lock` — 依赖漏洞
  - `gitleaks detect --no-banner` — Secrets 泄露
- **性能基线**：按需（hyperfine, cargo bench）

```bash
# .husky/pre-push
cd packages/cli-rs && osv-scanner scan --lockfile Cargo.lock
gitleaks detect --no-banner
```

### D1 Test Isolation — 测试资源物理隔离

**核心原则**：Dev 可连 prod（调试真实数据），但 E2E 测试必须物理隔离于生产资源。

**命名规范**：

| 资源类型 | Prod | Test (E2E) |
|----------|------|------------|
| D1 Database | `tongjinet-db` | `tongjinet-db-test` |
| KV Namespace | `ellie` | `ellie-test` |

**三重验证**：
1. 环境变量覆盖：`process.env.NODE_ENV === "test"`
2. 运行时校验：test 模式下必须使用 test 资源
3. 测试标记表：`_test_marker` 表验证

**CI 中的隔离验证**：
```bash
# 验证 L2 测试使用 test DB
cargo test --test integration -- --ignored
```

### Tier 判定规则

| Tier | 条件 |
|------|------|
| **S** | L1 + L2 + L3 + G1 + G2 + D1 全部达标（N/A 计为绿） |
| **A** | L1 + L2 + G1 + D1 达标 + 其余至少一项 |
| **B** | L1 + G1 达标 |
| **C** | 任一基础项（L1/G1）不达标 |

### Hook 集成

**pre-commit**：
```bash
bunx lint-staged                      # TypeScript lint
pnpm -r exec tsc --noEmit            # TypeScript typecheck
bun test apps/worker                 # Worker tests

# Rust (if cli-rs exists)
if [ -f "packages/cli-rs/Cargo.toml" ]; then
  cd packages/cli-rs
  cargo fmt --check --all
  cargo clippy --all-targets --all-features -- -D warnings
  cargo test --workspace
  ./scripts/coverage.sh
  cd ../..
fi
```

**pre-push**：
```bash
bun run typecheck                    # G1
bun test tests/unit/                 # L1

# Rust L2 + G2 (if cli-rs exists)
if [ -f "packages/cli-rs/Cargo.toml" ]; then
  cargo test --test integration -- --ignored  # L2 (tests are #[ignore], must pass --ignored)
  osv-scanner scan --lockfile packages/cli-rs/Cargo.lock  # G2
fi

osv-scanner scan --lockfile bun.lock # G2
gitleaks detect --no-banner          # G2
```

---

## 开发路线

### Phase 0 — 基础设施（质量优先）
- [ ] 添加 Rust artifacts 到 .gitignore
- [ ] 创建 Cargo workspace（ellie-core + ellie-tui）
- [ ] 配置 rustfmt.toml + clippy.toml
- [ ] 集成 Rust 质量门控到 husky hooks

### Phase 1 — Core Library（ellie-core）
- [ ] 添加 serde + 核心依赖
- [ ] 定义 domain enums（UserRole, UserStatus, StickyLevel, ForumType）
- [ ] 定义 domain structs（User, Forum, Thread, Post, Attachment）
- [ ] 定义 API response wrappers（ApiResponse, ErrorResponse）
- [ ] 实现 cursor encode/decode utilities
- [ ] 实现 XDG config file read/write
- [ ] 实现 HTTP client with X-API-Key header
- [ ] 添加 JWT authentication
- [ ] 添加 typed API methods（getForums, getThreads, getPosts, getUser）

### Phase 2 — TUI Framework（ellie-tui）
- [ ] 添加 ratatui + crossterm + clap 依赖
- [ ] 定义 InputMode, ListState, ViewState enums
- [ ] 实现 App struct with view stack
- [ ] 实现终端初始化和清理（panic handler）
- [ ] 实现键盘事件轮询（50ms timeout）
- [ ] 实现 Normal mode key handlers
- [ ] 实现 Search and Login mode handlers
- [ ] 实现 4-zone layout rendering
- [ ] 实现主题系统（default/dracula/nord）

### Phase 3 — Views 组件
- [ ] ForumList view（树形结构）
- [ ] ThreadList view（分页表格）
- [ ] PostView（滚动内容）
- [ ] UserProfile view
- [ ] LoginForm overlay
- [ ] StatusBar component
- [ ] SearchBar component
- [ ] ApiClient integration to App
- [ ] Login flow wiring

### Phase 4 — Integration（L2）
- [ ] 添加 integration test infrastructure
- [ ] GET /api/v1/forums E2E test
- [ ] GET /api/v1/threads pagination E2E test
- [ ] POST /api/v1/auth/login E2E test
- [ ] D1 isolation verification
- [ ] 集成 Rust L2 tests 到 pre-push hook

### Phase 5 — 打磨
- [ ] 集成 osv-scanner + gitleaks（G2）
- [ ] 实现 retry logic with exponential backoff
- [ ] 添加 loading spinners 和 skeleton states
- [ ] 实现帮助面板（`?` key）
- [ ] 添加 coverage script 并 enforce 90%
- [ ] 更新本设计文档（如有变更）
- [ ] 添加 CLI README
- [ ] Tier S 验证检查清单

---

## 本地运行

### 前置要求

```bash
# Rust toolchain (2024 edition)
rustup update stable
rustup component add llvm-tools-preview

# Optional: coverage tool
cargo install cargo-llvm-cov
```

### 构建

```bash
cd packages/cli-rs
cargo build --release
```

### 运行

```bash
# 使用默认配置（连接生产 API）
cargo run --release --bin ellie-tui

# 覆盖 API URL（本地开发）
ELLIE_API_URL=http://localhost:8787 cargo run --release --bin ellie-tui

# 覆盖 API Key（测试）
ELLIE_API_KEY=test-key cargo run --release --bin ellie-tui
```

### 开发命令

| 命令 | 说明 |
|------|------|
| `cargo build` | 构建项目 |
| `cargo test` | 运行所有测试（L1） |
| `cargo test --test integration -- --ignored` | 运行 E2E 测试（L2） |
| `cargo clippy --all-targets --all-features -- -D warnings` | 静态分析（G1） |
| `cargo fmt --check` | 检查格式（G1） |
| `cargo fmt` | 格式化代码 |
| `./scripts/coverage.sh` | 覆盖率报告（L1） |

---

## 参考

- [llmfit-tui](https://github.com/AlexsJones/llmfit) — 架构参考项目
- [ratatui 文档](https://docs.rs/ratatui/) — TUI 框架
- [crossterm 文档](https://docs.rs/crossterm/) — 终端处理
- [ureq 文档](https://docs.rs/ureq/) — 同步 HTTP 客户端
