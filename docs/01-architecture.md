# 架构设计

## 项目概述
Ellie 是一个将 Discuz! X3.4 论坛数据迁移到 Cloudflare 平台的项目。
- 源站：tongji.nocoo.cloud（MySQL 8.0, ~1170万行数据）
- 目标：Cloudflare D1（SQLite）+ R2（文件存储）

## 技术选型

| 层次 | 技术 | 原因 |
|------|------|------|
| 运行时 | Bun | 原生 TypeScript 支持，内置测试框架，内置 SQLite（`bun:sqlite`） |
| 语言 | TypeScript (strict) | 类型安全，重构友好 |
| 本地 SQLite | `bun:sqlite` | Bun 内置，零依赖，API 兼容 better-sqlite3，用于迁移脚本写入本地 D1 文件 |
| 数据库 | Cloudflare D1 | SQLite 兼容，全球分布式读副本，Worker 原生绑定 |
| 文件存储 | Cloudflare R2 | S3 兼容，无出口费用，CDN 分发 |
| 缓存 | Cache API + Workers KV | 边缘缓存 + 全球 KV |
| 应用框架 | Next.js 16 | App Router, Turbopack, Server Components |
| Worker API | Cloudflare Workers | D1 中间层，边缘计算 |
| CLI 客户端 | Commander + Inquirer | Telnet 风格命令行界面 |
| 包管理 | pnpm | Workspace monorepo 支持 |
| 代码质量 | Biome | Lint + Format 一体化，比 ESLint 快 |
| 测试 | bun test | 内置，兼容 Jest API |

## 实施路线图

### Phase 1：数据迁移（已完成）
- 从 MySQL dump 解析数据
- 转换编码、BBCode、密码格式
- 写入本地 SQLite 验证
- 导入 Cloudflare D1
- 验证数据完整性、编码正确性、查询性能

### Phase 2：API 层 + 管理后台（进行中）
- Cloudflare Worker API
- 管理后台（用户管理、内容审核）

### Phase 3：BBS 前端
- Next.js 论坛界面
- 帖子列表、帖子阅读、用户资料

### Phase 4：CLI 客户端
- Telnet 风格命令行界面
- 浏览版块、主题、帖子
- 发布回复

## Monorepo 结构

```
ellie/
├── apps/
│   ├── web/                    # Next.js 前端
│   │   ├── app/                # App Router 页面
│   │   ├── components/         # React 组件
│   │   ├── lib/                # 工具函数
│   │   ├── models/             # 数据模型
│   │   └── package.json
│   │
│   └── worker/                 # Cloudflare Worker API
│       ├── src/
│       │   ├── index.ts        # Worker 入口
│       │   ├── handlers/       # API 路由处理器
│       │   ├── middleware/     # 认证/限流/CORS
│       │   └── lib/
│       ├── wrangler.toml
│       └── package.json
│
├── packages/
│   ├── types/                  # 共享类型定义
│   │   ├── src/                # Forum, Thread, Post, User 等
│   │   └── package.json
│   │
│   ├── repositories/           # 共享 Repository
│   │   ├── src/
│   │   │   ├── types.ts        # Repository 接口
│   │   │   ├── mock/           # Mock 实现
│   │   │   └── d1/             # D1 实现（Worker 用）
│   │   └── package.json
│   │
│   ├── db/                     # 共享 D1 客户端
│   │   ├── src/
│   │   │   ├── d1.ts           # D1 客户端封装
│   │   │   └── schema.ts       # 表结构定义
│   │   └── package.json
│   │
│   ├── cli/                    # Telnet 风格 CLI
│   │   ├── src/
│   │   │   ├── index.ts        # CLI 入口
│   │   │   ├── commands/       # 命令实现
│   │   │   └── client.ts       # Worker API 客户端
│   │   └── package.json
│   │
│   └── migrate/                # 迁移脚本
│       ├── src/
│       │   ├── index.ts
│       │   ├── extract/
│       │   ├── transform/
│       │   ├── load/
│       │   └── verify/
│       └── package.json
│
├── docs/                       # 项目文档
├── tests/
│   ├── unit/                   # L1 单元测试
│   └── integration/            # L2 集成测试
├── reference/                  # 本地参考数据（gitignored）
│   └── db/                     # MySQL dump 文件（~1.4 GB）
├── pnpm-workspace.yaml         # Workspace 配置
├── package.json                # Root package.json
├── tsconfig.json               # Root tsconfig（references）
├── biome.json
└── wrangler.toml
```

## 质量体系

采用六维质量体系（L1/L2/L3 + G1/G2 + D1），目标 Tier S。

| 维度 | 工具 | 配置 | 运行时机 |
|------|------|------|---------|
| L1 单元测试 | bun test | ≥95% 覆盖率 | pre-commit |
| L2 集成测试 | bun test | 真实 SQLite 数据 | pre-push |
| L3 端到端测试 | Playwright | E2E 场景 | CI |
| G1 静态分析 | Biome strict | 0 error, 0 warning | pre-commit |
| G2 安全门控 | osv-scanner + gitleaks | 依赖漏洞 + 密钥泄露 | pre-push |
| D1 测试隔离 | ellie-db-test | 独立测试 D1 实例 | L2 连接 |

### Hook 映射

| Hook | 内容 | 时限 |
|------|------|------|
| pre-commit | L1 (bun test --coverage) + G1 (biome check) | <30s |
| pre-push | L2 (bun test integration) + G2 (osv-scanner + gitleaks) | <3min |
