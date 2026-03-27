pub mod actions;
pub mod app;
pub mod events;
pub mod theme;
pub mod ui;
pub mod views;

use std::io;
use std::panic;

use anyhow::Result;
use clap::Parser;
use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::execute;
use crossterm::terminal::{
	EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ellie_core::config::Config;
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;

use crate::actions::dispatch_pending_action;
use crate::app::App;
use crate::events::{handle_key_event, poll_key_event};

/// Ellie Forum — TUI client for 同济网
#[derive(Parser)]
#[command(name = "ellie", version, about)]
struct Cli {
	/// Path to config file (default: ~/.config/ellie/config.json)
	#[arg(short, long)]
	config: Option<std::path::PathBuf>,

	/// API key for authentication (overrides config file and ELLIE_API_KEY env var)
	#[arg(long)]
	api_key: Option<String>,

	/// API base URL (overrides config file and ELLIE_API_URL env var)
	#[arg(long)]
	api_url: Option<String>,
}

fn main() -> Result<()> {
	let cli = Cli::parse();

	// Load config: file → env var overrides (in Config::load) → CLI arg overrides
	let mut config = Config::load(cli.config.as_ref());

	// CLI args have highest priority
	if let Some(key) = cli.api_key {
		config.api_key = key;
	}
	if let Some(url) = cli.api_url {
		config.api_url = url;
	}

	// Validate: API key is required for all API calls
	if config.api_key.is_empty() {
		eprintln!("error: no API key configured\n");
		eprintln!("Set one of:");
		eprintln!("  --api-key <KEY>");
		eprintln!("  ELLIE_API_KEY=<KEY>");
		if let Some(path) = Config::config_path() {
			eprintln!("  \"apiKey\" in {}", path.display());
		}
		std::process::exit(1);
	}

	let mut app = App::new(config);

	// Setup terminal
	enable_raw_mode()?;
	let mut stdout = io::stdout();
	execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
	let backend = CrosstermBackend::new(stdout);
	let mut terminal = Terminal::new(backend)?;

	// Install panic handler that restores terminal before printing panic
	let default_hook = panic::take_hook();
	panic::set_hook(Box::new(move |info| {
		let _ = disable_raw_mode();
		let _ = execute!(io::stdout(), LeaveAlternateScreen, DisableMouseCapture);
		default_hook(info);
	}));

	// Main event loop
	let result = run_loop(&mut terminal, &mut app);

	// Restore terminal
	disable_raw_mode()?;
	execute!(
		terminal.backend_mut(),
		LeaveAlternateScreen,
		DisableMouseCapture
	)?;
	terminal.show_cursor()?;

	result
}

fn run_loop(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>, app: &mut App) -> Result<()> {
	loop {
		// Dispatch any pending network actions (blocking I/O)
		dispatch_pending_action(app);

		// Draw
		terminal.draw(|frame| ui::draw(frame, app))?;

		// Poll for key events (50ms timeout)
		if let Some(key) = poll_key_event() {
			handle_key_event(app, key);
		}

		if app.should_quit {
			return Ok(());
		}
	}
}
