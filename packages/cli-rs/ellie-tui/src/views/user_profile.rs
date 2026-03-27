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
	let text = if let Some(user) = current_user {
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
