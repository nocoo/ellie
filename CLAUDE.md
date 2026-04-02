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

(Record mistakes and lessons learned here)
