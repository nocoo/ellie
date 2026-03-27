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

use crate::app::App;
use crate::events::{handle_key_event, poll_key_event};

/// Ellie Forum — TUI client for 同济网
#[derive(Parser)]
#[command(name = "ellie", version, about)]
struct Cli {
	/// Path to config file (default: ~/.config/ellie/config.json)
	#[arg(short, long)]
	config: Option<std::path::PathBuf>,
}

fn main() -> Result<()> {
	let cli = Cli::parse();

	// Load config
	let config = Config::load(cli.config.as_ref());
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
