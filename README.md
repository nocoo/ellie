<p align="center">
  <img src="logo.png" alt="Ellie" width="128" height="128" />
</p>

<h1 align="center">Ellie</h1>

<p align="center">
  <strong>现代化论坛系统，从经典 Discuz 数据迁移而来</strong><br>
  Server Components · Edge Computing · 全栈 TypeScript · Rust TUI
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16-black?logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Cloudflare_Workers-D1-f38020?logo=cloudflare" alt="Cloudflare Workers" />
  <img src="https://img.shields.io/badge/Rust-TUI-dea584?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/tests-7037-brightgreen" alt="Tests" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
</p>

---

## 这是什么

Ellie 是一个从 Discuz 论坛平滑迁移到现代技术栈的全功能社区系统。前端基于 Next.js App Router (React Server Components)，后端运行在 Cloudflare Workers 边缘网络，数据存储于 D1 (SQLite)。同时提供 Rust 编写的终端 TUI 客户端。

```
┌─────────────────────────────────────────────────────┐
│                    Browser                          │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│           Next.js (Server Components)               │
│   apps/web (forum)  │  apps/admin (admin console)   │
└─────────────────────┬───────────────────────────────┘
                      │ forumApi / adminApi
┌─────────────────────▼───────────────────────────────┐
│            Cloudflare Worker (Edge)                  │
│         apps/worker — REST API + Cron               │
└──────┬──────────────┬───────────────┬───────────────┘
       │              │               │
   ┌───▼───┐    ┌────▼────┐    ┌─────▼─────┐
   │  D1   │    │   KV    │    │    R2     │
   │(SQLite)│    │ (Cache) │    │ (Assets)  │
   └───────┘    └─────────┘    └───────────┘
```

## 功能

### 论坛核心

- **版块与主题** — 树形版块结构、主题分类、置顶/加精/高亮
- **帖子与回复** — 富文本编辑、楼中楼点评、附件上传、@提及
- **用户系统** — 注册/登录、用户组、积分/同钱、个人资料
- **站内信** — Discuz 风格私信收发
- **搜索** — 全文搜索主题
- **精华帖** — 多级精华、按年份/版块筛选

### 社区互动

- **每日签到** — 连续签到奖励、等级体系
- **主题分类** — 版块自定义分类标签（可选前缀显示）
- **版块公告** — 管理员可配置版块级公告

### 管理后台

- **内容审核** — 举报处理、敏感词过滤、附件管理
- **用户管理** — 禁言/封禁/IP 封禁、操作日志
- **统计分析** — 访问量趋势、登录审计、KPI 看板
- **站点配置** — 品牌定制、功能开关、分页设置、导航链接

### 终端客户端

- **Rust TUI** — ratatui 构建的终端界面，支持浏览/发帖/回复

## 项目结构

```
ellie/
├── apps/
│   ├── web/              # Next.js 论坛前端
│   ├── admin/            # Next.js 管理后台
│   └── worker/           # Cloudflare Worker API
├── packages/
│   ├── types/            # 共享 TypeScript 类型
│   ├── cli-rs/           # Rust TUI 客户端
│   │   ├── ellie-core/   #   API 客户端库
│   │   └── ellie-tui/    #   终端界面
│   ├── db/               # D1 Schema & Migrations
│   ├── repositories/     # 数据访问层
│   ├── shared/           # 共享工具函数
│   └── ui/               # 共享 UI 组件
├── tests/
│   ├── integration/      # L2 集成测试
│   └── e2e/              # L3 端到端测试
├── docs/                 # 设计文档 (40篇)
└── scripts/              # 工具脚本
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | [Next.js 16](https://nextjs.org/) (App Router, RSC, Turbopack) |
| UI | [Tailwind CSS 4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| 后端 | [Cloudflare Workers](https://workers.cloudflare.com/) (TypeScript) |
| 数据库 | [D1](https://developers.cloudflare.com/d1/) (SQLite at Edge) |
| 缓存 | [KV](https://developers.cloudflare.com/kv/) (边缘键值存储) |
| 存储 | [R2](https://developers.cloudflare.com/r2/) (对象存储) |
| 认证 | [NextAuth.js](https://next-auth.js.org/) + JWT |
| TUI | [Rust](https://www.rust-lang.org/) + [ratatui](https://ratatui.rs/) |
| 测试 | [Vitest](https://vitest.dev/) + [Playwright](https://playwright.dev/) |
| Lint | [Biome](https://biomejs.dev/) |
| 包管理 | [Bun](https://bun.sh/) |

## 开发

### 环境要求

- [Bun](https://bun.sh/) >= 1.3
- [Node.js](https://nodejs.org/) >= 22
- [Rust](https://rustup.rs/) >= 1.80 (仅 TUI)
- Cloudflare 账户 (Worker/D1/KV/R2)

### 快速开始

```bash
# 安装依赖
bun install

# 配置 Worker
cp apps/worker/wrangler.toml.example apps/worker/wrangler.toml
# 编辑 wrangler.toml 填入你的资源 ID

# 配置环境变量
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入 API_KEY 和 JWT_SECRET

# 启动开发服务器
bun run dev          # Next.js (port 7031)
bun run worker:dev   # Worker (local)
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动 Next.js 开发服务器 |
| `bun run worker:dev` | 启动 Worker 本地开发 |
| `bun run build` | 构建生产版本 |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run lint` | Biome 代码检查 |
| `bun run lint:fix` | 自动修复 lint 问题 |
| `bun run worker:deploy` | 部署 Worker (自动 migrate) |
| `bun run release` | 版本发布 (patch) |
| `bun run release -- minor` | Minor 版本发布 |

## 测试

| 层 | 内容 | 触发时机 | 命令 |
|---|---|---|---|
| L1 Unit | ViewModel、工具函数、Handler | pre-commit | `bun run test` |
| L2 Integration | 真实 Worker API 调用 | pre-push | `bun run test:integration` |
| L3 E2E | Playwright 浏览器测试 | CI | `bun run test:e2e` |
| G1 Static | TypeScript strict + Biome | pre-commit | `bun run typecheck && bun run lint` |
| G2 Security | osv-scanner + gitleaks | pre-push | 自动 |

```bash
# 运行全部 L1 测试
bun run test

# 带覆盖率
bun run test:coverage

# Rust 测试
cd packages/cli-rs && cargo test --workspace
```

## 部署

```bash
# Worker 部署 (自动先 apply migrations)
bun run worker:deploy

# Docker 镜像构建
docker build -f apps/web/Dockerfile -t ellie-web .
docker build -f apps/admin/Dockerfile -t ellie-admin .
```

详见 [docs/docker-deployment.md](docs/docker-deployment.md)。

## 文档

| 文档 | 说明 |
|------|------|
| [架构设计](docs/01-architecture.md) | 系统整体架构 |
| [数据库 Schema](docs/02-database-schema.md) | D1 表结构 |
| [数据迁移](docs/03-data-migration.md) | Discuz → Ellie 迁移方案 |
| [前端架构](docs/04b-frontend-architecture.md) | MVVM + RSC 模式 |
| [Worker API](docs/05-worker-api.md) | API 端点参考 |
| [API 参考](docs/07-api-reference.md) | 完整 API 文档 |
| [通用设置](docs/08-general-settings.md) | KV Settings 体系 |

## License

[MIT](LICENSE) © 2026 Zheng Li