use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::app::{App, InputMode, ViewState};
use crate::views;

/// Render the full 4-zone layout.
pub fn draw(frame: &mut Frame, app: &App) {
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
	draw_content(frame, chunks[2], app, &tc);
	views::status_bar::draw(frame, chunks[3], app, &tc);

	// Overlay: login form
	if app.input_mode == InputMode::Login {
		views::login_form::draw(frame, &app.login_form, &tc);
	}
}

// ─── Row 0: Header ──────────────────────────────────────

fn draw_header(frame: &mut Frame, area: Rect, app: &App, tc: &crate::theme::ThemeColors) {
	let title = Span::styled(
		" Ellie Forum — 同济网 ",
		Style::default().fg(tc.accent).add_modifier(Modifier::BOLD),
	);

	let auth = if let Some(user) = &app.logged_in_user {
		Span::styled(format!("[{}] ", user.username), Style::default().fg(tc.fg))
	} else {
		Span::styled("[未登录] ", Style::default().fg(tc.muted))
	};

	// Right-align auth by padding
	let title_len = 22; // approximate CJK + emoji width
	let auth_len = auth.content.len();
	let padding = area.width.saturating_sub((title_len + auth_len) as u16);
	let pad = " ".repeat(padding as usize);

	let line = Line::from(vec![title, Span::raw(pad), auth]);
	let header = Paragraph::new(line).style(Style::default().bg(tc.bg).fg(tc.fg));
	frame.render_widget(header, area);
}

// ─── Row 2: Content ─────────────────────────────────────

fn draw_content(frame: &mut Frame, area: Rect, app: &App, tc: &crate::theme::ThemeColors) {
	match &app.current_view {
		ViewState::Forums { list } => {
			views::forum_list::draw(frame, area, &app.forums, list, tc);
		}
		ViewState::Threads { list, .. } => {
			views::thread_list::draw(frame, area, &app.threads, list, tc);
		}
		ViewState::Posts { list, .. } => {
			views::post_view::draw(frame, area, &app.posts, list, tc);
		}
		ViewState::User { user_id } => {
			views::user_profile::draw(frame, area, *user_id, app.current_user.as_ref(), tc);
		}
	}
}
