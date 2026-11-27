# Ellie

Forum (`apps/web`) and admin (`apps/admin`) Next.js/Auth.js apps using `@nocoo/basalt`, backed by a Cloudflare Worker API (`apps/worker`, D1/KV/R2) and a Rust ratatui TUI (`packages/cli-rs`).
Docs: [README.md](README.md) · [Development](docs/25-development.md) · [API Architecture](docs/api-architecture.md) · [Agent Details](docs/26-agent-development.md) · [Local Test Stack](docs/23-local-test-stack.md) · [Retrospective](Retrospective.md)

Nested `apps/web/AGENTS.md` and `apps/admin/AGENTS.md` hold Next.js-generated framework rules (kept committed so `next dev` leaves the tree clean), not separate project handbooks.

## Layout

| Surface               | Paths                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| Forum / admin         | `apps/web`, `apps/admin` (Next.js, Auth.js, `@nocoo/basalt`)                                     |
| API / schema / shared | `apps/worker`, `packages/db`, `packages/shared`, `packages/types`, `packages/test-mocks`         |
| CLI / migration       | `packages/cli-rs` (`ellie-core` + `ellie-tui`), `packages/migrate` (`packages/cli` is legacy TS) |

## Commands

Run from root with Bun 1.4.4, Node 26+, Rust 1.88+, and Playwright Chromium. Env templates live at `apps/worker/.dev.vars.example`, `apps/web/.env.local.example`, `apps/admin/.env.local.example`, and `.env.example`; local Worker runners inject test secrets, while manual browser login and optional Cap, Google OAuth, mail, and memory-statistics flows follow [development](docs/25-development.md) and [agent details](docs/26-agent-development.md).

```sh
bun install --frozen-lockfile
bun run dev:forum                 # https://ellie.dev.hexly.ai -> 127.0.0.1:7031
bun run dev:admin                 # https://ellie-admin.dev.hexly.ai -> 127.0.0.1:7032
bun run worker:dev                # 127.0.0.1:8787
bun run typecheck                 # S1
bun run lint                      # S2 check-only, 0 warnings (Biome)
bun run build                     # web + admin Next.js builds
bun run test                      # CI L1: Vitest + bun:sqlite migration tests
bun run test:coverage             # local L1 coverage gate
bun run test:l2                   # managed local real-HTTP API lane (alias: test:e2e:api)
bun run gate:l2                   # adds strict route-coverage audit
bun run test:e2e:bdd              # forum then admin Playwright Chromium runners
cargo fmt --manifest-path packages/cli-rs/Cargo.toml --all -- --check
cargo clippy --manifest-path packages/cli-rs/Cargo.toml --workspace --all-targets --all-features --locked -- -D warnings
cargo test --locked --workspace --manifest-path packages/cli-rs/Cargo.toml
```

## Invariants

- **Three-layer API**: Browser → Next.js proxy → Worker → D1/KV/R2; add a proxy route for every browser-facing Worker route and update [API docs](docs/api-architecture.md).
- **Split credentials**: Forum Key A (`API_KEY`) and admin Key B (`ADMIN_API_KEY`) are distinct, server-only secrets; use `apiClient` in browsers and the right server client. Never log keys or sessions.
- **Env layout**: Keep `apps/worker/.dev.vars` symlinked to root `.dev.vars`; `apps/web` and `apps/admin` own separate gitignored `.env.local` files.
- **Migration-first Worker deploy**: `apps/worker/migrations/` is the live schema authority; deploy only via `bun run worker:deploy` so migrations apply before code. Never deploy review blockers.
- **Boundary tests**: Test SQL generation and authorization at both the Next.js proxy and Worker boundaries.
- **Shanghai dates**: Use `Intl.DateTimeFormat.formatToParts()` with explicit UTC arithmetic for Shanghai date boundaries; never locale-string round trips.
- **Rust TUI target safety**: `packages/cli-rs` defaults can hit the live Worker; pass a local `--api-url` / `ELLIE_API_URL` and isolated `--config` in tests. Keep legacy TS `packages/cli` status clear.
- **Release & versions**: Web/admin deploy via `.github/workflows/release.yml` (Docker), separate from Worker. Sync versions ([details](docs/26-agent-development.md)); never infer live deploy from a commit.
- **Clean commit units**: Historical test runs are not current evidence. Wait for a commit's hook to finish and confirm clean `git status` before editing the next unit.

## Quality & Local Gates

Follows `system1-quality`; CI slot definitions and pinned `base-ci` (`v2026.20`) revision live in `.github/workflows/quality-slots.yml` (invoked by `.github/workflows/ci.yml`; `quality / Z1: Gate` required on `main` via `z1-gate`). `S2` enforces both JS/TS/CSS/Markdown linting (`s2-lint` via Biome) and Rust `cargo fmt --check` + `clippy -D warnings` (`s2-rust-lint`). Status vocabulary: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `B1 Build` is `enforced` (`bun run build` for `web` + `admin`); `L2 Runtime` is `N/A` (Worker unit tests run in Vitest; HTTP verified in `L3`); `L4 E2E` splits into parallel `L4: E2E (Web 1/2)`, `L4: E2E (Web 2/2)`, and `L4: E2E (Admin)` Desktop Chromium suites via `setup-playwright`; `P1 Package` is `enforced` (Docker context + `deps` stage image build smoke with BuildKit GHA cache).
- **L1 & G2 scope**: CI `L1` runs `bun run test:coverage` plus `bun:sqlite` migration tests; `test:coverage` enforces 80% statements/lines/functions/branches (pure View `src/components/**`, `src/app/**`, and test-double `packages/test-mocks` excluded). `G2` scans `bun.lock` and `packages/cli-rs/Cargo.lock`.
- **Local hooks**: Installed via `bun run prepare` (`.husky/`). Check-only policy: never bypass hooks or use autofix in checks.
- **Pre-commit**: Runs `gitleaks protect --staged`, exports the staged index snapshot (symlinking deps), then runs parallel `typecheck`, `lint`, `test:coverage`, `test:l2`, and Rust fmt/clippy/test.
- **Pre-push**: Runs Phase 1 (`typecheck`, `lint`, `test:coverage`, Bun migration tests), then Phase 2 (`test:l2`, `osv-scanner`, `gitleaks`, Rust `osv-scanner`, and optional Rust integration tests).

## Resources & Isolation

Open local dev and manual browser acceptance through existing Caddy HTTPS domains (`https://ellie.dev.hexly.ai`, `https://ellie-admin.dev.hexly.ai`), not loopback URLs. Do not alter working Caddy config or certificates.

| Lane                           | Endpoint / State                                                        | Boundary                                                                      |
| ------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Dev                            | Forum `:7031`, Admin `:7032`, Worker `:8787`, `.wrangler/state/dev`     | Daily local data; open browsers via Caddy HTTPS domains                       |
| L2 API (`test:l2`)             | Worker `:17031` (or free port), `.wrangler/state/e2e`                   | Local Miniflare/SQLite; see `scripts/run-l2.ts` and `scripts/lib/local-d1.ts` |
| L3/L4 Browser (`test:e2e:bdd`) | Worker `:8788`, Forum `:27031`, Admin `:7032`, `.wrangler/state/l3`     | Run forum then admin sequentially; keep ports free                            |
| Prod                           | `https://bbs.tongji.net`, `https://admin.tongji.net`, Cloudflare Worker | Read-only checks unless deploy is authorized; Worker deploys separately       |

- **Local-only test isolation**: Tests use local SQLite/KV/R2 with unique per-run state, test markers, and canonical-path/ownership cleanup guards; remote `-test` and `worker:*:test` are decommissioned.

## Retrospective

Record incident narratives in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests/hooks.
