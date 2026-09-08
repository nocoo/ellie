<p align="center">
  <img src="assets/brand/icon-rounded.png" alt="Ellie" width="128" height="128" />
</p>
<h1 align="center">Ellie</h1>
<p align="center">浏览与维护同济网论坛，将 Discuz 历史内容接入新的社区界面。</p>
<p align="center">
  <a href="https://bbs.tongji.net">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

Ellie 是同济网论坛使用的社区系统，也包含 Discuz 数据迁移工具。读者可以浏览版块、主题和用户资料，登录后按站点权限参与讨论；管理员通过独立后台维护内容、账号和站点设置。

仓库包含 Next.js 论坛前端、Next.js 管理后台、Cloudflare Worker API，以及 Rust 终端客户端。浏览器通过 Next.js 服务端访问 Worker；Worker 使用 D1 保存论坛数据，KV 保存缓存与部分运行状态，R2 保存上传文件。论坛与后台使用不同 API Key。

## 功能

- **版块与讨论**：树形版块、主题分类、公告、置顶与精华；网页支持富文本发帖、回复、点评、图片和附件。
- **社区互动**：用户资料、头像、站内信、每日签到、积分 / 同钱与帖子评分，写入操作受账号状态、邮箱验证和站点规则约束。
- **查找内容**：按主题标题搜索，并按版块、精华等入口浏览历史讨论。全文索引的当前范围是主题标题。
- **管理后台**：维护版块、主题、帖子、附件和用户，处理举报与敏感词，查看操作 / 登录记录及统计，调整站点设置与功能开关。
- **Discuz 迁移**：解析已有 MySQL dump，转换论坛、用户、主题、帖子、附件元数据、点评和签到等记录，输出本地 SQLite 数据库。
- **Rust TUI**：在终端浏览版块、主题、帖子和用户资料，筛选已加载列表、分页、登录和切换主题；发布与回复使用网页。

## 使用

访问[论坛](https://bbs.tongji.net)，选择版块或使用标题搜索。若站点开放注册，可创建论坛账号；已有迁移账号使用论坛用户名和密码登录。发帖、回复等操作需要完成邮箱验证，并满足对应版块和站点设置的条件。网页登录 / 注册界面使用 Cap 验证。

[管理后台](https://admin.tongji.net)使用 Google 登录和邮箱白名单，权限与论坛账号分开配置。

终端客户端需要 Rust 1.88+、可访问的 Worker 和论坛 API Key。完成下方本地开发配置后，在仓库根目录运行，将 `LOCAL_FORUM_KEY` 换成自己的 Worker `API_KEY`：

```bash
ELLIE_API_URL=http://127.0.0.1:8787 ELLIE_API_KEY=LOCAL_FORUM_KEY \
  cargo run --locked --manifest-path packages/cli-rs/Cargo.toml --bin ellie-tui
```

使用 `j` / `k` 或方向键移动，`Enter` 打开，`Esc` 返回，`n` 加载下一页，`/` 筛选当前列表，`L` 登录，`?` 查看帮助，`q` 退出。配置保存在操作系统配置目录的 `ellie/config.json`，也可用 `--config` 指定文件；格式与参数见[开发指南](docs/25-development.md)。

## 开发

准备 Node.js 22+ 和 Bun；仓库的 `packageManager` 指定 Bun 1.3.14。仅开发网页与 Worker 时无需 Rust。以下步骤用于全新 checkout：

```bash
git clone https://github.com/nocoo/ellie.git
cd ellie
bun install --frozen-lockfile
cp apps/worker/.dev.vars.example .dev.vars
ln -s ../../.dev.vars apps/worker/.dev.vars
cp apps/web/.env.local.example apps/web/.env.local
cp apps/admin/.env.local.example apps/admin/.env.local
```

启动前填写配置：

| 位置 | 必要内容 |
| --- | --- |
| 根 `.dev.vars` | 分别生成 `API_KEY`、`ADMIN_API_KEY`、`JWT_SECRET`；前两者使用不同值 |
| `apps/web/.env.local` | `AUTH_SECRET`、与 Worker `API_KEY` 一致的 `FORUM_API_KEY`；保留本地 `WORKER_API_URL`、`AUTH_URL` 与 `NEXT_PUBLIC_SITE_URL` |
| `apps/admin/.env.local` | 独立 `AUTH_SECRET`、匹配 Worker 的 `ADMIN_API_KEY`，以及 Google OAuth 的 `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`、`ADMIN_EMAILS` |

论坛登录与注册需要可用的 `NEXT_PUBLIC_CAP_API_ENDPOINT`。邮箱验证还需要 Worker 的 `EMAIL_VERIFY_HMAC_KEY`、Dove 配置与 Token；未配置时可以准备页面和数据，但无法完成这些交互。后台 Google 回调地址为 `http://localhost:7032/api/auth/callback/google`。

在本地独立目录初始化 D1，再启动 Worker：

```bash
./apps/worker/node_modules/.bin/wrangler d1 migrations apply DB --local \
  --persist-to .wrangler/state/dev -c apps/worker/wrangler.toml
./apps/worker/node_modules/.bin/wrangler dev --local --persist-to .wrangler/state/dev \
  -c apps/worker/wrangler.toml --port 8787
```

另开终端启动论坛；需要管理后台时再开一个终端：

```bash
bun run dev:forum
```

```bash
bun run dev:admin
```

论坛地址是 `http://localhost:7031`，后台是 `http://localhost:7032`。新库只有表结构和少量初始配置，需要通过后台维护版块或准备导入数据。上述命令显式使用本地资源；远程迁移和部署应使用自己的 Cloudflare 资源，详见[开发与部署指南](docs/25-development.md)。

| 命令 / 路径 | 用途 |
| --- | --- |
| `bun run build` | 构建论坛与管理后台 |
| `bun run typecheck`、`bun run lint` | 类型与代码检查 |
| `apps/worker/src/` | Worker 路由、权限、数据访问与定时任务 |
| `apps/worker/migrations/` | 当前 Worker 数据库迁移 |
| `packages/migrate/` | Discuz dump 解析、转换与本地 SQLite 输出 |
| `packages/cli-rs/` | Rust API 客户端与 TUI |

`main` 的 CI 成功后，Release 工作流部署论坛与后台的 Docker 镜像。Worker 由独立的 `bun run worker:deploy` 流程先迁移再部署，不随 Docker 发布更新。

## 测试

```bash
bun run test
bun run test:l2:fast
bun run test:e2e:api
```

`test` 运行各 TypeScript 包的单元测试；`test:l2:fast` 在进程内使用 SQLite 检查 Worker；`test:e2e:api` 自行初始化本地 D1、填入测试数据并启动真实 HTTP Worker。HTTP runner 默认用端口 17031，占用时选择空闲端口；每次重建 `.wrangler/state/e2e`。

```bash
bunx playwright install chromium
bun run test:e2e:bdd
cargo test --locked --manifest-path packages/cli-rs/Cargo.toml --workspace
```

浏览器 runner 顺序运行论坛和后台，覆盖导航、内容、搜索、会话状态、移动端布局及后台操作。它们共用端口 8788 的本地 Worker 与 `.wrangler/state/l3`，论坛占用 27031，后台占用 **7032**；运行前停止占用这些端口的开发服务。runner 会重建本地测试数据，无需远程测试 Worker。

论坛测试通过 Credentials 回调建立会话，后台测试注入测试会话。真实 Cap 界面、Google OAuth 和邮件投递不由这套浏览器测试验证。`cargo test` 运行 Rust 单元测试；依赖外部 API 的 Rust 集成测试默认不运行，配置方式见开发指南。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| TypeScript、Bun | 论坛应用、共享包、迁移与测试脚本 |
| Next.js、React | 论坛和管理后台、服务端 API 代理 |
| Tailwind CSS、shadcn/ui、Tiptap、Recharts | 页面组件、富文本编辑与统计图表 |
| Cloudflare Workers | 原生 Fetch API 路由与定时任务 |
| Cloudflare D1、KV、R2 | 论坛数据、缓存与状态、上传文件 |
| Auth.js、JWT | 论坛密码登录、后台 Google 登录与会话 |
| Cap、Dove | 网页验证控件与邮箱验证码发送 |
| Rust、ratatui、crossterm | 终端客户端 |
| Vitest、Bun test、Playwright | 单元、API 与浏览器测试 |

## 文档

- [文档索引](docs/README.md)：架构、功能与历史方案。
- [开发与部署指南](docs/25-development.md)：首次配置、运行时、TUI、迁移与测试前提。
- [API 分层](docs/api-architecture.md)：浏览器、Next.js 代理和 Worker 的职责。
- [Discuz 数据迁移](docs/03-migration.md)：迁移过程与源数据要求。
- [变更记录](CHANGELOG.md)：版本变化。

## 许可证

[MIT](LICENSE) © 2026 Zheng Li。
