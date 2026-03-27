use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use unicode_width::UnicodeWidthStr;

use crate::app::{App, InputMode, ViewState};
use crate::views;

/// Render the full 4-zone layout.
pub fn draw(frame: &mut Frame, app: &mut App) {
	let tc = app.theme.colors();

	// 4-zone vertical layout: Header(1) | Breadcrumb(1) | Content(flex) | Status(1)
	let chunks = Layout::default()
		.direction(Direction::Vertical)
		.constraints([
			Constraint::Length(1), // Header
			Constraint::Length(1), // Breadcrumb
			Constraint::Min(1),    // Content
			Constraint::Length(1), // Status bar
		])
		.split(frame.area());

	draw_header(frame, chunks[0], app, &tc);
	views::search_bar::draw(frame, chunks[1], &app.breadcrumb(), &tc);
	app.content_height = chunks[2].height;
	draw_content(frame, chunks[2], app, &tc);
	views::status_bar::draw(frame, chunks[3], app, &tc);

	// Overlay: login form
	if app.input_mode == InputMode::Login {
		views::login_form::draw(frame, &app.login_form, &tc);
	}

	// Overlay: help panel
	if app.input_mode == InputMode::Help {
		views::help_panel::draw(frame, &tc);
	}
}

// ─── Row 0: Header ──────────────────────────────────────

fn draw_header(frame: &mut Frame, area: Rect, app: &App, tc: &crate::theme::ThemeColors) {
	let title_text = " 同济网 ";
	let title = Span::styled(
		title_text,
		Style::default().fg(tc.accent).add_modifier(Modifier::BOLD),
	);

	let auth = if let Some(user) = &app.logged_in_user {
		Span::styled(format!("[{}] ", user.username), Style::default().fg(tc.fg))
	} else {
		Span::styled("[未登录] ", Style::default().fg(tc.muted))
	};

	// Right-align auth by padding
	let title_width = UnicodeWidthStr::width(title_text);
	let auth_width = UnicodeWidthStr::width(&*auth.content);
	let padding = (area.width as usize).saturating_sub(title_width + auth_width);
	let pad = " ".repeat(padding);

	let line = Line::from(vec![title, Span::raw(pad), auth]);
	let header = Paragraph::new(line).style(Style::default().bg(tc.bg).fg(tc.fg));
	frame.render_widget(header, area);
}

// ─── Row 2: Content ─────────────────────────────────────

fn draw_content(frame: &mut Frame, area: Rect, app: &mut App, tc: &crate::theme::ThemeColors) {
	match &mut app.current_view {
		ViewState::Forums { table_state, .. } => {
			views::forum_list::draw(frame, area, &app.forums, table_state, app.loading, tc);
		}
		ViewState::Threads { table_state, .. } => {
			views::thread_list::draw(frame, area, &app.threads, table_state, app.loading, tc);
		}
		ViewState::Posts { table_state, .. } => {
			views::post_view::draw(frame, area, &app.posts, table_state, app.loading, tc);
		}
		ViewState::User { user_id } => {
			let user_id = *user_id;
			views::user_profile::draw(frame, area, user_id, app.current_user.as_ref(), tc);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use ellie_core::config::Config;
	use ratatui::Terminal;
	use ratatui::backend::TestBackend;

	fn buf_text(terminal: &Terminal<TestBackend>) -> String {
		terminal
			.backend()
			.buffer()
			.content()
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect()
	}

	fn buf_symbols(terminal: &Terminal<TestBackend>) -> Vec<String> {
		terminal
			.backend()
			.buffer()
			.content()
			.iter()
			.map(|c| c.symbol().to_string())
			.collect()
	}

	#[test]
	fn draw_full_layout_default() {
		let backend = TestBackend::new(80, 24);
		let mut terminal = Terminal::new(backend).unwrap();
		let mut app = App::new(Config::default_config());
		terminal.draw(|f| draw(f, &mut app)).unwrap();
		let symbols = buf_symbols(&terminal);
		// CJK chars in TestBackend split across 2 cells; check individual chars
		assert!(symbols.contains(&"同".to_string()));
		assert!(symbols.contains(&"济".to_string()));
		assert!(symbols.contains(&"网".to_string()));
		let text = buf_text(&terminal);
		assert!(text.contains("NORMAL"));
	}

	#[test]
	fn draw_login_overlay() {
		let backend = TestBackend::new(80, 24);
		let mut terminal = Terminal::new(backend).unwrap();
		let mut app = App::new(Config::default_config());
		app.input_mode = InputMode::Login;
		terminal.draw(|f| draw(f, &mut app)).unwrap();
		let text = buf_text(&terminal);
		assert!(text.contains("Login"));
		assert!(text.contains("Username"));
	}

	#[test]
	fn draw_help_overlay() {
		let backend = TestBackend::new(80, 24);
		let mut terminal = Terminal::new(backend).unwrap();
		let mut app = App::new(Config::default_config());
		app.input_mode = InputMode::Help;
		terminal.draw(|f| draw(f, &mut app)).unwrap();
		let text = buf_text(&terminal);
		assert!(text.contains("Help"));
		assert!(text.contains("Keybindings"));
	}
}
