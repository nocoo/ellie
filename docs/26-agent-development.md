# Agent development details

Detailed project constraints and procedures. The root [AGENTS.md](../AGENTS.md) defines the quality contract and records current enforcement gaps.

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
5. **Authorized deployment:** use `bun run worker:deploy`; remind the user when Worker changes need deployment.
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

Three env files, one per app. Each has a tracked `.example` sibling — copy
those to the real names below (all gitignored) and fill in values.

| Real path | Example file | Consumed by |
|---|---|---|
| `/.dev.vars` (root) | `apps/worker/.dev.vars.example` | `wrangler dev` — `apps/worker/.dev.vars` MUST be a symlink → `../../.dev.vars` so worker + CLI dev builds read one file |
| `apps/web/.env.local` | `apps/web/.env.local.example` | Next.js forum (port 7031) |
| `apps/admin/.env.local` | `apps/admin/.env.local.example` | Next.js admin console (port 7032) |

### Worker secrets (in `/.dev.vars`)

| Variable | Required | Purpose |
|---|---|---|
| `API_KEY` | ✓ | Forum API key (Key A). Must match `apps/web/.env.local:FORUM_API_KEY` |
| `ADMIN_API_KEY` | ✓ | Admin API key (Key B). Must match `apps/admin/.env.local:ADMIN_API_KEY` |
| `JWT_SECRET` | ✓ | JWT signing secret for forum user tokens |
| `EMAIL_VERIFY_HMAC_KEY` | optional | HMAC for 6-digit email codes (docs/17). Without it `/auth/email/*` → 503 |
| `DOVE_WEBHOOK_TOKEN` | optional | Dove mail relay bearer. Non-secret Dove config lives in `wrangler.toml [vars]` |
| `IP_LOOKUP_API_KEY` | optional | Upstream IP-lookup key for admin panel. Without it → 503 |
| `ANALYTICS_INGEST_KEY` | optional | Shared with `apps/web/.env.local`. P5 page-view ingest bridge |

### Web (`apps/web/.env.local`)

`AUTH_SECRET`, `AUTH_URL`, `WORKER_API_URL`, `FORUM_API_KEY`,
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CAP_API_ENDPOINT`,
`ANALYTICS_INGEST_KEY` (optional). See `.env.local.example` for details.

### Admin (`apps/admin/.env.local`)

`AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
(admin is Google-only), `ADMIN_EMAILS` (allowlist), `WORKER_API_URL`,
`ADMIN_API_KEY`. See `.env.local.example` for details.

### Key A vs Key B

Forum handlers accept `API_KEY` only; admin handlers accept
`ADMIN_API_KEY` only. Never share the same value across both — leaking
one must not grant the other's scope.

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
3. `apiKey` in the OS-specific Ellie JSON config (or explicit `--config`; see `docs/25-development.md`)
4. Build-time `ELLIE_DEFAULT_API_KEY` (injected in release builds)


## Versions

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
- `packages/cli-rs/ellie-{core,tui}/Cargo.toml` and their first-party `Cargo.lock` entries — Rust package and CLI versions

**Version display:**
- Footer: `v1.0.0` (via `VERSION_DISPLAY`)
- `/api/live`: returns `version` field


## Current environment and release

Use [development procedures](../docs/25-development.md) and the release workflow for current domains and Docker deployment. The older host examples are historical. Worker deployment remains separate and migration-first.
