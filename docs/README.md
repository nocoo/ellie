# Ellie 文档

## 架构概览

```
D1 数据库 → Worker API（唯一入口） → CLI 客户端 (Rust TUI)
                                   → Web 论坛前端 (Next.js)
                                   → Admin 管理后台 (Next.js)
```

## 文档索引

| 编号 | 文档 | 内容 |
|------|------|------|
| 01 | [架构设计](./01-architecture.md) | 系统架构、技术选型、Monorepo 结构、质量体系、实施路线图 |
| 02 | [数据库设计](./02-database-schema.md) | D1 Schema、字段映射、索引设计、性能方案、容量规划 |
| 03 | [数据迁移](./03-migration.md) | 迁移流程、ETL 设计、BBCode 转换、编码处理、验证清单 |

### Web 应用（Next.js：论坛前端 + Admin 管理后台）

| 编号 | 文档 | 内容 |
|------|------|------|
| 04 | [Web 应用（索引）](./04-application.md) | 执行入口、编号提交计划、质量演进时间线 |
| 04a | [MVVM 与数据结构](./04a-data-model.md) | TypeScript 类型、权限模型、Repository 接口、内容格式规约 |
| 04b | [前端架构选型](./04b-frontend-architecture.md) | 技术栈、项目结构、MVVM 分层、设计系统、认证方案 |
| 04c | [管理后台](./04c-admin-console.md) | Admin 布局、仪表盘/用户管理/内容审核/版块管理 |
| 04d | [论坛前端](./04d-forum-frontend.md) | 论坛布局、核心页面、分页策略、搜索、发帖回帖 |
| 04e | [高级功能](./04e-advanced-features.md) | 特殊帖子类型、富文本编辑器、表情系统、全文搜索、私信 |

### Worker API（数据访问层）

| 编号 | 文档 | 内容 |
|------|------|------|
| 05 | [Worker API](./05-worker-api.md) | Cloudflare Worker、路由设计、中间件、认证、限流 |

### CLI 客户端（Rust TUI）

| 编号 | 文档 | 内容 |
|------|------|------|
| 06 | [CLI 客户端](./06-cli-design.md) | Rust/ratatui TUI、状态机、事件循环、6 维质量体系 |
