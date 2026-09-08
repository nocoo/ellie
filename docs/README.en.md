<p align="center">
  <img src="../assets/brand/icon-rounded.png" alt="Ellie" width="128" height="128" />
</p>
<h1 align="center">Ellie</h1>
<p align="center">Browse and maintain the Tongji Network forum, bringing historical Discuz content into a new community interface.</p>
<p align="center">
  <a href="https://bbs.tongji.net">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

Ellie is the community system used by the Tongji Network forum and includes tools for migrating Discuz data. Readers can browse forums, threads, and profiles, then sign in to participate according to site permissions. Administrators maintain content, accounts, and settings through a separate console.

The repository contains a Next.js forum, a Next.js admin console, a Cloudflare Worker API, and a Rust terminal client. Browsers reach the Worker through Next.js server routes. The Worker stores forum records in D1, caches and some runtime state in KV, and uploads in R2. The forum and admin console use separate API keys.

## Features

- **Forums and discussions**: nested forums, thread categories, announcements, pinned threads, and featured content; the website supports rich-text posts, replies, comments, images, and attachments.
- **Community activity**: profiles, avatars, private messages, daily check-ins, credits / coins, and post ratings. Writes depend on account status, email verification, and site rules.
- **Finding content**: search thread titles and browse historical discussions by forum or featured content. The current full-text index covers thread titles.
- **Administration**: manage forums, threads, posts, attachments, and users; handle reports and censored words; inspect operation / login records and statistics; configure site settings and feature switches.
- **Discuz migration**: parse existing MySQL dumps, transform forums, users, threads, posts, attachment metadata, comments, and check-ins, and produce a local SQLite database.
- **Rust TUI**: browse forums, threads, posts, and profiles in a terminal, filter loaded lists, paginate, sign in, and switch themes. Use the website to publish posts and replies.

## Usage

Open the [forum](https://bbs.tongji.net), choose a forum, or search by title. Create a forum account if registration is enabled. Existing migrated accounts sign in with a forum username and password. Posting and replying require email verification and must satisfy the relevant forum and site rules. The website's login / registration forms use Cap verification.

The [admin console](https://admin.tongji.net) uses Google sign-in and an email allowlist, configured separately from forum accounts.

The terminal client requires Rust 1.88+, a reachable Worker, and a forum API key. After completing the local development setup below, run this from the repository root, replacing `LOCAL_FORUM_KEY` with your Worker's `API_KEY`:

```bash
ELLIE_API_URL=http://127.0.0.1:8787 ELLIE_API_KEY=LOCAL_FORUM_KEY \
  cargo run --locked --manifest-path packages/cli-rs/Cargo.toml --bin ellie-tui
```

Use `j` / `k` or the arrow keys to move, `Enter` to open, `Esc` to go back, `n` to load another page, `/` to filter the current list, `L` to sign in, `?` for help, and `q` to quit. Configuration lives in `ellie/config.json` under the operating system's configuration directory; `--config` selects another file. See the [development guide](25-development.md) for its format and options.

## Development

Install Node.js 22+ and Bun; the repository's `packageManager` specifies Bun 1.3.14. Rust is optional for website and Worker development. For a fresh checkout:

```bash
git clone https://github.com/nocoo/ellie.git
cd ellie
bun install --frozen-lockfile
cp apps/worker/.dev.vars.example .dev.vars
ln -s ../../.dev.vars apps/worker/.dev.vars
cp apps/web/.env.local.example apps/web/.env.local
cp apps/admin/.env.local.example apps/admin/.env.local
```

Fill in the configuration before starting:

| Location | Required values |
| --- | --- |
| Root `.dev.vars` | Generate separate `API_KEY`, `ADMIN_API_KEY`, and `JWT_SECRET` values; the two API keys must differ |
| `apps/web/.env.local` | `AUTH_SECRET` and `FORUM_API_KEY` matching the Worker's `API_KEY`; retain the local `WORKER_API_URL`, `AUTH_URL`, and `NEXT_PUBLIC_SITE_URL` |
| `apps/admin/.env.local` | Its own `AUTH_SECRET`, `ADMIN_API_KEY` matching the Worker, Google OAuth `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`, and `ADMIN_EMAILS` |

Forum login and registration need a working `NEXT_PUBLIC_CAP_API_ENDPOINT`. Email verification also requires the Worker's `EMAIL_VERIFY_HMAC_KEY`, Dove configuration, and token. Without those settings you can prepare pages and data, but cannot complete these interactions. The admin Google callback is `http://localhost:7032/api/auth/callback/google`.

Initialize D1 in a separate local directory, then start the Worker:

```bash
./apps/worker/node_modules/.bin/wrangler d1 migrations apply DB --local \
  --persist-to .wrangler/state/dev -c apps/worker/wrangler.toml
./apps/worker/node_modules/.bin/wrangler dev --local --persist-to .wrangler/state/dev \
  -c apps/worker/wrangler.toml --port 8787
```

Start the forum in another terminal. Use a further terminal for the admin console when needed:

```bash
bun run dev:forum
```

```bash
bun run dev:admin
```

The forum is at `http://localhost:7031` and the admin console at `http://localhost:7032`. A fresh database contains the schema and a small amount of initial configuration; create forums through the admin console or prepare imported data. These commands explicitly use local resources. Remote migrations and deployment require your own Cloudflare resources; see the [development and deployment guide](25-development.md).

| Command / path | Purpose |
| --- | --- |
| `bun run build` | Build the forum and admin console |
| `bun run typecheck`, `bun run lint` | Type and code checks |
| `apps/worker/src/` | Worker routes, permissions, data access, and scheduled jobs |
| `apps/worker/migrations/` | Current Worker database migrations |
| `packages/migrate/` | Discuz dump parsing, transformation, and local SQLite output |
| `packages/cli-rs/` | Rust API client and TUI |

After CI succeeds on `main`, the Release workflow deploys Docker images for the forum and admin console. The Worker has a separate `bun run worker:deploy` flow that applies migrations before deployment; Docker releases do not update it.

## Tests

```bash
bun run test
bun run test:l2:fast
bun run test:e2e:api
```

`test` runs unit tests across the TypeScript packages. `test:l2:fast` checks the Worker in-process using SQLite. `test:e2e:api` initializes local D1, seeds test records, and starts a real HTTP Worker. The HTTP runner prefers port 17031 and selects an available port if necessary; each run rebuilds `.wrangler/state/e2e`.

```bash
bunx playwright install chromium
bun run test:e2e:bdd
cargo test --locked --manifest-path packages/cli-rs/Cargo.toml --workspace
```

The browser runner tests the forum and admin console sequentially, covering navigation, content, search, session state, mobile layouts, and admin operations. Both use a local Worker on port 8788 and `.wrangler/state/l3`. The forum uses port 27031; the admin console uses **7032**. Stop development services occupying those ports first. The runner rebuilds local test records and needs no remote test Worker.

Forum tests establish sessions through the Credentials callback; admin tests inject test sessions. These browser tests do not verify the real Cap interface, Google OAuth, or email delivery. `cargo test` runs Rust unit tests. Rust integration tests that depend on an external API are ignored by default; configuration is described in the development guide.

## Stack

| Technology | Purpose |
| --- | --- |
| TypeScript, Bun | Applications, shared packages, migration and test scripts |
| Next.js, React | Forum, admin console, and server-side API proxies |
| Tailwind CSS, shadcn/ui, Tiptap, Recharts | Components, rich-text editing, and statistics charts |
| Cloudflare Workers | Native Fetch API routing and scheduled jobs |
| Cloudflare D1, KV, R2 | Forum data, caches and state, uploaded files |
| Auth.js, JWT | Forum password login, admin Google login, and sessions |
| Cap, Dove | Web verification widget and email verification messages |
| Rust, ratatui, crossterm | Terminal client |
| Vitest, Bun test, Playwright | Unit, API, and browser tests |

## Documentation

- [Documentation index](README.md): architecture, features, and historical designs.
- [Development and deployment guide](25-development.md) (Chinese): initial configuration, runtimes, TUI, migration, and test prerequisites.
- [API layers](api-architecture.md): browser, Next.js proxy, and Worker responsibilities.
- [Discuz data migration](03-migration.md): migration process and source data requirements.
- [Changelog](../CHANGELOG.md): release history.

## License

[MIT](../LICENSE) © 2026 Zheng Li.
