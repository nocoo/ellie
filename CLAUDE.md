# Ellie — Project Intelligence

## Architecture

Monorepo with Bun (TypeScript) + Rust:

| Package | Description |
|---------|-------------|
| `apps/web` | Next.js frontend |
| `apps/worker` | Cloudflare Worker API (D1 + KV) |
| `packages/cli-rs` | Rust TUI client (ratatui) — workspace: `ellie-core` (lib) + `ellie-tui` (bin) |
| `packages/db` | D1 schema & migrations |
| `packages/repositories` | Data access layer (`@ellie/repositories`) |
| `packages/types` | Shared TypeScript types (`@ellie/types`) |
| `packages/cli` | Legacy TS CLI (deprecated) |
| `packages/migrate` | Migration tooling |

## API Architecture (IMPORTANT)

**Full documentation:** `docs/api-architecture.md`

### Three-Layer Model

```
Browser → Next.js API Routes → Cloudflare Worker → D1/KV
         (proxy layer)        (backend)
```

### Key Rules

1. **Browser NEVER calls Worker directly** — always goes through Next.js proxy routes
2. **API Keys are server-side only** — never exposed to browser
3. **Every browser API call needs a Next.js route** — missing routes cause "Unexpected token '<'" errors

### API Clients

| Client | Location | Use Case |
|--------|----------|----------|
| `apiClient` | `lib/api-client.ts` | Browser → Next.js routes |
| `forumApi` | `lib/forum-api.ts` | Server → Worker (Key A) |
| `adminApi` | `lib/admin-api.ts` | Server → Worker (Key B) |
| `authFetch/authPatch` | `lib/forum-auth.ts` | Server → Worker (Key A + JWT) |

### Adding New Endpoints

1. **Worker handler:** `apps/worker/src/handlers/*.ts`
2. **Worker router:** `apps/worker/src/index.ts`
3. **Next.js proxy (if browser needs it):** `apps/web/src/app/api/v1/*/route.ts`
4. **Use correct client:** `forumApi` for server, `apiClient` for browser
5. **Deploy Worker:** `bun run worker:deploy` (remind user after Worker changes!)
6. **Update docs:** Keep `docs/api-architecture.md` and relevant feature docs in sync

### Common Mistakes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Unexpected token '<'` | Missing Next.js proxy route | Create `/api/v1/*/route.ts` |
| `404` on new API | Worker not deployed | Run `bun run worker:deploy` |
| `404` on browser API call | Missing Next.js proxy | Add proxy route for the endpoint |
| `UNAUTHORIZED` | Wrong API key | Check Key A vs Key B routing |
| `import error` | Using server-only client in browser | Use `apiClient` instead |

## Secrets & Environment

**Single source of truth:** `/.dev.vars` (root directory)
- `apps/worker/.dev.vars` is a symlink → `../../.dev.vars`
- Both `wrangler dev` and CLI dev builds read from the same file

| Variable | Description |
|----------|-------------|
| `API_KEY` | Cloudflare Worker API key — shared between local dev and production |
| `JWT_SECRET` | JWT signing secret for auth tokens |

**Wrangler commands** must specify config: `-c apps/worker/wrangler.toml`

```bash
# Deploy Worker (standard: applies pending D1 migrations first)
bun run worker:deploy

# Update secrets
echo "<value>" | npx wrangler secret put API_KEY -c apps/worker/wrangler.toml

# Local dev
npx wrangler dev -c apps/worker/wrangler.toml
```

**Rust CLI** reads API key from (highest priority first):
1. `--api-key <KEY>` CLI argument
2. `ELLIE_API_KEY` environment variable
3. `apiKey` in `~/.config/ellie/config.json`
4. Build-time `ELLIE_DEFAULT_API_KEY` (injected in release builds)

## NPM Scripts (root package.json)

### Development

| Script | Description |
|--------|-------------|
| `bun run dev` | Start Next.js dev server (port 7031) |
| `bun run build` | Build Next.js for production |
| `bun run start` | Start production server |
| `bun run worker:dev` | Start Cloudflare Worker locally |
| `bun run worker:migrate:prod` | Apply pending D1 migrations to production (`tongjinet-db`) |
| `bun run worker:migrate:test` | Apply pending D1 migrations to test (`tongjinet-db-test`) |
| `bun run worker:deploy` | **Standard prod deploy**: applies pending D1 migrations, then `wrangler deploy`. Always use this — never run `wrangler deploy` directly. |
| `bun run worker:deploy:test` | Same flow against the test environment |
| `bun run migrate` | Run database migrations |
| `bun run cli` | Run legacy TS CLI |
| `bun run tui` | Launch Rust TUI (via scripts/tui.ts) |

### Testing (6-dimensional quality system)

| Script | Description | Test Count |
|--------|-------------|------------|
| `bun run test` | Run all L1 tests (unit + worker) | ~3069 |
| `bun run test:unit` | L1 unit tests (`tests/unit/`) | ~2202 |
| `bun run test:unit:worker` | L1 worker tests (`apps/worker/`) | ~867 |
| `bun run test:integration` | L2 integration tests (requires worker running) | ~164 |
| `bun run test:e2e` | L3 E2E tests (Playwright) | 22 |
| `bun run test:coverage` | L1 unit tests with coverage report | - |
| `bun run verify:test-db` | D1 isolation verification | - |

**Port Convention:**
- Dev: 7031
- L2 Integration: 17031 (dev + 10000)
- L3 E2E: 27031 (dev + 20000)

### Code Quality

| Script | Description |
|--------|-------------|
| `bun run typecheck` | TypeScript type checking (all packages) |
| `bun run lint` | Biome linting |
| `bun run lint:fix` | Biome lint with auto-fix |
| `bun run format` | Biome format |

### Version Management

| Script | Description |
|--------|-------------|
| `bun run release` | Bump patch version (Z+1) |
| `bun run release -- minor` | Bump minor version (Y+1) |
| `bun run release -- major` | Bump major version (X+1) |
| `bun run release -- 2.0.0` | Set specific version |
| `bun run release -- --dry-run` | Preview changes without modifying |

**Version locations (all updated by release script):**
- Root `package.json` (single source of truth)
- All workspace `package.json` files
- `packages/types/src/version.ts` — exports `VERSION` and `VERSION_DISPLAY`
- `packages/types/src/version.d.ts` — TypeScript declarations

**Version display:**
- Footer: `v1.0.0` (via `VERSION_DISPLAY`)
- `/api/live`: returns `version` field

## Quality Gates (pre-push)

| Gate | Command |
|------|---------|
| G1 typecheck | `bun run typecheck` |
| L1 all tests | `bun run test` |
| G2 dependency scan | `osv-scanner scan --lockfile bun.lock` |
| G2 secret detection | `gitleaks detect --no-banner` |
| D1 isolation | `bun run verify:test-db` |
| Rust L1 | `cargo test --workspace` (in `packages/cli-rs`) |
| Rust L2 | `cargo test --test integration -- --ignored` (requires `ELLIE_API_URL` + `ELLIE_API_KEY`) |
| Rust G2 | `osv-scanner scan --lockfile Cargo.lock` |

## Retrospective

### 2026-05-07: Worker Deploy Without Migration Apply
- **Issue:** Deployed worker `f1d00be` to production; admin `/api/admin/users` immediately broke with 500 ("无法加载 users 列表")
- **Cause:** Migration `0030_user_tombstone.sql` (adds `purged_at`/`purged_by` to `users`) was never applied to prod D1. Deployed worker's `USER_COLUMNS` SELECT references those columns → SQLite "no such column" → 500.
- **Fix:**
  1. `cd apps/worker && bun x wrangler d1 migrations apply tongjinet-db --remote` — applied 0030
  2. Hardened the deploy contract: `bun run worker:deploy` now runs `worker:migrate:prod` BEFORE `wrangler deploy`. `worker:deploy:test` does the same against the test env.
- **Lessons:**
  1. **Never run `wrangler deploy` directly.** Always use `bun run worker:deploy` so migrations apply first.
  2. **Schema and code must move together.** Any commit that touches `*_COLUMNS`/handlers + a new migration must be deployed atomically — migration first, code second.
  3. **Pre-deploy verification:** `bun x wrangler d1 migrations list tongjinet-db --remote` should print `✅ No migrations to apply!` once `worker:deploy` completes.

### 2026-04-06: D1 Test Isolation Setup
- **Issue:** L2 tests were failing because they couldn't connect to production D1 or used empty local D1
- **Solution:** Created isolated test environment with separate D1 and KV instances
- **Configuration:**
  - Test D1: `tongjinet-db-test` (940c7758-0a9e-44b2-aeb5-745fa3143371)
  - Test KV: `ellie-test-kv` (490227e961174fd38c6c14530a4ee3ee)
  - wrangler.toml `[env.test]` section configures isolated resources
  - `_test_marker` table with `env=test` for runtime verification
- **Running L2 tests:**
  1. `bun run verify:test-db` — verify D1 isolation
  2. Worker auto-starts with `--env test --remote` via `tests/integration/preload.ts`
- **Key files:**
  - `apps/worker/wrangler.toml` — [env.test] configuration
  - `scripts/verify-test-db.ts` — D1 isolation verification script
  - `apps/worker/migrations/0000_init_schema.sql` — base schema for test DB

### 2026-04-03: Worker + Next.js Proxy Sync Issues
- **Issue:** User moderation actions (mute/ban/nuke) returned 404 errors
- **Cause:** Worker API endpoints existed but Next.js proxy routes were missing; also Worker wasn't deployed
- **Fix:** Created all missing proxy routes in `apps/web/src/app/api/v1/moderation/`
- **Lessons:**
  1. **Always create proxy routes together with Worker endpoints** — browser calls go through Next.js
  2. **After modifying Worker code, remind user to deploy** — `bun run worker:deploy`
  3. **Check both layers when debugging 404s** — Worker route + Next.js proxy route
  4. **Keep docs in sync** — update relevant docs when adding new API endpoints

### 2026-04-03: API Proxy Routes Missing
- **Issue:** `/api/v1/settings` called by `useFeatureFlags` hook returned HTML 404 instead of JSON
- **Cause:** Next.js proxy route didn't exist; browser received HTML error page
- **Fix:** Created `apps/web/src/app/api/v1/settings/route.ts` to proxy to Worker
- **Lesson:** Every browser API endpoint must have a corresponding Next.js route

### 2026-04-03: SQL Syntax Error in Offset Pagination  
- **Issue:** `LIMIT  OFFSET ?` (missing LIMIT parameter) caused SQLite syntax error
- **Cause:** `getThreadListQueryWithOffset` used `.slice(0, -1)` incorrectly
- **Fix:** Changed to append ` OFFSET ?` without slicing
- **Lesson:** Always test SQL query string generation

### 2026-04-05: D1 Schema Not Deployed
- **Issue:** 站内信页面报 "Internal server error"，实际是 `D1_ERROR: no such table: messages`
- **Cause:** Worker handler 引用了 `messages` 表，但没有创建对应的 migration
- **Fix:** 创建 `0022_create_messages.sql` 并运行 `wrangler d1 migrations apply`
- **Lessons:**
  1. **新增 Worker handler 涉及新表时，必须同时创建 migration**
  2. **单独 apply migration（不 deploy）:** `bun run worker:migrate:prod`
  3. **部署检查清单:** Worker 代码改动 → `bun run worker:deploy`（已自动先 apply migrations，再 deploy）；纯 schema 改动且暂不 deploy → `bun run worker:migrate:prod`
