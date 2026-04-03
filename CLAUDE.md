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
# Deploy
npx wrangler deploy -c apps/worker/wrangler.toml

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
| `bun run worker:deploy` | Deploy Worker to production |
| `bun run migrate` | Run database migrations |
| `bun run cli` | Run legacy TS CLI |
| `bun run tui` | Launch Rust TUI (via scripts/tui.ts) |

### Testing (6-dimensional quality system)

| Script | Description | Test Count |
|--------|-------------|------------|
| `bun run test` | Run all L1 tests (unit + worker) | ~3069 |
| `bun run test:unit` | L1 unit tests (`tests/unit/`) | ~2202 |
| `bun run test:unit:worker` | L1 worker tests (`apps/worker/`) | ~867 |
| `bun run test:integration` | L2 integration tests (requires worker running) | ~52 |
| `bun run test:e2e` | L3 E2E tests (Playwright) | 22 |
| `bun run test:coverage` | L1 unit tests with coverage report | - |

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

## Quality Gates (pre-push)

| Gate | Command |
|------|---------|
| G1 typecheck | `bun run typecheck` |
| L1 all tests | `bun run test` |
| G2 dependency scan | `osv-scanner scan --lockfile bun.lock` |
| G2 secret detection | `gitleaks detect --no-banner` |
| Rust L1 | `cargo test --workspace` (in `packages/cli-rs`) |
| Rust L2 | `cargo test --test integration -- --ignored` (requires `ELLIE_API_URL` + `ELLIE_API_KEY`) |
| Rust G2 | `osv-scanner scan --lockfile Cargo.lock` |

## Retrospective

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
