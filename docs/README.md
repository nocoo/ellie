# Ellie 文档

[中文 README](../README.md) · [English README](README.en.md)

首次运行以 [25 · 本地开发与部署](25-development.md) 为入口。下方保留架构与功能设计；其中旧域名、远程测试步骤、CLI TOML 配置和「待实现」状态可能落后于当前代码，不作为安装依据。

## 架构概览

```
D1 数据库 → Worker API（唯一入口） → CLI 客户端 (Rust TUI, Key A)
                                   → Web 论坛前端 (Next.js, Key A)
                                   → Admin 管理后台 (Next.js, Key B + Google OAuth)
```

## 文档索引

| 编号 | 文档 | 内容 |
|------|------|------|
| 25 | [本地开发与部署](./25-development.md) | 当前三服务配置、本地 D1、Rust TUI JSON 配置、测试与部署前提 |
| 01 | [架构设计](./01-architecture.md) | 系统架构、技术选型、Monorepo 结构、质量体系、实施路线图 |
| 02 | [数据库设计](./02-database-schema.md) | D1 Schema、字段映射、索引设计、性能方案、容量规划 |
| 03 | [数据迁移](./03-migration.md) | 迁移流程、ETL 设计、BBCode 转换、编码处理、验证清单 |

### Web 应用（Next.js：论坛前端 + Admin 管理后台）

| 编号 | 文档 | 内容 |
|------|------|------|
| 04 | [Web 应用（索引）](./04-application.md) | 执行入口、编号提交计划、质量演进时间线 |
| 04a | [MVVM 与数据结构](./04a-data-model.md) | TypeScript 类型、权限模型、Repository 接口、内容格式规约 |
| 04b | [前端架构选型](./04b-frontend-architecture.md) | 技术栈、项目结构、MVVM 分层、设计系统、认证方案 |
| 04d | [论坛前端](./04d-forum-frontend.md) | 论坛布局、核心页面、分页策略、搜索、发帖回帖 |
| 04e | [高级功能](./04e-advanced-features.md) | 特殊帖子类型、富文本编辑器、表情系统、全文搜索、私信 |
| 04f | [论坛前端 UI 重写](./04f-forum-ui-redesign.md) | UI 重写设计：卡片化布局、纵向节约、宽度切换、响应式、6 阶段实施 |

### Worker API（数据访问层）

| 编号 | 文档 | 内容 |
|------|------|------|
| 05 | [Worker API](./05-worker-api.md) | Cloudflare Worker、双 Key 路由隔离、中间件、论坛 JWT + Google OAuth 认证、限流 |

### CLI 客户端（Rust TUI）

| 编号 | 文档 | 内容 |
|------|------|------|
| 06 | [CLI 客户端](./06-cli-design.md) | Rust/ratatui TUI、状态机、事件循环、6 维质量体系 |

### API 接口参考

| 编号 | 文档 | 内容 |
|------|------|------|
| 07 | [API 接口参考](./07-api-reference.md) | 双 Key 认证、数据实体与错误码；端点与行为以当前 Worker 路由为准 |

### 功能设计

| 编号 | 文档 | 内容 |
|------|------|------|
| 08 | [通用设置](./08-general-settings.md) | settings 表设计、KV 缓存策略、管理/公共 API 端点、前端设置页面 |
| 09 | [用户信息缓存重构](./09-user-cache-refactor.md) | 数据库规范化（ID 代替 Name）、KV 用户缓存、批量查询、缓存失效策略 |
| 12 | [站内信](./12-private-messages.md) | 私信界面、权限与存储设计 |
| 13 | [举报系统](./13-report-system.md) | 前台举报与后台处理 |
| 15 | [头像上传](./15-avatar-upload.md) | 用户头像与存储 |
| 16 | [帖子附件](./16-post-attachments.md) | 上传和附件访问 |
| 17 | [邮箱验证](./17-email-verification.md) | 邮件验证码、写入限制与 Dove 配置 |
| 20 | [Worker KV 参考](./20-worker-kv-reference.md) | 当前缓存与运行状态的用途 |
| 22 | [帖子评分](./22-post-rating.md) | 同钱/积分双维度评分、权限矩阵、滚动 24h 额度、撤销、ETL（packages/migrate） |
| 24 | [删除内容的占位处理](./24-tombstone-content-blanking.md) | 历史内容与删除状态的显示约定 |

### 管理功能

| 编号 | 文档 | 内容 |
|------|------|------|
| 10 | [管理后台](./10-admin-console.md) | 仪表盘、内容管理与设置的设计；部分功能状态说明已过时 |
| 11 | [前台管理](./11-frontend-moderation.md) | 版主/超版/用户前台管理功能：帖子管理、回帖管理、用户管理；入口位置、权限矩阵 |

### 搜索功能

| 编号 | 文档 | 内容 |
|------|------|------|
| 14 | [搜索功能](./14-search.md) | D1 FTS5 全文搜索、主题标题索引、Worker API、前端对接 |

### 运行与部署背景

- [API 分层](api-architecture.md)：浏览器、Next.js 代理与 Worker。
- [Docker 部署](docker-deployment.md)：镜像与服务器结构；域名按当前工作流或自己的配置调整。
- [本地测试栈设计](23-local-test-stack.md)与 [BDD 重构](23-l3-bdd-refactor.md)：保留改造过程，实际 runner 使用方式见 25 指南。

### 已归档文档

旧版设计文档已移至 `docs/archive/`：
- `04c-admin-console.md` → 已由 `10-admin-console.md` 替代
