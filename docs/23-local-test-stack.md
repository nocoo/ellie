# 23 — 本地化测试栈：移除远端 D1/Worker 测试资源

> **状态**：草稿，待哥 review 后进入实施。
> **作者**：Claude（Opus 4.7）+ @zheng-li
> **取代/相关**：扩展 [docs/18-quality-baseline.md](./18-quality-baseline.md) 的 L2/L3 章节；与 [docs/01-architecture.md](./01-architecture.md) §"D1 测试隔离"段、[docs/06-cli-design.md](./06-cli-design.md) §"资源隔离"段联动更新。

---

## 0. 背景与依据

### 0.1 当前状态调查（2026-06-13）

L1 / L2 已经**完全本地化**，仅 L3 与若干旁路脚本仍依赖 Cloudflare 远端测试资源：

| 资源 | 类型 | 当前用途 | 远端依赖来源 |
|---|---|---|---|
| `tongjinet-db-test` | D1 数据库（`940c7758-…`） | L3 跑 Playwright 时承载真数据 | `apps/worker/wrangler.toml` `[env.test]` `database_id` |
| `ellie-test` | Worker 服务（`ellie-test.<account>.workers.dev`） | L3 SSR 与 client API 打的真后端 | `apps/worker/wrangler.toml` `[env.test]` `name`，CI secret `WORKER_URL_TEST` |
| `tongjinet-test` | R2 桶 | `[env.test.r2_buckets]` 绑定 | `apps/worker/wrangler.toml` `[env.test]` |
| KV `490227e9…` | KV（与 prod preview_id 同 ID 复用） | `[env.test.kv_namespaces]` 绑定 | 同上 |

**真正在调用远端的 21 处引用**（详见 §1.2 全量清单）：
- `.github/workflows/ci.yml:62-109`：`browser-e2e` job 申请 5 个 CF secret，`wrangler d1 migrations apply --remote`、`wrangler deploy --env test`、`wrangler d1 execute tongjinet-db-test --remote`。
- `scripts/run-l3.ts:84,109`、`scripts/run-l3-admin.ts:81,98`：要求 `WORKER_API_URL` 含 `-test` 才放行。
- `scripts/verify-test-db.ts:39,79`：直接 `wrangler d1 execute tongjinet-db-test --env test --remote`。
- `package.json` `worker:migrate:test` / `worker:deploy:test`：把 `--remote --env test` 写死。
- `apps/worker/wrangler.toml:47-77`：整个 `[env.test]` 段。
- 数据迁移脚本 `scripts/import/{dry-run,full-migration,d1-importer}.ts`、`scripts/migrate/IMPORT-PLAN.md`：把 `tongjinet-db-test` 当 dry-run 影子库。**这部分与测试无关，本期不动。**
- 文档：`CLAUDE.md` 多处、`docs/01-architecture.md`、`docs/06-cli-design.md`、`docs/04b-frontend-architecture.md`、`docs/03-data-migration.md`、`docs/10-admin-console.md`、`docs/14a-audit-logs.md`、`docs/17-email-verification.md`、`CHANGELOG.md`。

### 0.2 参考实现

`/Users/nocoo/workspace/personal/surety` 已经做到完全本地。关键招数：

1. **L2 双层**：`L2-fast`（in-process 调 `app.request()` + bun:sqlite `:memory:`，毫秒级、零子进程）+ `L2-HTTP`（真 `wrangler dev --local --persist-to`，仅承载必须验证 HTTP/binding/中间件链路的少量用例）。
2. **`INIT_SQL` 单一 schema 源**：`packages/db/src/index.ts` 一个大 `CREATE TABLE IF NOT EXISTS` 块，bun:sqlite 直接 `exec()`，wrangler-local 则 `wrangler d1 execute --local --file=<temp>`。
3. **L3 也跑本地 wrangler**：`scripts/run-l3-server.ts` 起本地 `wrangler dev --local --persist-to`，Playwright 打本地端口。**CI 完全不碰云**。

### 0.3 当前痛点

| 痛点 | 现状 |
|---|---|
| **CI 强依赖 CF token** | `browser-e2e` job 需要 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`D1_TEST_DATABASE_ID`、`WORKER_URL_TEST` 4 个 secret；token scope 不全时（如 KV 写权限缺失）退化为 `continue-on-error: true`，跑的可能是 stale worker code。 |
| **L3 共享 DB 串扰** | `tongjinet-db-test` 是单实例，多并发 PR 跑同一份 fixtures（forum 1/2/114、user 1/2/3/100/64495、thread 662174-662198），seed 用 `INSERT OR REPLACE` + 局部 `DELETE` 来"自洽"，本质上仍是脆弱的写共享。 |
| **L2 启动 = 5–10s + 端口冲突** | `run-l2.ts` 硬编码 8787，遇到本机另一个 wrangler 占用（本人今日已遇 `wooly` 项目占 PID 45201）就 3 次重试全失败。 |
| **L1 的 `createMockDb` 是脆弱的 SQL 子串正则匹配** | `apps/worker/tests/helpers.ts:251-346`，260+ 行；任何 SQL 改写都可能误中或漏中，遮蔽真 bug。**本期不动，列入 §9 后续。** |
| **`verify-test-db.ts` 触网** | 手动 gate，每次跑都要 CF 凭据。 |

---

## 1. 目标 / 非目标

### 1.1 目标

1. **彻底脱离 `tongjinet-db-test` D1 与 `ellie-test` Worker**：L1/L2/L3 任何一层、本地或 CI 都不再请求远端 CF 资源（除生产部署外）。
2. **L2 提速**：90% L2 用例进入 `L2-fast` in-process 通道，单次启动开销从 ~5–10s 降到 0；保留 `L2-http` 一层用于真实 HTTP/binding 路径覆盖。
3. **L2 端口稳定**：消除 8787 硬编码，自动探测可用端口；本机多项目并行不互相打架。
4. **L3 完全本地**：CI 只需 Bun + Node + Playwright + 本地 wrangler，不需要任何 CF secret。
5. **覆盖率提升**：`L2-fast` 启动开销近 0，使每个 handler 都加挂 1 个快路径用例成为可能；维持现有 134/134 路由覆盖（`docs/18-l2-coverage-matrix.md`），并在上面加一层 `L2-fast` 覆盖（详 §6.4）。

### 1.2 非目标

1. ⛔ **不重写 L1**：`createMockDb` 的现代化（迁到 bun:sqlite `:memory:`）作为后续任务，不阻塞本期。
2. ⛔ **不动数据迁移工具链**：`scripts/import/*.ts` 仍可用 `tongjinet-db-test` 做 dry-run 影子库（实际 push 到生产前的 sandbox），与"运行测试"语义无关，`[env.test]` 段最终保留**只供 import 工具链用**或迁出独立 `wrangler.import.toml`（§7 二选一）。
3. ⛔ **不动 prod 部署链路**：`worker:deploy` / `worker:migrate:prod` 不变。
4. ⛔ **本期不删除 CF 上的 D1/Worker 资源**：先把代码侧解耦，CF 控制台保留 1 个月观察期，再由哥手动删除。

---

## 2. 总体方案

### 2.1 三层目标态

```
L1  apps/worker/tests/unit/**          unit + mock helpers      (现状保持)
L2-fast tests/integration/fast/**      in-process app.request   (新增) 
L2-http tests/integration/http/**      wrangler dev --local     (从现 tests/integration/ 迁入)
L3  tests/e2e/**                       wrangler dev --local + Next.js dev (改造现 run-l3.ts)
```

**核心区别于 surety**：surety 的 worker 用 Hono，可直接 `app.request(path, init, env)`；Ellie 的 worker 是手写 router（`apps/worker/src/index.ts:fetch()`），但**入口同样是 `worker.fetch(req, env, ctx)`**——所以 `L2-fast` 调用模式是 `import worker from "@/worker"` 然后 `worker.fetch(new Request(url, init), mockEnv, mockCtx)`，无需 Hono。

### 2.2 INIT_SQL 单一源

新增 `apps/worker/src/test-support/init-sql.ts`，导出一个 `INIT_SQL: string` 常量。生成方式：
- 启动时按编号顺序拼接 `apps/worker/migrations/0000_init_schema.sql` … `0050_*.sql`，所有 `CREATE TABLE` 改为 `CREATE TABLE IF NOT EXISTS`，`INSERT` 包到 `INSERT OR IGNORE`。
- 由 `scripts/build-init-sql.ts` 显式生成，产物写到 `apps/worker/src/test-support/init-sql.generated.ts`。
- `L2-fast` 直接 `db.exec(INIT_SQL)` 一次建库；`L2-http` 仍走 `wrangler d1 migrations apply --local`（互证两条路径产物等价 — §8 增加 hash 校验测试）。

> **为什么不直接 `for-each migration apply`**：bun:sqlite `:memory:` 没有 wrangler 介入，需要纯 SQL；从现有 migrations 拼是最简方案。

#### 2.2.1 生成产物：提交而非 gitignore（修订 — review #1）

**初版方案**用 postinstall hook + gitignore，但 CI 用 `bun install --frozen-lockfile --ignore-scripts`（`.github/workflows/ci.yml:26,50,79`），postinstall 不会跑，clean checkout 中 L2-fast `import` 直接找不到文件。

**修订方案**：**生成文件提交进 git**，与 migration 同步演进：
- `apps/worker/src/test-support/init-sql.generated.ts` 进版本控制，**不 gitignore**。
- 文件顶部明确标注 `/* AUTO-GENERATED — do not edit by hand. Run: bun run prepare:test-sql */`，并附 source migrations 的 sha256。
- `scripts/build-init-sql.ts` 提供两种模式：
  - 默认：重生成并写盘。
  - `--check`：读现有文件、重新计算 hash、不一致则 exit 1（不写盘）。
- **G1 typecheck 链增加 `bun run prepare:test-sql --check`**：现状 `package.json:57` 的 `typecheck` 是 `bash scripts/typecheck.sh`（含 Next route types freshness 检查 + 必要时 `next build` rebuild + `tsc --build`）。**不能**简单替换为 `prepare:test-sql --check && tsc -b`，会丢掉 route type freshness 守卫。改为在 `scripts/typecheck.sh` 开头加一行：
  ```bash
  # scripts/typecheck.sh — 顶部加（review v3 #2）
  bun run prepare:test-sql --check
  ```
  保证改 migration 后未同步重生成的 PR 在 typecheck 阶段就被拦住，且不影响后续 route types 检查与 `tsc --build`。CI 已经跑 `bun run typecheck`（`base-ci/.github/workflows/bun-quality.yml`），自动获得这层拦截。
- pre-commit / pre-push hook（如有）同样串入 `--check`。
- `bun install` 不再依赖 postinstall — 即便加了，`--ignore-scripts` 仍跳过，但因为文件已 commit，零影响。

三条路径覆盖：
| 场景 | 行为 |
|---|---|
| 普通 dev | 文件已存在；改 migration 后跑 `bun run prepare:test-sql` 重生成并 commit |
| CI clean checkout | 文件已在 git，import 直接找到；`typecheck` 步骤的 `--check` 拦住未同步 PR |
| L2-fast 测试启动 | 直接 import generated 常量，零启动开销 |

### 2.3 L2-fast 入口约定

```ts
// tests/integration/fast/_helpers/env.ts
import { Database } from "bun:sqlite";
import worker from "../../../apps/worker/src/index";
import { INIT_SQL } from "../../../apps/worker/src/test-support/init-sql.generated";

export function createTestEnv() {
  const sqlite = new Database(":memory:");
  sqlite.exec(INIT_SQL);
  return {
    DB: wrapAsD1(sqlite),       // D1 binding shim — see §3.1
    KV: createMockKV(),         // 复用 apps/worker/tests/helpers.ts:createMockKV
    R2: createMockR2(),         // 复用 createMockR2
    ENVIRONMENT: "test",
    API_KEY: "test-api-key",
    ADMIN_API_KEY: "test-admin-api-key",
    JWT_SECRET: "test-secret-key-for-jwt-hs256",
    ALLOWED_ORIGINS: "*",
    DOVE_BASE_URL: "https://dove.test",
    DOVE_PROJECT_ID: "test-proj",
    DOVE_TEMPLATE_SLUG: "verify-email",
    DOVE_WEBHOOK_TOKEN: "test-token-not-real",
    EMAIL_VERIFY_HMAC_KEY: "test-hmac-key",
  };
}

// ExecutionContext shim that *captures* waitUntil promises so tests can
// optionally await background work (e.g. tryTrackAuth at index.ts:101).
// Without this, background errors become unobserved promise rejections and
// any state mutation that backgrounds writes is unreachable from assertions.
//
// review v3 #3: 把每个 task 包成"始终 resolve 的 Result"，这样 push 到 tasks
// 的 promise 永远不会触发 unhandled rejection；flush() 再统一检查并抛第一个
// 错误。等价于 Promise.allSettled，但显式 + 无序号依赖。
type Settled = { ok: true } | { ok: false; err: unknown };

export function createTestCtx() {
  const tasks: Promise<Settled>[] = [];
  return {
    waitUntil(p: Promise<unknown>) {
      tasks.push(
        Promise.resolve(p).then(
          () => ({ ok: true }) as Settled,
          (err: unknown) => ({ ok: false, err }) as Settled,
        ),
      );
    },
    passThroughOnException() {},
    /**
     * Test-only: await everything queued via waitUntil. Returns once all
     * background tasks settled. If any rejected, throws the first error so
     * assertions see real failures; subsequent rejections are still settled
     * (no unhandled-rejection warnings).
     */
    flush: async () => {
      const all = tasks.splice(0, tasks.length);
      const results = await Promise.all(all);  // safe: each task always resolves
      const failed = results.find((r): r is { ok: false; err: unknown } => !r.ok);
      if (failed) throw failed.err;
    },
  };
}

// review v3 #5 + v4 #3: 默认 workerFetch 返回 Response（标准 fetch 形态），
// 同时把后台 waitUntil 错误"必被检查"——fast harness 维护一个"当前测试 ctx"，
// workerFetch 内部绑到它，全测试公共的 afterEach 统一 flush。
//
// 这样保持 Worker 语义（response 不被 waitUntil 拖延），又确保
// 后台错误一定在某个 await 处抛出，不会静默吞掉。
//
// 用法：
//   - 大多数用例：beforeEach(setCurrentTestCtx); afterEach(flushCurrentTestCtx);
//     测试体 const res = await workerFetch(env, ...); expect(res.status)...
//   - 需要在测试中显式断言后台写：用 workerFetchWithCtx 拿到 ctx，await ctx.flush() 后断言

let CURRENT_TEST_CTX: ReturnType<typeof createTestCtx> | null = null;

export function setCurrentTestCtx(): ReturnType<typeof createTestCtx> {
  CURRENT_TEST_CTX = createTestCtx();
  return CURRENT_TEST_CTX;
}

/** 在 afterEach 调用：flush 当前测试期间所有 waitUntil，未检查的错误会在此抛出。 */
export async function flushCurrentTestCtx(): Promise<void> {
  const ctx = CURRENT_TEST_CTX;
  CURRENT_TEST_CTX = null;
  if (ctx) await ctx.flush();
}

export async function workerFetch(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  // 若 harness 已经 setCurrentTestCtx，则共用当前 ctx（保证 afterEach flush 到）；
  // 否则起一个一次性的 ctx 并在返回前立即 flush（防止漏检）。
  const useShared = CURRENT_TEST_CTX != null;
  const ctx = CURRENT_TEST_CTX ?? createTestCtx();
  const res = await worker.fetch(new Request(`http://localhost${path}`, init), env, ctx);
  if (!useShared) {
    // 没有 harness ctx 时立即 flush —— 慢一点点（等后台 task），但绝不静默
    await ctx.flush();
  }
  return res;
}

export async function workerFetchWithCtx(
  env: Env,
  path: string,
  init?: RequestInit,
  ctx: ReturnType<typeof createTestCtx> = CURRENT_TEST_CTX ?? createTestCtx(),
): Promise<{ res: Response; ctx: ReturnType<typeof createTestCtx> }> {
  const res = await worker.fetch(new Request(`http://localhost${path}`, init), env, ctx);
  return { res, ctx };
}
```

**通用 harness 配套**（推荐放到 `tests/integration/fast/_helpers/setup.ts`，每个 `*.fast.test.ts` 隐式 import 或显式 `beforeEach`/`afterEach`）：

```ts
import { beforeEach, afterEach } from "bun:test";
import { setCurrentTestCtx, flushCurrentTestCtx } from "./env";

beforeEach(() => { setCurrentTestCtx(); });
afterEach(async () => { await flushCurrentTestCtx(); });
```

**用法**（review #4 修订；review v3 #5 调整签名；review v4 #3 修订默认 ctx 行为）：
- **默认调 `workerFetch(env, path, init)` → 拿 `Response`**，后台 `waitUntil` 错误自动被 harness 的 `afterEach` 捕获并抛出（不会静默）：
  ```ts
  const res = await workerFetch(env, "/api/v1/auth/login", { method: "POST", body: ... });
  expect(res.status).toBe(401);
  // afterEach 会自动 flush 当前测试期间的 ctx；若 tryTrackAuth 失败会在这里抛
  ```
- 若用例要**在测试中**断言后台写（如检查 `tryTrackAuth` 写入的 `user_activity` 行），用 `workerFetchWithCtx` 拿到 ctx 自己 flush，**比 afterEach 早一步**：
  ```ts
  const { res, ctx } = await workerFetchWithCtx(env, "/api/v1/me", { headers: { Authorization: `Bearer ${jwt}` } });
  expect(res.status).toBe(200);
  await ctx.flush();   // 等待 tryTrackAuth；任何后台错误会在此抛出
  // 现在断言 user_activity 行已写入
  ```
- **harness 未启用 ctx 时**（极少数 utility-level 测试）：`workerFetch` 自己 create + 立即 flush。慢一点点但绝不静默。
- `ctx.flush()` 内部用"始终 resolve 的 Settled" + 抛第一个 rejection，让"后台静默失败"变可见，且永不触发 unhandled-rejection 警告。

- 每个测试文件 `beforeEach` 起一个新 `:memory:` DB，**完全隔离**。
- 不需要 `seed-test-db.sql`，每个用例显式 `INSERT` 自己需要的行（surety 模式）；如有大量公用 fixtures，提供 `seedBaseUsers(env)`、`seedForum114(env)` 等 helper。

### 2.4 L2-http 保留场景

只保留这些必须真 HTTP 的用例：
- CORS preflight、`Access-Control-*` header
- `X-Real-IP` / `X-Ellie-Client-IP` 改写链（参考 [feedback_cloudflare-header-overwrite.md](../.claude/projects/-Users-nocoo-workspace-personal-ellie/memory/feedback_cloudflare-header-overwrite.md)）
- cookie 路径 / SameSite
- streaming / Content-Length 边界
- `validateApiKey` middleware 的整链（虽然 fast 也能跑，但保留一份 http 版作 tripwire）
- D1 binding 的真 `prepare/all/run` 行为（fast 用的 D1 shim 是子集）

预估 L2-http 用例数 < 30（当前 ~352 用例的 1/10 左右）。

### 2.5 L3 本地化

`scripts/run-l3.ts` 改造（review #2 修订 — 必须复刻 L2 的 cleanup → migrate → seed → start，否则 fixture 全空 → 大面积 500/404）：

执行顺序（在 `validateAndOverride()` 之前）：
1. **cleanup**：`rmSync(.wrangler/state/e2e-l3, { recursive: true, force: true })`，独立于 L2 的 `.wrangler/state/e2e`，避免本机并跑 L2/L3 互踩，也避免本地 L3 状态累积。
2. **migrations apply (local)**：`wrangler d1 migrations apply DB --local --persist-to .wrangler/state/e2e-l3 -c apps/worker/wrangler.toml`。
3. **seed**：`wrangler d1 execute DB --local --persist-to .wrangler/state/e2e-l3 -c apps/worker/wrangler.toml --file scripts/seed-test-db.sql`（保留种子文件，因为 L3 fixture 依赖 forum 1/2/114、users {1,2,3,100,64495}、threads 662174-662198）。
4. **start local worker**：`startLocalWorker(persistTo, port, env)` — 沿用 `run-l2.ts:136-170` 的 `wrangler dev --local --persist-to <dir> --port <port>`，**`--var` 注入清单必须完整**（review v4 #1 修订；现状漏注入是 bug）：
   - `API_KEY:test-api-key`
   - `ADMIN_API_KEY:test-admin-api-key`
   - `JWT_SECRET:test-secret-key-for-jwt-hs256`
   - **`ENVIRONMENT:test`**（覆盖主 `wrangler.toml [vars] ENVIRONMENT="production"`，让 `/api/live` 返回 `environment:"test"`、让 `checkMaintenance` 等读 `env.ENVIRONMENT` 的逻辑走测试分支、让 `_test_marker` 写入与 worker env 语义一致 — D1 隔离三层校验的"层 2"由此成立）
   - **`ALLOWED_ORIGINS:*`**（覆盖主段的生产域名 `https://ellie.worker.hexly.ai`，让 L2 用 `fetch http://localhost:17031` / L3 用 `http://localhost:27031` 的请求通过 CORS）
   - `DOVE_WEBHOOK_TOKEN:test-token-not-real`（防止 dove 集成误触发；现有 mock 会拦，但 var 也设上保险）
5. **start Next.js dev**（保持 27031），通过 `WORKER_API_URL=http://localhost:<worker-port>` 注入。
6. **prewarm + Playwright**（保持现状）。

**实现策略**：把 cleanup/initDatabase/seedDatabase **以及 startLocalWorker** 提到 `scripts/lib/local-d1.ts` + `scripts/lib/local-worker.ts`，参数化 `persistTo` / `port` / `extraVars`，让 `run-l2.ts`、`run-l3.ts`、`run-l3-admin.ts` 共享同一份 `--var` 清单（review v4 #1：防止 ENVIRONMENT/ALLOWED_ORIGINS 漏注入再次发生）：

```ts
// scripts/lib/local-d1.ts
export interface LocalD1Options {
  persistTo: string;                 // ".wrangler/state/e2e" | ".wrangler/state/e2e-l3" | ...
  wranglerConfig: string;            // "apps/worker/wrangler.toml"
  wranglerBin: string;
  seedFile?: string;                 // 不传则跳过 seed
  timeoutMs?: number;
}
export async function initLocalD1(opts: LocalD1Options): Promise<void>;  // cleanup + migrate + seed

// scripts/lib/local-worker.ts
export const TEST_WORKER_VARS = {
  API_KEY: "test-api-key",
  ADMIN_API_KEY: "test-admin-api-key",
  JWT_SECRET: "test-secret-key-for-jwt-hs256",
  ENVIRONMENT: "test",                                  // ← 不能漏
  ALLOWED_ORIGINS: "*",                                 // ← 不能漏
  DOVE_WEBHOOK_TOKEN: "test-token-not-real",
} as const;

export interface LocalWorkerOptions {
  persistTo: string;
  port: number;
  wranglerConfig: string;
  wranglerBin: string;
  extraVars?: Record<string, string>;                   // L3-admin 等可补充
}
export async function startLocalWorker(opts: LocalWorkerOptions): Promise<Subprocess>;
```

`startLocalWorker` 内部把 `TEST_WORKER_VARS` 展开成 `--var K:V` flag 数组传给 wrangler。L2/L3/L3-admin 三个 runner 共用，**只能加 vars 不能漏 vars**。

**端口 / 持久化目录约定**（对齐 nmem 端口总表，万位档区分环境，详 §2.6）：

| 环境 | persist-to | worker port | web port |
|---|---|---|---|
| L2 | `.wrangler/state/e2e` | 17031（首选）→ OS 分配 | n/a |
| L3 forum | `.wrangler/state/e2e-l3` | 37031（首选）→ OS 分配 | 27031 |
| L3 admin | `.wrangler/state/e2e-l3-admin` | 37032（首选）→ OS 分配 | 27032 |

**`WORKER_API_URL` / `WORKER_URL_TEST` 解耦**：
- `WORKER_API_URL` 默认 = `http://127.0.0.1:<auto-port>`（本地 worker 启动后注入）。
- CI secret `WORKER_URL_TEST` 改为可选；若设置且不空则不启本地 worker、直接打远端（保留作为冒烟兜底，长期可下线）。
- `validateAndOverride()` 的 `-test` 子串校验改为：URL 是 `127.0.0.1` / `localhost` 任一端口 **或** 包含 `-test` 子串才放行；防止误打 prod。

`scripts/run-l3-admin.ts` 同型改造，使用独立 `.wrangler/state/e2e-l3-admin` persist 目录，避免与 forum L3 互踩。

**`verify-test-db.ts` 重写**（review v3 #1 修订）：脱网，但**不校验主段 `database_name`**——因为本地 L2 直接复用主段 `[[d1_databases]] tongjinet-db` binding（生产名），仅由 `wrangler dev --local --persist-to` 隔离到 SQLite 文件，校验主段名 ≠ 生产名会与"复用 binding"互相冲突。改为查 marker：

1. **D1 隔离的真正语义**：worker 的 `ENVIRONMENT="test"` var 已通过 `--var ENVIRONMENT:test` 注入（`run-l2.ts` 启动时；L3 同型）；persist 目录在 `.wrangler/state/e2e*/`，物理与生产隔离；`_test_marker(env='test')` 是 D1 内的运行时标记。
2. **首选路径**：用 wrangler 自身查（API 稳定，免猜文件结构）：
   ```bash
   bun x wrangler d1 execute DB --local \
     --persist-to .wrangler/state/e2e \
     -c apps/worker/wrangler.toml \
     --command "SELECT value FROM _test_marker WHERE key='env'" \
     --json
   ```
   解析 stdout JSON 拿 `value`，等于 `"test"` 才放行。
3. **降级路径（仅当 wrangler 不可用）**：用 glob `find .wrangler/state/e2e -name '*.sqlite' -not -name 'metadata.sqlite'` 找 D1 SQLite 文件（路径可能是 `…/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite`，wrangler 版本不同形态会变，所以**不写死路径**），bun:sqlite 打开后查同样的 marker。
4. 失败信息引导用户跑 `bun run test:l2`（会自动 migrate + seed，从而创建 marker）。
5. L2 / L3 / L3-admin 的 persist 目录通过 `--persist-to` 参数传入，校验脚本接受 `--persist-to <dir>` flag，默认 `.wrangler/state/e2e`。

### 2.6 端口自动分配

按 nmem 端口约定，**项目主端口为基准（Ellie 主端口 = 7031）**，按万位档递增分配 dev / L2 / L3 等不同环境（参见 [docs/e2e-test-design.md](./e2e-test-design.md) §"Port Convention"）：`N0001 + N×10000`。Ellie 各维度对齐如下：

| 万位档 | 环境 | forum web | admin web | worker | persist-to |
|---|---|---|---|---|---|
| 0 | dev | 7031 | 7032 | 8787（历史值，本期不动） | — |
| 1 | **L2** | n/a | n/a | **17031** | `.wrangler/state/e2e` |
| 2 | **L3 web** | **27031** | **27032** | — | — |
| 3 | **L3 worker** | — | — | **37031**（forum）/ **37032**（admin） | `.wrangler/state/e2e-l3` / `.wrangler/state/e2e-l3-admin` |

> **设计要点**：
> - **万位档区分环境**（dev / L2 / L3 / L3-worker），**尾数与项目主端口对齐**（`*7031` 是 forum，`*7032` 是 admin）。
> - **L2 万位档 1（17xxx）由 worker 独占**：L2 没有 web 层，整个万位档让出给 worker，端口直接 = `17031`（项目主端口 + 10000）。
> - **L3 web 占万位档 2，L3 worker 占万位档 3**：L3 同时跑 web + worker，需要两档分离。万位档 3 对齐"L3 系列的第二组"，比"在档 2 内 +1000 / +100"更清晰、不会与 web 端口混淆。
> - **worker dev 保持 8787**：wrangler 默认值，代码里有引用（如 `apps/worker/wrangler.toml`、调试文档）；本期不改 dev port，避免无关变更，仅约束 L2/L3 端口对齐总表。

新增 `scripts/lib/find-port.ts`，按"主端口 → fallback OS"两级探测，**主端口被占时 fail-fast 到匿名端口**（不偏离万位档）：

```ts
export async function findOpenPort(prefer: number[]): Promise<number> {
  for (const p of prefer) {
    if (await isFree(p)) return p;
  }
  // fallback: 让 OS 分一个匿名端口（极端情况，比如 17031 也被占）
  const sock = await Bun.listen({ hostname: "127.0.0.1", port: 0, ... });
  const port = sock.port; sock.stop();
  return port;
}
```

调用约定（主路径严格对齐 nmem 万位档；被占只 fallback 到匿名端口而非其他档）：

```ts
// scripts/run-l2.ts
const TEST_PORT = await findOpenPort([17031, 0]);          // L2 worker：万位档 1

// scripts/run-l3.ts
const WORKER_PORT = await findOpenPort([37031, 0]);        // L3 forum worker：万位档 3
const NEXT_PORT = 27031;                                    // L3 forum web：万位档 2（被占直接 fail-fast）

// scripts/run-l3-admin.ts
const WORKER_PORT = await findOpenPort([37032, 0]);        // L3 admin worker：万位档 3
const ADMIN_NEXT_PORT = 27032;                              // L3 admin web：万位档 2
```

`tests/integration/setup.ts` 改成读 `process.env.L2_PORT ?? "17031"`（默认值从 `8787` 改为 `17031`），由 `runTests()` 注入 `L2_PORT=${TEST_PORT}`。helper 把 `17031` 作为默认 fallback，让纯 helper 调用（无 runner）也对齐总表。

---

## 3. 关键技术细节

### 3.1 D1 binding shim（bun:sqlite → D1Database）

bun:sqlite 的接口 ≠ D1，需要适配层。**review #3 修订**：原版 `batch()` 一律调 `.run()`，但 worker 中 `apps/worker/src/handlers/admin/stats.ts:19,29` 和 `apps/worker/src/handlers/admin/todayVisits.ts:151` 都把 `batch()` 用作并行 SELECT 并读 `results[i].results[0]`，需要 shim 区分语句类型。最小子集：

```ts
// apps/worker/src/test-support/d1-shim.ts
import type { Database, Statement } from "bun:sqlite";
import type { D1Database, D1PreparedStatement, D1Result } from "@cloudflare/workers-types";

// SELECT (含 WITH … SELECT, RETURNING) 走 .all()，其余 .run()
function isReadStatement(sql: string): boolean {
  const trimmed = sql.trim().toUpperCase();
  return /^(SELECT|WITH|EXPLAIN)\b/.test(trimmed) || /\bRETURNING\b/.test(trimmed);
}

export function wrapAsD1(sqlite: Database): D1Database {
  const prepare = (sql: string): D1PreparedStatement => {
    let bound: unknown[] = [];
    const isRead = isReadStatement(sql);
    const stmt: D1PreparedStatement & { __sql: string; __isRead: boolean } = {
      __sql: sql,
      __isRead: isRead,
      bind: (...args) => { bound = args; return stmt; },
      first: async <T>(col?: string) => {
        const row = sqlite.prepare(sql).get(...bound) as T | undefined;
        if (row == null) return null;
        if (col) return (row as Record<string, unknown>)[col] as T;
        return row;
      },
      all: async <T>() => {
        const results = sqlite.prepare(sql).all(...bound) as T[];
        return {
          success: true,
          meta: { changes: 0, last_row_id: 0, duration: 0 } as never,
          results,
        };
      },
      run: async () => {
        const r = sqlite.prepare(sql).run(...bound);
        return {
          success: true,
          results: [],
          meta: {
            changes: r.changes,
            last_row_id: Number(r.lastInsertRowid),
            duration: 0,
          },
        } as D1Result;
      },
      raw: async () => sqlite.prepare(sql).values(...bound),
    } as D1PreparedStatement & { __sql: string; __isRead: boolean };
    return stmt;
  };

  return {
    prepare,
    // batch() — 区分读/写：SELECT 走 .all() 返回 { results: rows[] }，
    // 写入走 .run() 返回 { meta: { changes, last_row_id } }。
    // 与 D1 真实行为一致：results 始终存在，写语句的 results 为空数组。
    batch: async (statements) => {
      const results: D1Result[] = [];
      for (const s of statements as (D1PreparedStatement & { __sql?: string; __isRead?: boolean })[]) {
        // 优先看 __isRead 标记；若调用方把外部 statement 传进来（不太可能），
        // 用 __sql 兜底再 fallback to .run()。
        if (s.__isRead === true) {
          results.push((await s.all()) as D1Result);
        } else if (s.__isRead === false) {
          results.push(await s.run());
        } else if (s.__sql && isReadStatement(s.__sql)) {
          results.push((await s.all()) as D1Result);
        } else {
          results.push(await s.run());
        }
      }
      return results;
    },
    exec: async (sql) => { sqlite.exec(sql); return { count: 0, duration: 0 }; },
    dump: async () => { throw new Error("dump() not supported in shim"); },
    withSession: undefined,  // not implemented; 真要测 session 用 L2-http
  } as D1Database;
}
```

**已知差异**：
- D1 `meta.size_after`、`meta.rows_read/written` 不模拟（handler 不应依赖）。
- `withSession` 不实现 → 任何用 read-replication API 的 handler 必须走 L2-http。
- bun:sqlite 是同步的，shim 包成 async。性能开销可忽略（`:memory:` 单查询 < 50µs）。
- `isReadStatement` 用前缀正则识别，覆盖 `SELECT` / `WITH` / `EXPLAIN` / 任意位置的 `RETURNING`。**未覆盖**：以注释开头的 SQL（如 `/* hint */ SELECT …`）— Ellie 当前 worker 代码无此风格，新增 handler 用注释前缀 SQL 时需先在 §10 验收里加测试。
- `batch()` 行为对齐：D1 真实 batch 的 `results[i]` 总有 `results` 字段（写入是 `[]`、读取是 rows）；shim 完全一致。

**配套测试**：`tests/unit/d1-shim.test.ts` 覆盖：
- `prepare(SELECT).bind().all()/first()` 正确返回行
- `prepare(INSERT/UPDATE/DELETE).run()` 返回正确 `meta.changes / last_row_id`
- `batch([SELECT, SELECT, INSERT])` 返回 `[{ results: [...] }, { results: [...] }, { results: [], meta }]` 形态
- 直接拿 `apps/worker/src/handlers/admin/stats.ts` 的 9 条 batch 跑通（in-process）

### 3.2 Mock KV / R2 复用

`apps/worker/tests/helpers.ts:createMockKV` (lines 17-66) 和 `createMockR2` (lines 352-407) 已经是 in-memory Map 实现，直接复用 — **新增**：把它们从 `tests/helpers.ts` 提到 `apps/worker/src/test-support/mocks.ts`，让 L1 和 L2-fast 共享。`tests/helpers.ts` 改成 re-export，零回归。

### 3.3 Migration 拼装规则

`scripts/build-init-sql.ts`：
1. `readdir apps/worker/migrations/`，按文件名排序。
2. 对每个 `.sql` 文件做正则改写：
   - `CREATE TABLE\s+(?!IF NOT EXISTS)` → `CREATE TABLE IF NOT EXISTS `
   - `CREATE INDEX\s+(?!IF NOT EXISTS)` → `CREATE INDEX IF NOT EXISTS `
   - `CREATE UNIQUE INDEX\s+(?!IF NOT EXISTS)` → `CREATE UNIQUE INDEX IF NOT EXISTS `
   - `INSERT INTO` → `INSERT OR IGNORE INTO`（让 seed 行可重入）
3. 拼到一个大 string，写入 `apps/worker/src/test-support/init-sql.generated.ts`：
   ```ts
   /* AUTO-GENERATED by scripts/build-init-sql.ts. DO NOT EDIT. */
   export const INIT_SQL = `…`;
   export const INIT_SQL_HASH = "<sha256>";
   ```
4. **校验测试**（`tests/unit/init-sql-equiv.test.ts`，review #5 修订）：原版写 `wrangler d1 execute :memory:` 不可行（wrangler 必须有已配置的 binding 名 + `--local --persist-to`）。改用临时 persist 目录方案：
   - 测试启动时 `mkdtempSync` 一个临时目录，作为 wrangler 的 `--persist-to`。
   - `bun x wrangler d1 migrations apply DB --local --persist-to <tmp> -c apps/worker/wrangler.toml` 让 wrangler 物理化建库。
   - 通过 wrangler 查 schema：`bun x wrangler d1 execute DB --local --persist-to <tmp> -c apps/worker/wrangler.toml --command "SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name" --json`，规范化 sql（去注释/统一空白/小写关键词）后取 sha256。
   - bun:sqlite 路径：`new Database(":memory:"); db.exec(INIT_SQL); db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();` 同样规范化 + sha256。
   - 两个 hash 不等则 fail，并打印 diff（type/name 级别）。
   - 测试加 `[skip-if-ci-no-wrangler]` 守卫：找不到 `apps/worker/node_modules/.bin/wrangler` 时跳过（极少数情况；CI 一定有）。

> 风险：migration 里若有 `ALTER TABLE` 形式的列加减、`DROP TABLE` 序列，简单拼接会报错。**已扫描**：现有 migrations 中含 `ALTER TABLE` 的有几条（如 `0030_user_tombstone.sql` 加 `purged_at/purged_by` 列），需要按拼接顺序保留 — 因为 `IF NOT EXISTS` 拦不住 `ALTER`。这种情况 build 脚本要识别"前面已 CREATE 过此表的列"并合并到首个 CREATE 内（保守策略：build 脚本先 dry-run 一次 → 报错则手动给那批 migration 标 `--no-init-sql` 跳过 + 落库后再 ALTER；实际需手工标的数量在生成时确定）。详见 §6.1 子任务。

### 3.4 L2-fast 测试样例

```ts
// tests/integration/fast/auth-login.fast.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import { createTestEnv, workerFetch, setCurrentTestCtx, flushCurrentTestCtx } from "./_helpers/env";
import { seedUserActive } from "./_helpers/fixtures";

let env: ReturnType<typeof createTestEnv>;
beforeEach(() => { env = createTestEnv(); setCurrentTestCtx(); });
afterEach(async () => { await flushCurrentTestCtx(); });

test("POST /api/v1/auth/login → 401 for wrong password", async () => {
  await seedUserActive(env, { id: 1, email: "alice@test.com", password: "correct" });
  const res = await workerFetch(env, "/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": env.API_KEY },
    body: JSON.stringify({ email: "alice@test.com", password: "wrong" }),
  });
  expect(res.status).toBe(401);
});
```

### 3.5 端口自适应（覆盖 17031 撞车场景）

`scripts/run-l2.ts:30` 把 `TEST_PORT = 8787` 改为对齐 nmem 端口万位档（详 §2.6）：

```ts
import { findOpenPort } from "./lib/find-port";
const TEST_PORT = await findOpenPort([17031, 0]);   // 万位档 1：L2 worker 独占
console.log(`L2 chose port ${TEST_PORT}`);
```

`tests/integration/setup.ts` 默认值同步从 `8787` 改为 `17031`（详 §2.6）。

---

## 4. 删除 / 替换清单

### 4.1 文件级删除

| 文件 | 操作 | 说明 |
|---|---|---|
| `apps/worker/wrangler.toml` `[env.test]` 全段（lines 47-77） | 删除 | import 工具链改为环境变量传入或独立 `wrangler.import.toml`（§7 决策点） |
| `package.json` `worker:migrate:test` script | 删除 | |
| `package.json` `worker:deploy:test` script | 删除 | |
| `scripts/verify-test-db.ts:75-92`（远端 D1 查询段） | 改写 | 首选 `wrangler d1 execute DB --local --persist-to <dir> --command "SELECT value FROM _test_marker WHERE key='env'" --json` 查 marker；降级用 glob 找 `*.sqlite`（不写死路径，详 §2.5） |

### 4.2 文件级改写

| 文件 | 改动概要 |
|---|---|
| `scripts/run-l2.ts` | 端口自适应；不变其他逻辑 |
| `scripts/run-l3.ts` | 增加本地 worker 子进程；`WORKER_API_URL` 默认 local；端口自适应 |
| `scripts/run-l3-admin.ts` | 同上 |
| `apps/worker/tests/helpers.ts` | mock helpers 提到 `src/test-support/mocks.ts`；本文件 re-export |
| `tests/integration/setup.ts` | 读 `L2_PORT` env；提供 `L2_MODE=fast|http` 分支（兼容现有用例直接迁入 `http/`） |
| `tests/integration/preload.ts` | 不变 |

### 4.3 新增文件

| 文件 | 说明 |
|---|---|
| `apps/worker/src/test-support/init-sql.generated.ts` | 自动生成，**提交进 git**（详 §2.2.1，review v3 #4 修订） |
| `apps/worker/src/test-support/d1-shim.ts` | bun:sqlite → D1 适配层（§3.1） |
| `apps/worker/src/test-support/mocks.ts` | KV / R2 mock（从 tests/helpers.ts 迁入） |
| `scripts/build-init-sql.ts` | INIT_SQL 生成脚本 |
| `scripts/lib/find-port.ts` | 通用端口探测 |
| `scripts/lib/local-d1.ts` | 本地 D1 cleanup + migrations apply + seed 共享 helper（review #2 新增） |
| `scripts/lib/local-worker.ts` | 本地 worker 启动共享 helper，含完整 `TEST_WORKER_VARS`（含 `ENVIRONMENT:test` / `ALLOWED_ORIGINS:*`，review v4 #1 新增） |
| `tests/integration/fast/_helpers/env.ts` | L2-fast 入口（createTestEnv / workerFetch / createTestCtx / setCurrentTestCtx / flushCurrentTestCtx） |
| `tests/integration/fast/_helpers/setup.ts` | 通用 harness（`beforeEach(setCurrentTestCtx)` + `afterEach(flushCurrentTestCtx)`），所有 `*.fast.test.ts` 共用 |
| `tests/integration/fast/_helpers/fixtures.ts` | seedBaseUsers/seedForum114 等 |
| `tests/integration/fast/**/*.fast.test.ts` | L2-fast 用例（首批从现有 `tests/integration/worker/auth.test.ts` 迁出最简 4xx 路径） |
| `tests/integration/http/**/*.http.test.ts` | L2-http 用例（从现有 `tests/integration/worker/*.test.ts` 全量迁入并保留） |
| `tests/unit/init-sql-equiv.test.ts` | INIT_SQL 与 wrangler migrations 等价校验 |
| `scripts/run-verify-test-db-local.ts` | 本地 marker 校验入口（首选 `wrangler d1 execute --local --json`，降级 glob + bun:sqlite；替换 verify-test-db.ts 的远端段，详 §2.5） |

### 4.4 CI workflow 改写

`.github/workflows/ci.yml` `browser-e2e` job：

```diff
-      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
-      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
-      D1_TEST_DATABASE_ID: ${{ secrets.D1_TEST_DATABASE_ID }}
-      WORKER_URL_TEST: ${{ secrets.WORKER_URL_TEST }}
-      WORKER_API_URL: ${{ secrets.WORKER_URL_TEST }}
+      # No CF secrets — fully local stack
       API_KEY: test-api-key
       FORUM_API_KEY: test-api-key
       JWT_SECRET: test-secret-key-for-jwt-hs256
       AUTH_SECRET: ${{ secrets.AUTH_SECRET }}  # 仍保留：NextAuth JWT 签名
       NEXT_PUBLIC_CAP_API_ENDPOINT: ${{ secrets.NEXT_PUBLIC_CAP_API_ENDPOINT }}  # 仍保留：CAPTCHA 真实 widget
       …
-      - name: "Apply D1 migrations to test DB"
-        run: bun x wrangler d1 migrations apply DB --env test --remote -c apps/worker/wrangler.toml
-      - name: "Deploy ellie-test worker (best-effort; …)"
-        if: env.CLOUDFLARE_API_TOKEN != '' && env.CLOUDFLARE_ACCOUNT_ID != ''
-        continue-on-error: true
-        run: bun x wrangler deploy --env test -c apps/worker/wrangler.toml
-      - name: "Seed test D1 …"
-        run: bun x wrangler d1 execute tongjinet-db-test --remote -c apps/worker/wrangler.toml --file scripts/seed-test-db.sql
       - name: "L3: Playwright E2E tests"
         run: bun run test:e2e:browser  # 内部启动本地 wrangler
```

---

## 5. 6DQ 质量体系实施

| 维度 | 当前 | 目标 | 验收 |
|---|---|---|---|
| **L1** | 7,343 unit + 119 worker，覆盖率 stmt/line/func ≥ 95% / branch ≥ 90% | 不变；新加 `init-sql-equiv.test.ts` 和 `find-port.test.ts` | `bun run test` 全绿；`coverage.include` 阈值不退步 |
| **L2** | 单层 ~352 用例，~5–10s 启动，134/134 路由覆盖 | L2-fast 90% 用例 + L2-http ~30 用例；总用例数 ≥ 现有，启动开销 < 1s（fast）/ ~5s（http，仅一次） | `bun run test:l2:fast` ≤ 5s；`bun run test:l2:http` ≤ 30s；`bun run test:l2`（= fast + http）≤ 35s；audit 仍 100% |
| **L3** | CI 走远端 worker；本地不可跑（无 CF token） | 100% 本地，CI 同；`run-l3.ts` 启动本地 worker | `bun run test:e2e:browser` 在 CI 不读 CF secret，全绿 |
| **G1** | typecheck + biome | 不变 | 不变 |
| **G2a** secrets | gitleaks | 不变 | 不变 |
| **G2b** OSV | bun.lock + Cargo.lock | 不变；本期不修当前 `esbuild 0.25.12` 高危（独立任务） | `osv-scanner scan --lockfile bun.lock` 不退步 |
| **D1 隔离** | 三层（binding / env / `_test_marker`），需远端 D1 | 三层（binding / env / `_test_marker`），全部本地：binding = `[[d1_databases]]` 主段（local-only mode）；env = `ENVIRONMENT="test"`（通过 `--var` 注入 worker）；marker = 首选 `wrangler d1 execute --local --persist-to --json` 查 `_test_marker`，降级 glob + bun:sqlite（详 §2.5） | `bun run verify:test-db` 脱网通过；CI 无 CF token 也能跑 L2/L3 |

新增维度专项：
- **覆盖率两轴**：`scripts/audit-l2-coverage.ts` 扩展为同时扫描 `tests/integration/fast/` + `tests/integration/http/`，输出两套矩阵到 `docs/18-l2-coverage-matrix.md`，要求每个 (route × method) 至少在 `fast` 或 `http` 中之一被覆盖。
- **稳定性**：L2-fast 启动 0 子进程，端口冲突场景为 0；L2-http 端口自适应；CI 不再因 CF token scope 问题退化为 stale worker。

---

## 6. 实施计划（原子化 commit chain）

### Phase A — 基础设施（可独立 review，不改任何测试）

| # | Commit | 内容 |
|---|---|---|
| A1 | `chore(scripts): add findOpenPort helper` | 新增 `scripts/lib/find-port.ts` + `tests/unit/find-port.test.ts` |
| A2 | `feat(test-support): extract mock KV/R2 to src/test-support/mocks.ts` | 迁移 + tests/helpers.ts re-export，零行为变化 |
| A3 | `feat(test-support): generate INIT_SQL from migrations + commit artifact` | 新增 `scripts/build-init-sql.ts`（支持 `--check`）、`apps/worker/src/test-support/init-sql.generated.ts` **commit 进 git**；`package.json` 新增 `prepare:test-sql` script；`scripts/typecheck.sh` 顶部加 `bun run prepare:test-sql --check`（保留既有 route types 检查与 `tsc --build` 流程，详 §2.2.1）；先不接到任何测试 |
| A4 | `feat(test-support): bun:sqlite → D1 shim with read/write batch dispatch` | 新增 `d1-shim.ts`（含 `isReadStatement`）+ 单测 `tests/unit/d1-shim.test.ts`，覆盖 stats.ts/todayVisits.ts 真实 batch 形态 |
| A5 | `test: init-sql equiv with wrangler migrations (tmpdir persist-to)` | `tests/unit/init-sql-equiv.test.ts`：mkdtempSync → wrangler migrations apply --local --persist-to → schema hash 对比 |
| A6 | `feat(scripts): factor cleanup/migrate/seed + worker boot into scripts/lib/` | 从 `run-l2.ts` 提取 `initLocalD1(opts)` → `scripts/lib/local-d1.ts`、`startLocalWorker(opts)` → `scripts/lib/local-worker.ts`（含完整 `TEST_WORKER_VARS`：API_KEY/ADMIN_API_KEY/JWT_SECRET/**ENVIRONMENT:test**/**ALLOWED_ORIGINS:***/DOVE_WEBHOOK_TOKEN）；`run-l2.ts` 改用 helper（**行为变化**：补全 ENVIRONMENT/ALLOWED_ORIGINS 注入，修复现有 bug，详 §2.5 review v4 #1） |

### Phase B — L2-fast 落地（递增覆盖）

| # | Commit | 内容 |
|---|---|---|
| B1 | `feat(l2-fast): add tests/integration/fast/_helpers + first auth specs` | env.ts（含 `createTestCtx`/`setCurrentTestCtx`/`flushCurrentTestCtx` + `workerFetch`/`workerFetchWithCtx`，详 §2.3 review v4 #3）、setup.ts（`beforeEach`/`afterEach` harness）、fixtures.ts、3-5 个最简 fast 用例（auth login 401/400 等） |
| B2 | `chore(scripts): add bun run test:l2:fast` | package.json + run-l2-fast.ts（不需要 wrangler 子进程） |
| B3..Bn | `test(l2-fast): port <module>` × N | 按模块迁移 — auth, public, user-content, messaging, post-rating, moderation, admin, analytics, kv-monitor, ip-lookup, thread-types。每个独立 commit，便于回退 |

> 迁移策略：新写一份 `*.fast.test.ts`，旧的 `tests/integration/worker/*.test.ts` 暂留；最后一次性 `mv` 到 `tests/integration/http/`。

### Phase C — L2-http 隔离 + 端口自适应

| # | Commit | 内容 |
|---|---|---|
| C1 | `refactor(l2): split tests/integration/{worker → http}/, keep behavior` | mv + path 调整；`run-l2.ts` 改为只扫 `tests/integration/http/` |
| C2 | `feat(l2): auto-pick worker port via findOpenPort` | run-l2.ts 端口自适应 |
| C3 | `chore(audit): cover both fast + http in audit-l2-coverage` | 扩展审计脚本，更新 docs/18-l2-coverage-matrix.md |

### Phase D — L3 本地化

| # | Commit | 内容 |
|---|---|---|
| D1 | `feat(l3): boot local wrangler + DB init/seed from run-l3.ts` | run-l3.ts 在 `validateAndOverride()` 之前调 `initLocalD1({ persistTo: ".wrangler/state/e2e-l3", seedFile: "scripts/seed-test-db.sql" })`，再 `startLocalWorker({ persistTo, port: 37031, … })`（用 §A6 提取的 helper，自动获得 ENVIRONMENT/ALLOWED_ORIGINS 注入）；`WORKER_API_URL` 默认本地端口；端口自适应 |
| D2 | `feat(l3-admin): same local wrangler boot with isolated persist dir` | run-l3-admin.ts 同型改造，使用 `.wrangler/state/e2e-l3-admin` + port 37032；同样走 `startLocalWorker()` helper |
| D3 | `refactor(verify-test-db): local marker check via wrangler execute (fallback glob)` | scripts/verify-test-db.ts 重写：首选 `wrangler d1 execute DB --local --persist-to <dir> --json` 查 `_test_marker`；降级用 glob 找 `*.sqlite` + bun:sqlite 查（不写死 miniflare 路径，详 §2.5） |
| D4 | `ci: drop CF secrets from browser-e2e job` | .github/workflows/ci.yml 删 4 个 secret + 3 个 wrangler step，保留 `AUTH_SECRET` / `NEXT_PUBLIC_CAP_API_ENDPOINT` |

### Phase E — 清理 + 文档

| # | Commit | 内容 |
|---|---|---|
| E1 | `chore(wrangler): drop [env.test] section` | 取决于 §7 决策：要么直接删，要么迁到 `wrangler.import.toml` |
| E2 | `chore(scripts): remove worker:migrate:test / worker:deploy:test` | package.json |
| E3 | `docs: update CLAUDE.md / 01 / 06 / 04b / 17 / 14a / 10` | 改写所有文档对 `tongjinet-db-test` / `ellie-test` 的引用 |
| E4 | `docs: 23 retrospective + close out` | 本文档加结尾"实施回顾"段，把 §6 的实际 commit hash 钉上 |

### Phase F — CF 资源最终下线（哥手动操作，非代码改动）

观察 1 个月（4 个绿色 PR + 1 次手动 deploy 验证）后：
- 在 CF 控制台删除 D1 `tongjinet-db-test`
- 删除 Worker `ellie-test`（含其 routes / KV preview 绑定）
- 删除 R2 桶 `tongjinet-test`（如有内容先备份）

---

## 7. 待哥决策的开放问题

### 7.1 `scripts/import/*.ts` 的 dry-run DB 怎么处理？

`scripts/import/dry-run.ts:26`、`d1-importer.ts:14` 把 `tongjinet-db-test` 当作生产 import 的影子库（dry-run 跑完看错误，再 push 到 prod）。这与"测试"语义无关，但确实占用 `[env.test]` 段。

**选项 A**：保留 `[env.test]` 段，仅供 import 工具链使用，但**改名**为 `[env.import-shadow]`，并把 `tongjinet-db-test` 改名为 `ellie-import-shadow`，避免概念污染。
**选项 B**：把 import 工具链的 wrangler 配置迁到独立 `apps/worker/wrangler.import.toml`，主 `wrangler.toml` 只保留生产段。
**选项 C（推荐）**：保持 `tongjinet-db-test` 物理存在，但在主 `wrangler.toml` 中删除 `[env.test]` 段；import 工具链改为通过 CLI 参数 `--database-id <uuid>` + `--remote` 直接传 dry-run DB 的 ID，不依赖 wrangler 配置段。

### 7.2 L3 在 CI 用 `next dev` 还是 `next build && next start`？

当前 `scripts/run-l3.ts:129` 用 `bun run dev`（即 `next dev`），有 prewarm 但仍受 Turbopack 影响。surety 在 CI 走 `next build`+静态服务，启动确定但失去热路径覆盖。

**选项 A（保持现状）**：CI 仍 `next dev` + prewarm，接受 ~30s 冷启动。
**选项 B（推荐）**：CI 切到 `next build && next start`，本地仍 `next dev`。需要 `WORKER_API_URL` 在 build 时（SSR 静态化）和 runtime 都正确（Next.js env 双相规则）。

### 7.3 `tongjinet-db-test` 是否有手工种子数据需备份？

`scripts/seed-test-db.sql` 是公开的种子。如果哥曾在 CF 控制台或通过 `wrangler d1 execute --remote` 给 `tongjinet-db-test` 加过**未在 seed 文件里的**手工数据，需要在 Phase F 前导出一份。

```bash
# 备份命令（哥决策后执行）
bun x wrangler d1 execute tongjinet-db-test --remote --command \
  "SELECT * FROM <每张表>" --json > backup-<table>.json
```

### 7.4 KV 测试隔离层

当前 `[env.test.kv_namespaces].id = 490227e961…` 与 prod `preview_id` 同 ID。换言之 prod 的 KV preview 和"test"用同一个 namespace。如果哥之前仅本地用过这个 ID，影响为零；如果在 prod 部署里激活过 KV preview 路径，本期改造会让这个 namespace 不再有人写。**待确认**：是否要在 CF 控制台删除这个 KV namespace。

---

## 8. 风险与回滚

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| INIT_SQL 与 migration 序列产物不等价（§3.3） | 中 | L2-fast 与 L2-http 跑出不同结果 | `init-sql-equiv.test.ts` 强校验；CI 双路径都跑 |
| D1 shim 漏实现 API（如 `withSession`） | 中 | handler 在 fast 跑过 http 跑挂 | 把这类 handler 显式标 `@l2-http-only` 注释，audit 脚本检查 |
| `wrangler dev --local` 启动稳定性 | 低 | L2-http 用例 flaky | run-l2.ts 已有 3 次重试 + worker 健康检测；端口自适应进一步降低撞车 |
| L3 本地 worker 与本地 Next.js 启动竞速 | 低 | L3 偶发首测失败 | run-l3.ts 严格串行：worker ready → Next ready → prewarm → playwright |
| Phase E 删除 `[env.test]` 后某处仍 reference | 低 | 部署链路坏 | E1 之前先 `grep -rn "env.test\|tongjinet-db-test\|ellie-test"` 并跟本文档 §0.1 清单对照 |
| 6DQ D1 维度退步 | 低 | 质量基线变化 | §5 表已写明三层维持，仅"远端→本地"变化，更新 `docs/18-quality-baseline.md` 同步声明 |

**回滚策略**：每个 Phase 独立。若 Phase B 后发现 L2-fast 不如预期，可只回退 B 系列 commit，A1-A5 基础设施仍可服务于后续。Phase D 的 CI 改动若让 L3 不稳，可暂时恢复 4 个 CF secret + 3 个 wrangler step（git revert 单 commit）。

---

## 9. 后续（不在本期）

1. **L1 mock 现代化**：把 `apps/worker/tests/helpers.ts:createMockDb`（260+ 行 SQL 子串正则）替换为 `src/test-support/d1-shim.ts` + `:memory:` SQLite。涉及 130 个 L1 文件，工作量大，单独立项。
2. **删除 seed-test-db.sql**：L2-fast 不需要，L2-http 用 fixtures 函数显式构造，L3 用 fast 模式或独立 e2e fixtures。等 L2-fast 全量落地后回过头评估。
3. **`@cloudflare/vitest-pool-workers` 评估**：若官方工具链稳定后，L2-http 可考虑迁移过去，免去 `wrangler dev` 子进程。surety 没用是因为他们的 hono 入口 in-process 已够用，Ellie 后续可再评。
4. **`esbuild 0.25.12` 升级**：今天 G2 扫出的 GHSA-gv7w-rqvm-qjhr (CVSS 8.1)，独立 PR 处理。

---

## 10. 验收标准

### 10.1 代码

- `bun run test` 全绿（L1）
- `bun run test:l2:fast` 全绿，wall-clock < 5s
- `bun run test:l2:http` 全绿，wall-clock < 30s
- `bun run test:l2`（= fast + http）全绿
- `bun run test:e2e:browser` 在**没有任何 CF secret** 的 shell 中能跑通（验证：`unset CLOUDFLARE_*; unset D1_TEST_*; unset WORKER_URL_TEST; bun run test:e2e:browser`）
- `bun run verify:test-db` 在脱网环境中通过
- `bun run typecheck` / `bun run lint` 全绿
- `osv-scanner scan --lockfile bun.lock` 不引入新漏洞
- `gitleaks detect` 无新泄露

### 10.2 覆盖

- L2 路由 × 方法覆盖率 ≥ 100%（`docs/18-l2-coverage-matrix.md` 现状），且每条至少有 fast **或** http 一种覆盖
- L1 coverage thresholds（`docs/18-quality-baseline.md` §2.3）不退步
- CI `browser-e2e` job 不再读取 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `D1_TEST_DATABASE_ID` / `WORKER_URL_TEST`

### 10.3 文档

- `CLAUDE.md` 删除 §"D1 Test Isolation Setup" 中关于远端 `tongjinet-db-test` 的部分（保留本地 D1 隔离说明）
- `docs/18-quality-baseline.md` 更新 L2 章节为 fast/http 双层
- `docs/18-l2-coverage-matrix.md` 重新生成
- 本文档 §6 钉上实际 commit hash chain
- `docs/01-architecture.md` / `docs/06-cli-design.md` / `docs/04b-frontend-architecture.md` / `docs/03-data-migration.md` / `docs/10-admin-console.md` / `docs/14a-audit-logs.md` / `docs/17-email-verification.md` 中所有 `tongjinet-db-test` / `ellie-test` 引用更新或删除

---

## 11. Review 清单（哥过目）

- [ ] §0 现状调查准确？特别是 §0.1 资源表与 §0.3 痛点清单
- [ ] §2.2 INIT_SQL 单一源方案是否接受？或更倾向直接复用 wrangler 的 migration replay 但放进 bun:sqlite（更复杂但无拼装风险）
- [ ] §2.2.1 生成产物 commit 进 git + typecheck 串 `--check` 是否接受？
- [ ] §2.3 `createTestCtx().flush()` 暴露后台 promise 的设计是否够用？
- [ ] §2.5 L3 本地化 cleanup → migrate → seed → start worker 顺序是否完整？是否需要再加 `await ctx.flush()` 类似的 worker readiness 校验？
- [ ] §2.6 端口万位档分配是否符合哥指定的 nmem 总表（项目主端口 7031 → 17031 / 27031 / 37031）？特别是 L3 worker 占独立万位档 3 的取舍
- [ ] §3.1 D1 shim 子集是否覆盖现有 worker 用法？特别是 `withSession`、`raw()`、`batch()` 这些；`isReadStatement` 用前缀正则是否够用？
- [ ] §3.3 INIT_SQL 等价校验改为临时 persist 目录 + wrangler migrations apply 是否接受？
- [ ] §6 commit chain 粒度是否合适？是否有 commit 太大想拆（A6 新增；D1 已合并 init/seed/worker boot 三步）
- [ ] §7.1 import 工具链路径选项 A/B/C 哪个？
- [ ] §7.2 L3 在 CI 用 dev/build 哪个？
- [ ] §7.3 `tongjinet-db-test` 备份范围
- [ ] §7.4 KV namespace 是否一并清理
- [ ] §10 验收标准是否要再加项（如：移除 7 处文档引用、最终下线时机）
- [ ] §13 同步清单是否完整？特别是 §13.1 端口（`run-l3-admin.ts` 改 7032 → 27032 是否破坏 admin 现有 dev 流程）、§13.2 测试资源旧名、§13.3 文档列表是否还有遗漏

---

## 12. 修订记录

### 2026-06-13 Review v1（哥提出 5 点 → 已修订）

| # | 问题 | 修订位置 |
|---|---|---|
| 1 | `init-sql.generated.ts` gitignore + postinstall 与 CI `--ignore-scripts` 冲突 | §2.2.1 改为 commit 进 git + typecheck 串 `--check`；§6 A3 commit 描述更新 |
| 2 | L3 本地化未写 cleanup → migrate → seed → start | §2.5 显式列出 6 步执行顺序；新增 `scripts/lib/local-d1.ts` 共享（§6 A6）；§6 D1 描述更新；§4.3 新增 helper 文件 |
| 3 | D1 shim `batch()` 一律调 `.run()`，与 stats.ts/todayVisits.ts 的批量 SELECT 不兼容 | §3.1 重写 `batch()`，按 `isReadStatement` 分派 `.all()` / `.run()`，单测覆盖真实 handler 形态 |
| 4 | `ExecutionContext.waitUntil` 是空函数，掩盖后台错误 | §2.3 新增 `createTestCtx()` 收集 promise + `flush()` 暴露 |
| 5 | `wrangler d1 execute :memory:` 不可落地 | §3.3 改为 `mkdtempSync` 临时 persist 目录 + `wrangler d1 migrations apply --local --persist-to <tmp>`，再 schema hash 对比 |

### 2026-06-13 Review v2（哥指出端口约定不对 → 已修订）

| 轮次 | 问题 | 修订 |
|---|---|---|
| v2.1 | 误以为约定是"web/worker 维度各自 +10000/+20000"，写成 18787/28787/28788 | 改回"项目主端口 + N×10000"，但仍把 L2 worker 写成 18787（错） |
| v2.2 | 哥纠正：本项目主端口 7031 → 17031 / 27031 / 37031 按万位档递增 | §2.6 重写为万位档表：L2=17031（万位档1，worker 独占）/ L3 web=27031,27032（万位档2）/ L3 worker=37031,37032（万位档3）；§2.5 / §3.5 端口同步；`findOpenPort` 调用对齐 |

### 2026-06-13 Review v3（哥提出 5 点 → 已修订）

| # | 问题 | 修订位置 |
|---|---|---|
| 1 | `verify-test-db.ts` 校验主段 DB 名 ≠ 生产名，与"local-only mode 复用主 binding"冲突；写死 `…/v3/d1/<hash>/db.sqlite` 路径与实际 miniflare 形态不符 | §2.5 改为不校验主段名；首选 `wrangler d1 execute --local --persist-to … --json` 查 marker；降级才用 glob 找 `*.sqlite`（不写死路径） |
| 2 | `typecheck` 改成 `prepare:test-sql --check && tsc -b` 会丢掉 `scripts/typecheck.sh:4` 的 Next route types freshness 检查 | §2.2.1 改为 `scripts/typecheck.sh` 顶部加 `bun run prepare:test-sql --check`，保留既有流程；§6 A3 同步 |
| 3 | `createTestCtx` 用 `catch(... Promise.reject(err))` 仍可能 unhandled rejection；文字说 allSettled 但代码用 Promise.all | §2.3 把 task 包成"始终 resolve 的 Settled = { ok, err? }"，flush 用 `Promise.all` 后查第一个 `ok:false` 抛出 |
| 4 | §4.3 新增文件清单仍写 `init-sql.generated.ts` 是 gitignore，与 §2.2.1 提交进 git 矛盾 | §4.3 改为"自动生成，**提交进 git**" |
| 5 | `workerFetch()` 返回 `{res, ctx}`，示例却 `const res = await workerFetch(...)` 后读 `res.status`，签名不一致 | §2.3 拆为两个 helper：`workerFetch()` 默认返回 `Response`（与示例一致）；`workerFetchWithCtx()` 返回 `{res, ctx}` 用于后台断言 |

### 2026-06-13 Review v4（哥提出 3 点 → 已修订）

| # | 问题 | 修订位置 |
|---|---|---|
| 1 | startLocalWorker 漏注入 `ENVIRONMENT:test` / `ALLOWED_ORIGINS:*`，worker 实际跑生产 vars，D1 隔离三层校验语义不成立 | §2.5 步骤 4 列出完整 `--var` 清单；提取 `scripts/lib/local-worker.ts` + `TEST_WORKER_VARS` 常量供 L2/L3/L3-admin 三处共享；§4.3 新增 helper 文件；§6 A6 commit 描述明确"行为变化：补全 ENVIRONMENT/ALLOWED_ORIGINS 注入"；§13.1 新增对 `run-l2.ts:149-154` 的修复条目 |
| 2 | Phase D3 仍写死 `.wrangler/state/e2e/v3/d1/.../db.sqlite`，与 §2.5 修订后的"首选 wrangler execute / 降级 glob / 不写死路径"矛盾 | §6 D3 和 §4.2 verify-test-db 描述同步改为"首选 `wrangler d1 execute --local --persist-to --json`，降级 glob 找 `*.sqlite`" |
| 3 | 默认 `workerFetch()` 创建一次性 ctx 但不 flush，后台 `waitUntil` 错误被包成 `{ok:false}` 后永远没人检查，仍是静默失败 | §2.3 引入 `setCurrentTestCtx`/`flushCurrentTestCtx` harness：`workerFetch` 优先绑到 harness ctx（`afterEach` 统一 flush，错误必抛）；无 harness 时立即 flush；§3.4 样例 + §6 B1 同步增加 setup harness；§4.3 新增 `setup.ts` 文件 |

### 2026-06-14 Review v5（哥提出 2 点 Low → 已修订）

| # | 问题 | 修订位置 |
|---|---|---|
| 1 | §13 同步清单第 901 行仍写"重写为本地 SQLite 文件查 `_test_marker`"，与 §2.5 / §6 D3 的最终方案"首选 wrangler execute / 降级 glob / 不写死路径"不一致；§5 6DQ 表第 659 行同样问题；§4.3 `run-verify-test-db-local.ts` 描述也旧 | §13.2、§5、§4.3 三处同步措辞为"首选 `wrangler d1 execute --local --persist-to --json`，降级 glob + bun:sqlite"，避免 D3 实施时按旧方案写 |
| 2 | §2.2 / §3.3 提到"30 个 migration"是脆数字（实际 30 个文件，但哥可能按 schema-only 算 27 个） | 改为"现有 migrations"，避免后续审计误判 |

---

以下文件含旧端口或旧测试栈引用，**本期 23 号文档落地时不一并修改**，等阶段 A-E 实施时随对应 commit 顺手修。每条都标出归属阶段：

### 13.1 端口约定违反 / 旧值（需迁到 nmem 万位档）

| 文件 | 当前 | 应改为 | 归属 |
|---|---|---|---|
| `scripts/run-l2.ts:149-154` | 只注入 `API_KEY`/`ADMIN_API_KEY`/`JWT_SECRET` 三个 var | 改为调用 `startLocalWorker()` helper 自动注入完整 `TEST_WORKER_VARS`（**含 `ENVIRONMENT:test` 和 `ALLOWED_ORIGINS:*`**，修复现有 worker 跑生产 ENV/origin 的 bug，详 §2.5 review v4 #1） | Phase A6 |
| `scripts/run-l2.ts:30` | `TEST_PORT = 8787` | `await findOpenPort([17031, 0])` | Phase C2 |
| `scripts/run-l2.ts:10` 注释 | `Poll http://localhost:8787/api/live` | 注释改为变量引用 | Phase C2 |
| `tests/integration/setup.ts:13` | `WORKER_PORT = 8787` | 默认 `17031`，env override 优先 | Phase C2 |
| `tests/integration/setup.ts:4` 注释 | `port 8787 before tests` | 注释更新 | Phase C2 |
| `tests/integration/worker/public.test.ts:461` | `fetch("http://localhost:8787/api/live")` | 用 `getWorkerUrl()` helper（其余文件已用） | Phase C1（迁 http/ 时顺手） |
| `scripts/audit-l2-coverage.ts:49,53,263,268,305-306` | 注释 + 正则匹配 `localhost:8787` | 注释更新；正则增加 `localhost:17031` 备选（保留 8787 兼容老用例迁移期） | Phase C3 |
| `docs/18-l2-coverage-matrix.md:55,59` | 描述 `localhost:8787` | 与 audit 脚本同步重生成 | Phase C3 |
| `scripts/run-l3.ts:35,8,9` | `TEST_PORT = 27031` 直接硬编码 | 仍 27031（万位档 2 正确）；只需补 `WORKER_PORT = await findOpenPort([37031, 0])` | Phase D1 |
| `scripts/run-l3-admin.ts:38` | `TEST_PORT = 7032`（admin dev port） | **改为 27032**（万位档 2，L3 admin web）；`apps/admin/package.json` 启动脚本沿用 7032 dev 不变，但 L3 runner 用 27032 | Phase D2 |
| `scripts/run-l3-admin.ts:5,15-16` 注释 | `port 7032` | 改为 27032 | Phase D2 |
| `playwright.config.ts:104` | `baseURL: "http://localhost:7032"` (admin project) | 改为 `http://localhost:27032` | Phase D2 |
| `playwright.config.ts:52,96` 注释 | `port 7032` | 改为 27032 | Phase D2 |
| `tests/e2e/admin/**/*.spec.ts`（admin-users / admin-threads / admin-logs / admin-forums / fixtures/admin-base.ts 共 ~11 处） | `?? "http://localhost:7032"` | 改为 `?? "http://localhost:27032"`（但 baseURL 由 playwright 注入，fallback 应已不命中——确认后可删 fallback） | Phase D2 |
| `scripts/bench-l3.ts:19` 注释 | `:7032` | 改 27032 | Phase D2 |

### 13.2 测试资源旧名引用（需删 / 改 / 同步）

| 文件 | 当前 | 应改为 | 归属 |
|---|---|---|---|
| `apps/worker/wrangler.toml:47-77` `[env.test]` 整段 | 用 `tongjinet-db-test` / `name="ellie-test"` | 删除（或迁到 §7.1 决策的 import 工具链独立配置） | Phase E1 |
| `package.json` `worker:migrate:test` / `worker:deploy:test` | `--remote --env test` | 删除两 script | Phase E2 |
| `scripts/verify-test-db.ts:34-43,75-92` | 校验 `[env.test]` + `wrangler d1 execute --remote` | 首选 `wrangler d1 execute DB --local --persist-to <dir> --command "SELECT value FROM _test_marker WHERE key='env'" --json` 查 marker；降级 glob 找 `*.sqlite` + bun:sqlite 查（不写死 miniflare 路径，详 §2.5） | Phase D3 |
| `.github/workflows/ci.yml:62-109` `browser-e2e` job | 4 个 CF secret + 3 个 wrangler `--remote` step | 删除 secret / step（详 §4.4 diff） | Phase D4 |
| `scripts/run-l3.ts:21-25,84,109` | 校验 `WORKER_API_URL` 含 `-test` | 改为允许本地端口 OR `-test` 子串 | Phase D1 |
| `scripts/run-l3-admin.ts:81,98` | 同上 | 同上 | Phase D2 |

### 13.3 文档（CLAUDE.md / docs/*.md）需同步的"旧约定"段

| 文件 | 当前 | 应改为 | 归属 |
|---|---|---|---|
| `CLAUDE.md:115` | 列 `worker:migrate:test` 脚本 | 删除该行（脚本已删） | Phase E2 |
| `CLAUDE.md:136-137` | `L2 Integration: 17031 (dev + 10000)` / `L3 E2E: 27031 (dev + 20000)` | **保留**（已对齐 nmem 万位档），但补 L3 worker 段：`L3 forum worker: 37031 / L3 admin worker: 37032`；并补 admin web L3 = 27032 | Phase E3 |
| `CLAUDE.md:200-220` "D1 Test Isolation Setup" 整节 | 描述 `tongjinet-db-test` 三层验证 | 重写为本地 SQLite 三层验证 | Phase E3 |
| `CLAUDE.md:206-207` | Test D1 / Test KV 远端 ID | 删除（不再有远端） | Phase E3 |
| `CLAUDE.md:212` | `Worker auto-starts with --env test --remote` | 改为 `wrangler dev --local --persist-to` | Phase E3 |
| `docs/01-architecture.md:143` | `tongjinet-db-test 独立测试 D1 实例` | 改为本地 SQLite 测试栈 | Phase E3 |
| `docs/03-data-migration.md:208` | `Worker 环境: --env test --remote` | 同上 | Phase E3 |
| `docs/04b-frontend-architecture.md:398` | 列 `ellie-db-test` D1 + `ellie-test` R2 + `ellie-test` KV | 删除该行或改为 import-only 用途 | Phase E3 |
| `docs/05-worker-api.md:1090` | `Worker 运行在 http://localhost:8787` | 区分 dev/L2/L3 三档端口 | Phase E3 |
| `docs/06-cli-design.md:724,779,784` | `tongjinet-db-test`/`ellie-test`/`https://ellie-test.nocoo.workers.dev` 引用 | 改写或删除 | Phase E3 |
| `docs/07-api-reference.md:51` | `本地开发 http://localhost:8787` | 区分 dev/L2 端口 | Phase E3 |
| `docs/10-admin-console.md:197,200` | "boots admin app on :7032" / `-test Worker URL` | 7032 改 27032；`-test Worker URL` 改本地 | Phase D2 / E3 |
| `docs/14a-audit-logs.md:192-198` | `admin server up on :7032` 等 | 改 27032 | Phase D2 / E3 |
| `docs/17-email-verification.md:313` | `[env.test.vars]` 引用 | 改写：本地用 var injection 而非 env.test | Phase E3 |
| `docs/18-quality-baseline.md` L2 章节 | 单层 L2 描述 | 改为 fast/http 双层 + 万位档端口 | Phase E3 |
| `docs/18-l2-coverage-matrix.md` | 单一 fast/http 矩阵；引用 `localhost:8787` | audit 脚本扩展后重生成 | Phase C3 |
| `docs/e2e-test-design.md:31-33` "Port Convention" | 仅列 dev/L2/L3 web 三档 | 补 L3 worker 万位档 3（37031/37032）；补 forum/admin 区分 | Phase D1 / D2 |
| `docs/docker-deployment.md` | 仅描述部署端口（不变） | **不动**（部署链路不在本期范围） | — |

### 13.4 同步策略

- 每个 phase 的 commit message 后缀 `+ docs sync` 标记本表中归属该 phase 的文件。
- §13.1 / §13.2 改动随 phase 同步是为了让"老 8787 / 7032 / `tongjinet-db-test` 名字"与代码同时下线，避免文档与代码漂移期。
- §13.3 中标记 `Phase E3` 的属于"E3 docs 收口" commit，可一次性扫净。
- **本期 Phase B-D 实施时**，每改一处端口/资源名都对照本表勾选（追加到 §12 修订记录中），保证零遗漏。

---
