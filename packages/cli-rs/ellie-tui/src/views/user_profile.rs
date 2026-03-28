use ellie_core::types::User;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::theme::ThemeColors;

/// Render the user profile view.
pub fn draw(
	frame: &mut Frame,
	area: Rect,
	user_id: u64,
	current_user: Option<&User>,
	tc: &ThemeColors,
) {
	let text = if let Some(user) = current_user.filter(|u| u.id == user_id) {
		let role_str = format!("{:?}", user.role);
		vec![
			Line::from(Span::styled(
				format!("  Username: {}", user.username),
				Style::default().fg(tc.fg),
			)),
			Line::from(Span::styled(
				format!("  Role:     {role_str}"),
				Style::default().fg(tc.accent),
			)),
			Line::from(Span::styled(
				format!("  Posts:    {}", user.posts),
				Style::default().fg(tc.fg),
			)),
			Line::from(Span::styled(
				format!("  Threads:  {}", user.threads),
				Style::default().fg(tc.fg),
			)),
		]
	} else {
		vec![Line::from(Span::styled(
			format!("  Loading user #{user_id}..."),
			Style::default().fg(tc.muted),
		))]
	};

	let profile = Paragraph::new(text).style(Style::default().bg(tc.bg));
	frame.render_widget(profile, area);
}

#[cfg(test)]
mod tests {
	use super::*;
	use ratatui::Terminal;
	use ratatui::backend::TestBackend;

	use crate::app::Theme;

	#[test]
	fn render_loading_user() {
		let backend = TestBackend::new(40, 3);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		terminal.draw(|f| draw(f, f.area(), 42, None, &tc)).unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("Loading user #42"));
	}

	#[test]
	fn render_user_profile() {
		let backend = TestBackend::new(40, 5);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let user = User {
			id: 1,
			username: "alice".to_string(),
			role: ellie_core::types::UserRole::User,
			status: ellie_core::types::UserStatus::Active,
			posts: 42,
			threads: 7,
			credits: 100,
			email: None,
			avatar: String::new(),
			reg_date: 0,
			last_login: 0,
		};
		terminal
			.draw(|f| draw(f, f.area(), 1, Some(&user), &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("alice"));
		assert!(text.contains("42"));
	}

	#[test]
	fn render_mismatched_user_shows_loading() {
		let backend = TestBackend::new(40, 3);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		// user.id=1 but we're viewing user_id=99 → should show loading
		let user = User {
			id: 1,
			username: "alice".to_string(),
			role: ellie_core::types::UserRole::User,
			status: ellie_core::types::UserStatus::Active,
			posts: 42,
			threads: 7,
			credits: 100,
			email: None,
			avatar: String::new(),
			reg_date: 0,
			last_login: 0,
		};
		terminal
			.draw(|f| draw(f, f.area(), 99, Some(&user), &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		// Should NOT show alice's data, should show loading for #99
		assert!(!text.contains("alice"));
		assert!(text.contains("Loading user #99"));
	}
}
