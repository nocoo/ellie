use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};

use crate::app::LoginFormState;
use crate::theme::ThemeColors;

/// Render the login form as a centered overlay.
pub fn draw(frame: &mut Frame, form: &LoginFormState, tc: &ThemeColors) {
	let area = centered_rect(40, 9, frame.area());

	// Clear the area behind the overlay
	frame.render_widget(Clear, area);

	let block = Block::default()
		.title(" Login ")
		.borders(Borders::ALL)
		.border_style(Style::default().fg(tc.accent))
		.style(Style::default().bg(tc.bg));

	let inner = block.inner(area);
	frame.render_widget(block, area);

	// Layout: username label + input, password label + input, error
	let chunks = Layout::default()
		.direction(Direction::Vertical)
		.constraints([
			Constraint::Length(1), // username label
			Constraint::Length(1), // username input
			Constraint::Length(1), // password label
			Constraint::Length(1), // password input
			Constraint::Length(1), // spacer
			Constraint::Length(1), // error message
		])
		.split(inner);

	// Username
	let username_label_style = if form.focus == 0 {
		Style::default().fg(tc.accent).add_modifier(Modifier::BOLD)
	} else {
		Style::default().fg(tc.muted)
	};
	let username_label =
		Paragraph::new(Line::from(Span::styled(" Username:", username_label_style)));
	frame.render_widget(username_label, chunks[0]);

	let cursor = if form.focus == 0 { "█" } else { "" };
	let username_input = Paragraph::new(Line::from(vec![
		Span::styled(format!(" {}", form.username), Style::default().fg(tc.fg)),
		Span::styled(cursor, Style::default().fg(tc.accent)),
	]));
	frame.render_widget(username_input, chunks[1]);

	// Password
	let password_label_style = if form.focus == 1 {
		Style::default().fg(tc.accent).add_modifier(Modifier::BOLD)
	} else {
		Style::default().fg(tc.muted)
	};
	let password_label =
		Paragraph::new(Line::from(Span::styled(" Password:", password_label_style)));
	frame.render_widget(password_label, chunks[2]);

	let masked: String = "•".repeat(form.password.len());
	let cursor = if form.focus == 1 { "█" } else { "" };
	let password_input = Paragraph::new(Line::from(vec![
		Span::styled(format!(" {masked}"), Style::default().fg(tc.fg)),
		Span::styled(cursor, Style::default().fg(tc.accent)),
	]));
	frame.render_widget(password_input, chunks[3]);

	// Error
	if let Some(err) = &form.error {
		let error_line = Paragraph::new(Line::from(Span::styled(
			format!(" {err}"),
			Style::default().fg(tc.error),
		)));
		frame.render_widget(error_line, chunks[5]);
	}
}

/// Create a centered rectangle of given width (columns) and height (rows).
pub fn centered_rect(width: u16, height: u16, area: Rect) -> Rect {
	let x = area.x + area.width.saturating_sub(width) / 2;
	let y = area.y + area.height.saturating_sub(height) / 2;
	Rect::new(x, y, width.min(area.width), height.min(area.height))
}

#[cfg(test)]
mod tests {
	use super::*;
	use ratatui::Terminal;
	use ratatui::backend::TestBackend;

	use crate::app::Theme;

	fn buf_text(terminal: &Terminal<TestBackend>) -> String {
		terminal
			.backend()
			.buffer()
			.content()
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect()
	}

	#[test]
	fn centered_rect_basic() {
		let area = Rect::new(0, 0, 80, 24);
		let r = centered_rect(40, 10, area);
		assert_eq!(r.x, 20);
		assert_eq!(r.y, 7);
		assert_eq!(r.width, 40);
		assert_eq!(r.height, 10);
	}

	#[test]
	fn centered_rect_larger_than_area() {
		let area = Rect::new(0, 0, 20, 10);
		let r = centered_rect(40, 20, area);
		// Clamped to area dimensions
		assert_eq!(r.width, 20);
		assert_eq!(r.height, 10);
	}

	#[test]
	fn render_login_form_shows_fields() {
		let backend = TestBackend::new(80, 24);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let form = LoginFormState {
			username: "alice".to_string(),
			..Default::default()
		};
		terminal.draw(|f| draw(f, &form, &tc)).unwrap();
		let text = buf_text(&terminal);
		assert!(text.contains("Login"));
		assert!(text.contains("Username"));
		assert!(text.contains("alice"));
	}

	#[test]
	fn render_login_form_shows_error() {
		let backend = TestBackend::new(80, 24);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let form = LoginFormState {
			error: Some("bad credentials".to_string()),
			..Default::default()
		};
		terminal.draw(|f| draw(f, &form, &tc)).unwrap();
		let text = buf_text(&terminal);
		assert!(text.contains("bad credentials"));
	}
}
