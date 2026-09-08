# 本地开发与部署

## 应用与配置边界

Ellie 的三个服务各自运行：论坛 `apps/web`（7031）、管理后台 `apps/admin`（7032）、Worker `apps/worker`（本地示例为 8787）。浏览器调用 Next.js 路由，Next.js 在服务端附带 API Key 请求 Worker。Rust TUI 直接调用 Worker，也需要论坛 API Key。

| 配置 | 消费方 | 用途 |
| --- | --- | --- |
| 根 `.dev.vars`，通过 `apps/worker/.dev.vars` 符号链接共享 | Wrangler、本地 TUI 启动脚本 | Worker API Key、JWT 与可选服务密钥 |
| `apps/web/.env.local` | Next.js 论坛 | 论坛 API Key、会话、站点地址与 Cap 端点 |
| `apps/admin/.env.local` | Next.js 后台 | 后台 API Key、会话、Google OAuth 与邮箱白名单 |

模板分别是 `apps/worker/.dev.vars.example`、`apps/web/.env.local.example`、`apps/admin/.env.local.example`。首次复制与启动命令见[中文 README](../README.md)和 [English README](README.en.md)。已有配置不要重复覆盖；如果 Worker 路径已有文件，先检查它是否为指向 `../../.dev.vars` 的链接。

Worker 的 `API_KEY` 对应论坛 `FORUM_API_KEY`；`ADMIN_API_KEY` 对应后台同名变量。两种 Key 分开生成，分别用于 `/api/v1/*` 和 `/api/admin/*`。两套 Next.js 应用也各自使用 `AUTH_SECRET`。

## 本地数据初始化

下面的命令从仓库根目录运行，使用仓库现有配置中的资源名称，但通过 `--local` 将数据保存到本机。`.wrangler/state/dev` 与自动测试目录分开。

```bash
./apps/worker/node_modules/.bin/wrangler d1 migrations apply DB --local \
  --persist-to .wrangler/state/dev -c apps/worker/wrangler.toml
./apps/worker/node_modules/.bin/wrangler dev --local --persist-to .wrangler/state/dev \
  -c apps/worker/wrangler.toml --port 8787
```

迁移目录是 `apps/worker/migrations/`。新库建立表、索引与少量默认状态，不包含已有社区的用户和帖子；通过后台建立版块，或单独准备迁移数据。`packages/db` 和迁移工具中的模型不应替代 Worker 当前的增量迁移序列。

论坛和后台模板已经使用本地 `WORKER_API_URL=http://127.0.0.1:8787`。保留该值，并让两边 Key 与 Worker 匹配。`bun run dev:forum` 和 `bun run dev:admin` 只启动各自的 Next.js，不负责启动 Worker。

## 登录与可选服务

- 论坛使用用户名 / 密码，通过 Auth.js Credentials 调用 Worker 登录接口。Cap 控件位于网页的登录、注册及相关交互中，`NEXT_PUBLIC_CAP_API_ENDPOINT` 为空时界面禁止提交。当前 Credentials 回调本身不验证 Cap Token，不能把网页控件当作 API 的完整防自动化保证。
- 发帖、回复等写入要求账号状态允许且邮箱已验证。验证码服务需要 Worker 的 `EMAIL_VERIFY_HMAC_KEY`、`DOVE_WEBHOOK_TOKEN`，以及 Wrangler 中的 `DOVE_BASE_URL`、`DOVE_PROJECT_ID`、`DOVE_TEMPLATE_SLUG`。示例配置的邮件服务并非可直接使用的公共演练接口。
- 后台使用 Google OAuth 与 `ADMIN_EMAILS`。本地 Google OAuth Web 客户端的回调 URI 为 `http://localhost:7032/api/auth/callback/google`；它与论坛用户的版主 / 管理角色不是同一套登录配置。
- `ANALYTICS_INGEST_KEY` 同时配置在 Worker 与论坛时，论坛可转发页面访问样本；未设置时不阻塞浏览。后台 IP 查询还需要 `IP_LOOKUP_API_KEY`。

最小本地环境可以先检查页面与数据读取。完整注册、邮箱验证和后台登录需要为相应服务准备自己的配置，不能仅靠空白模板完成。

## Rust TUI

Rust workspace 位于 `packages/cli-rs`，要求 Rust 1.88+。`ellie-core` 提供 API 与配置，`ellie-tui` 提供 ratatui 界面。当前 TUI 的网络动作包括读取版块、主题、帖子、用户和登录；`/` 筛选已加载列表，不调用论坛全文搜索。

从仓库根目录构建并查看命令帮助：

```bash
cargo build --locked --release --manifest-path packages/cli-rs/Cargo.toml
packages/cli-rs/target/release/ellie-tui --help
```

实际配置是 JSON，键名使用 camelCase：

```json
{
  "apiUrl": "http://127.0.0.1:8787",
  "apiKey": "LOCAL_FORUM_KEY",
  "theme": "default"
}
```

默认位置由操作系统决定：Linux 通常为 `~/.config/ellie/config.json`，macOS 使用应用配置目录；可以用 `--config /path/to/config.json` 指定文件。配置中还会保存登录会话。

覆盖顺序为命令行 `--api-url` / `--api-key`，然后 `ELLIE_API_URL` / `ELLIE_API_KEY`，最后配置文件与构建默认值。源码构建未提供内置 Key 时必须自行配置；默认 API 地址指向线上 Worker，连接本地时要显式修改。

根脚本 `bun run tui` 直接运行 `target/release/ellie-tui`，并从根 `.dev.vars` 读取 Key，因此使用前必须先完成 release 构建。需要本地 URL 时同时设置 `ELLIE_API_URL`。`packages/cli` 是旧 TypeScript CLI；本指南以 Rust 客户端为准。

## 测试入口与资源

常用命令见 README。当前自动化入口的资源分配如下：

| 命令 | 运行范围与资源 |
| --- | --- |
| `bun run test` | TypeScript 各包单元测试及 Bun 专用用例 |
| `bun run test:l2:fast` | 进程内 Worker + 内存 SQLite |
| `bun run test:e2e:api` | 本地 Worker；默认 17031，可自动选空闲端口；重建 `.wrangler/state/e2e` |
| `bun run test:e2e:browser` | 论坛 Next.js 27031 + 本地 Worker 8788；重建 `.wrangler/state/l3` |
| `bun run test:e2e:admin` | 后台 Next.js 7032 + 同一 Worker 端口 / 状态目录 |
| `bun run test:e2e:bdd` | 顺序运行上述论坛、后台浏览器测试 |

浏览器测试使用本地数据；论坛会话来自 Credentials 回调，后台由测试辅助函数生成签名会话。真实 Cap 操作场景被跳过，Google OAuth 与邮箱真实投递也未由此验证。测试前保持 8788、27031、7032 空闲；不要同时运行论坛和后台浏览器 runner。

`bun run test:integration` 与 `bun run test:e2e` 是较底层的测试入口，不负责完整服务生命周期。首次运行优先使用上表的 runner。旧文档中的 `--remote --env test` 或部署远程测试 Worker 步骤不适用于当前常用测试流程。

Rust 的普通 `cargo test --workspace` 不执行标为 ignored 的外部 API 集成用例。手动执行这些用例时，先准备专用测试 Worker，并设置 `ELLIE_API_URL`、`ELLIE_API_KEY`；不要指向生产数据。

```bash
cargo test --locked --manifest-path packages/cli-rs/Cargo.toml \
  --test integration -- --ignored
```

## Discuz 数据迁移

`packages/migrate/src/index.ts` 读取已有 MySQL dump，按依赖关系导入论坛、用户、主题、帖子等表，并生成本地 SQLite 输出与校验报告。源文件要求与转换范围见[迁移设计](03-migration.md)。在仓库根目录指定输入与一个独立输出文件：

```bash
bun run packages/migrate/src/index.ts \
  --source /path/to/discuz-dumps --db output/ellie-import.db
```

该步骤处理数据库记录，附件元数据的转换不等于复制所有附件文件，也不自动完成生产 D1 导入或域名切换。先核对输出、用户权限、内容转换和文件资源，再准备实际切换流程。

## 部署

当前 [.github/workflows/release.yml](../.github/workflows/release.yml) 在 `main` CI 成功后构建并部署论坛与后台 Docker 镜像，外部检查地址为 `https://bbs.tongji.net` 与 `https://admin.tongji.net`。它不部署 Worker。

Worker 使用独立流程，生产入口 `bun run worker:deploy` 会先应用待执行 D1 迁移，再部署代码。自行托管时，需先替换 `apps/worker/wrangler.toml` 的 D1、KV、R2、域名 / 邮件配置，设置自己的 Worker secrets 与 Next.js 环境。远程迁移脚本中的数据库名称也要与自己的资源对应。

[Docker 部署说明](docker-deployment.md)保留镜像与服务器结构，但其中旧 `ellie.hexly.ai` 域名示例需要按当前工作流或自己的域名调整。不要将历史部署样例直接作为新环境的完整配置。
