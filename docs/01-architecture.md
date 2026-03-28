# 架构设计

## 项目概述

Ellie 是一个将 Discuz! X3.4 论坛数据迁移到 Cloudflare 平台并重建前端的项目。
- 源站：tongji.nocoo.cloud（MySQL 8.0, ~1170万行数据）
- 目标：Cloudflare D1（SQLite）+ R2（文件存储）

## 系统架构

```
                         ┌──────────────────────┐
                         │    Cloudflare D1      │
                         │   (SQLite 数据库)      │
                         └──────────┬───────────┘
                                    │ D1 binding
                         ┌──────────▼───────────┐
                         │   Worker API (唯一入口) │  ← 所有增删改查必须经过 Worker
                         │  双 Key + JWT/OAuth    │
                         └─┬──────────┬────────┬─┘
                           │          │        │
              ┌────────────▼┐  ┌──────▼─────┐ ┌▼────────────┐
              │  CLI 客户端  │  │  Web 前端  │ │  Admin 后台  │
              │  (Rust TUI)  │  │  (Next.js) │ │  (Next.js)  │
              │  Key A/只读   │  │ Key A/论坛  │ │ Key B/Google │
              └──────────────┘  └────────────┘ └─────────────┘
                 独立发布            同一个 Next.js 项目
```

### 数据存储与访问

- **D1 数据库**：所有论坛数据存储在 Cloudflare D1（SQLite 兼容）
- **Worker API**：唯一的数据访问入口，所有前端项目通过 HTTP 调用 Worker 读写数据
- **认证模型**：双 Key 隔离 — Key A（`API_KEY`）守护公开/论坛端点，Key B（`ADMIN_API_KEY`）守护管理端点。论坛用户 JWT 用于 Web/CLI 写操作。Admin 路径仅验证 Key B（Admin 身份由 Next.js 服务端 Google OAuth 确认，Worker 无感知）

### 前端项目（共三个）

| 项目 | 技术栈 | 说明 | 部署 |
|------|--------|------|------|
| **CLI 客户端** | Rust / ratatui | 只读 TUI 工具，通过 Key A 读取数据，登录可选，可独立发布 | 独立二进制 |
| **Admin 管理后台** | Next.js | 论坛完整管理功能（用户/内容/版块管理），Key B + Google OAuth | 同一 Next.js 项目 |
| **Web 论坛前端** | Next.js | 基于网页的论坛浏览、发帖、回帖，Key A + 论坛用户 JWT | 同一 Next.js 项目 |

> Admin 和论坛前端在同一个 Next.js 项目中（`apps/web/`），通过路由分区（`/admin/*` vs `/`）。

## 技术选型

| 层次 | 技术 | 说明 |
|------|------|------|
| 运行时 | Bun | 原生 TypeScript 支持，内置测试框架 |
| 语言（Web/Worker） | TypeScript (strict) | 类型安全，重构友好 |
| 语言（CLI） | Rust (2024 edition) | 高性能 TUI，独立分发 |
| 数据库 | Cloudflare D1 | SQLite 兼容，全球分布式读副本 |
| 文件存储 | Cloudflare R2 | S3 兼容，无出口费用 |
| 缓存 | Cache API + Workers KV | 边缘缓存 + 全球 KV |
| Web 框架 | Next.js 16 | App Router, Server Components |
| API 层 | Cloudflare Workers | D1 中间层，手动路由 |
| CLI TUI | ratatui + crossterm | 全屏交互式终端 |
| CLI HTTP | ureq | 同步 HTTP 客户端 |
| 包管理 | pnpm | Workspace monorepo |
| 代码质量 | Biome (TS) + Clippy (Rust) | Lint + Format |
| 测试 | bun test (TS) + cargo test (Rust) | 各自生态内置 |

## Monorepo 结构

```
ellie/
├── apps/
│   ├── web/                    # Next.js（论坛前端 + Admin 管理后台）
│   │   ├── app/                # App Router 页面
│   │   │   ├── (forum)/        # 论坛前端路由
│   │   │   ├── admin/          # Admin 管理后台路由
│   │   │   └── api/            # API Routes
│   │   ├── components/         # React 组件
│   │   ├── viewmodels/         # MVVM ViewModel 层
│   │   ├── models/             # 数据模型
│   │   └── package.json
│   │
│   └── worker/                 # Cloudflare Worker API（唯一数据访问入口）
│       ├── src/
│       │   ├── index.ts        # Worker 入口，路由分发
│       │   ├── handlers/       # API 路由处理器
│       │   ├── middleware/     # API Key / JWT / CORS / 限流
│       │   └── lib/            # 工具（密码、JWT、映射）
│       ├── tests/              # Worker 测试
│       ├── wrangler.toml
│       └── package.json
│
├── packages/
│   ├── types/                  # 共享类型定义（Forum, Thread, Post, User）
│   ├── repositories/           # 共享 Repository 接口 + D1 实现
│   ├── db/                     # D1 客户端封装
│   ├── cli/                    # CLI 旧版骨架（TypeScript，将被 cli-rs 替代）
│   ├── cli-rs/                 # CLI 客户端（Rust TUI）
│   │   ├── ellie-core/         # Library crate（类型、HTTP client、配置）
│   │   └── ellie-tui/          # Binary crate（TUI 渲染、事件循环）
│   └── migrate/                # 数据迁移脚本（ETL）
│
├── docs/                       # 项目文档（编号体系）
├── reference/                  # 本地参考数据（gitignored）
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.json
└── biome.json
```

## 实施路线图

### Phase 1：数据迁移（已完成）
- 从 MySQL dump 解析数据
- 转换编码、BBCode、密码格式
- 写入本地 SQLite 验证
- 导入 Cloudflare D1
- 验证数据完整性

### Phase 2：Worker API 层（已完成）
- Cloudflare Worker API（路由、中间件、认证）
- API Key 认证机制
- 部署到 `ellie.worker.hexly.ai`
- 详见：[05-worker-api.md](./05-worker-api.md)

### Phase 3：Web 前端（设计完成，待实现）
- Next.js 论坛界面 + Admin 管理后台
- 详见：[04-application.md](./04-application.md)

### Phase 4：CLI 客户端（设计完成，待实现）
- Rust TUI 客户端
- 详见：[06-cli-design.md](./06-cli-design.md)

## 质量体系

采用六维质量体系（L1/L2/L3 + G1/G2 + D1），目标 Tier S。

### TypeScript 项目（Worker + Web）

| 维度 | 工具 | 配置 | 运行时机 |
|------|------|------|---------|
| L1 单元测试 | bun test | ≥95% 覆盖率 | pre-commit |
| L2 集成测试 | bun test | 真 HTTP 端点 | pre-push |
| L3 端到端测试 | Playwright | E2E 场景 | CI |
| G1 静态分析 | Biome strict | 0 error, 0 warning | pre-commit |
| G2 安全门控 | osv-scanner + gitleaks | 依赖漏洞 + 密钥泄露 | pre-push |
| D1 测试隔离 | tongjinet-db-test | 独立测试 D1 实例 | L2 连接 |

### Rust 项目（CLI）

| 维度 | 工具 | 配置 | 运行时机 |
|------|------|------|---------|
| L1 单元测试 | cargo test | ≥90% 覆盖率 | pre-commit |
| L2 集成测试 | cargo test --test integration | 真 HTTP 端点 | pre-push |
| L3 端到端测试 | 手动 smoke test | TUI 交互验证 | 按需 |
| G1 静态分析 | cargo clippy + cargo fmt | -D warnings | pre-commit |
| G2 安全门控 | osv-scanner + gitleaks | Cargo.lock 漏洞扫描 | pre-push |
| D1 测试隔离 | N/A | CLI 只读，无数据库直连 | — |

### Hook 映射

| Hook | TypeScript | Rust |
|------|-----------|------|
| pre-commit | biome check + tsc --noEmit + bun test | cargo fmt --check + cargo clippy + cargo test |
| pre-push | L2 tests + osv-scanner + gitleaks | cargo test --test integration + osv-scanner |
