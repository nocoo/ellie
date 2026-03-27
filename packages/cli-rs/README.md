# Ellie CLI — TUI Forum Client

A terminal-based TUI client for browsing the Tongji Network (同济网) forum, built with Rust using [ratatui](https://ratatui.rs) and [crossterm](https://github.com/crossterm-rs/crossterm).

## Features

- Browse forums, threads, and posts in a full-screen TUI
- Cursor-based pagination with `n` to load more
- Search/filter with `/`
- Optional login for authenticated content
- Three built-in themes: Default, Dracula, Nord
- Vim-style keybindings
- Help panel (`?`)

## Architecture

```
packages/cli-rs/
├── ellie-core/        # Library crate: API client, types, config
│   ├── src/
│   │   ├── client.rs    # HTTP client with retry + auth
│   │   ├── config.rs    # XDG config persistence
│   │   ├── pagination.rs # Cursor encode/decode
│   │   └── types.rs     # Domain structs (Forum, Thread, Post, User)
│   └── tests/
│       └── integration.rs  # L2 E2E tests (run with --ignored)
├── ellie-tui/         # Binary crate: TUI application
│   └── src/
│       ├── main.rs      # Entry point, terminal setup
│       ├── app.rs       # App state, view stack, input modes
│       ├── events.rs    # Keyboard event handlers
│       ├── actions.rs   # Network I/O dispatch (PendingAction)
│       ├── theme.rs     # ThemeColors for Default/Dracula/Nord
│       ├── ui.rs        # 4-zone layout coordinator
│       └── views/       # View components
│           ├── forum_list.rs
│           ├── thread_list.rs
│           ├── post_view.rs
│           ├── user_profile.rs
│           ├── login_form.rs
│           ├── help_panel.rs
│           ├── status_bar.rs
│           └── search_bar.rs
└── scripts/
    └── coverage.sh     # Coverage report (90% threshold)
```

## Keybindings

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `g` | Jump to top |
| `G` | Jump to bottom |
| `Enter` | Open selected item |
| `Esc` / `Backspace` | Go back |
| `n` | Load next page |
| `r` | Refresh current view |
| `/` | Search / filter |
| `u` | View author profile |
| `L` | Login |
| `t` | Cycle theme |
| `?` | Toggle help |
| `q` / `Ctrl+C` | Quit |

## Setup

```bash
# Prerequisites
rustup update stable
rustup component add llvm-tools-preview  # for coverage
cargo install cargo-llvm-cov             # optional: coverage tool

# Build
cargo build --release

# Run
cargo run --bin ellie-tui
```

## Configuration

Config is stored in XDG config directory (`~/.config/ellie/config.toml`):

```toml
api_url = "https://ellie.worker.hexly.ai"
api_key = "<client-credential>"
theme = "default"
```

## Testing

```bash
# L1: Unit tests (132 tests)
cargo test --workspace

# L2: Integration tests (requires test Worker + env vars)
ELLIE_API_URL=<test-url> ELLIE_API_KEY=<key> cargo test --test integration -- --ignored

# G1: Lint + format
cargo clippy --workspace -- -D warnings
cargo fmt --all --check

# Coverage report (90% threshold)
./scripts/coverage.sh
./scripts/coverage.sh --html  # also generate HTML report
```

## Quality Dimensions

| Dimension | Tool | Threshold |
|-----------|------|-----------|
| L1 Unit | `cargo test` + `cargo-llvm-cov` | ≥ 90% line coverage |
| L2 Integration | `cargo test --test integration -- --ignored` | All pass |
| G1 Lint | `cargo clippy -- -D warnings` + `cargo fmt --check` | Zero warnings |
| G2 Security | `osv-scanner` + `gitleaks` | Zero findings |
| D1 Isolation | `GET /api/live` environment check | Must be "test" |
