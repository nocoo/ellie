# 架构设计

## 项目概述
Ellie 是一个将 Discuz! X3.4 论坛数据迁移到 Cloudflare 平台的项目。
- 源站：tongji.nocoo.cloud（MySQL 8.0, ~1170万行数据）
- 目标：Cloudflare D1（SQLite）+ R2（文件存储）

## 技术选型

| 层次 | 技术 | 原因 |
|------|------|------|
| 运行时 | Bun | 原生 TypeScript 支持，内置测试框架，SQLite 支持 |
| 语言 | TypeScript (strict) | 类型安全，重构友好 |
| 数据库 | Cloudflare D1 | SQLite 兼容，全球分布式读副本，Worker 原生绑定 |
| 文件存储 | Cloudflare R2 | S3 兼容，无出口费用，CDN 分发 |
| 缓存 | Cache API + Workers KV | 边缘缓存 + 全球 KV |
| 应用框架 | Next.js on Cloudflare | Phase 2，SSR + Workers 部署 |
| 包管理 | Bun | 内置包管理器 |
| 代码质量 | Biome | Lint + Format 一体化，比 ESLint 快 |
| 测试 | bun test | 内置，兼容 Jest API |

## 实施路线图

### Phase 1：数据迁移（当前）
- 从 MySQL dump 解析数据
- 转换编码、BBCode、密码格式
- 写入本地 SQLite 验证
- 导入 Cloudflare D1
- 验证数据完整性、编码正确性、查询性能

### Phase 2：API 层 + 管理后台
- Cloudflare Worker API
- 管理后台（用户管理、内容审核）

### Phase 3：BBS 前端
- Next.js 论坛界面
- 帖子列表、帖子阅读、用户资料

### Phase 4：搜索 + 高级功能
- Workers AI + Vectorize 语义搜索
- 实时通知
- 用户互动功能

## 项目结构

```
ellie/
├── docs/                     # 项目文档
├── scripts/
│   └── migrate/              # Phase 1: 迁移脚本
│       ├── index.ts          # 迁移入口
│       ├── extract/          # 数据提取（SQL dump 解析）
│       ├── transform/        # 数据转换（BBCode、编码、密码）
│       ├── load/             # 数据加载（SQLite/D1 写入）
│       └── verify/           # 迁移验证
├── src/                      # Phase 2+: 应用代码
├── tests/
│   ├── unit/                 # L1 单元测试
│   └── integration/          # L2 集成测试
├── reference/                # 本地参考数据（gitignored）
│   └── db/                   # MySQL dump 文件
├── package.json
├── tsconfig.json
├── biome.json
└── wrangler.toml
```

## 质量体系

采用六维质量体系（L1/L2/L3 + G1/G2 + D1），目标 Tier S。

| 维度 | 工具 | 配置 | 运行时机 |
|------|------|------|---------|
| L1 单元测试 | bun test | ≥95% 覆盖率 | pre-commit |
| L2 集成测试 | bun test | 真实 SQLite 数据 | pre-push |
| L3 端到端测试 | N/A | 迁移工具无 UI | — |
| G1 静态分析 | Biome strict | 0 error, 0 warning | pre-commit |
| G2 安全门控 | osv-scanner + gitleaks | 依赖漏洞 + 密钥泄露 | pre-push |
| D1 测试隔离 | ellie-db-test | 独立测试 D1 实例 | L2 连接 |

### Hook 映射

| Hook | 内容 | 时限 |
|------|------|------|
| pre-commit | L1 (bun test --coverage) + G1 (biome check) | <30s |
| pre-push | L2 (bun test integration) + G2 (osv-scanner + gitleaks) | <3min |
