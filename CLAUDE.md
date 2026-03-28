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

## Quality Gates (pre-push)

| Gate | Command |
|------|---------|
| G1 typecheck | `bun run typecheck` |
| L1 web tests | `bun test tests/unit/` |
| L1 worker tests | `bun test apps/worker` |
| G2 dependency scan | `osv-scanner scan --lockfile bun.lock` |
| G2 secret detection | `gitleaks detect --no-banner` |
| Rust L1 | `cargo test --workspace` (in `packages/cli-rs`) |
| Rust L2 | `cargo test --test integration -- --ignored` (requires `ELLIE_API_URL` + `ELLIE_API_KEY`) |
| Rust G2 | `osv-scanner scan --lockfile Cargo.lock` |

## Retrospective

(Record mistakes and lessons learned here)
