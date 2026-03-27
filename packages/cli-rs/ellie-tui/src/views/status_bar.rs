use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::app::{App, InputMode, ViewState};
use crate::theme::ThemeColors;

/// Render the status bar (Row 3): mode indicator + key hints + status message.
pub fn draw(frame: &mut Frame, area: Rect, app: &App, tc: &ThemeColors) {
	let mode_span = match app.input_mode {
		InputMode::Normal => Span::styled(
			" NORMAL ",
			Style::default()
				.fg(tc.bg)
				.bg(tc.accent)
				.add_modifier(Modifier::BOLD),
		),
		InputMode::Search => {
			let query = match &app.current_view {
				ViewState::Forums { list } => &list.search_query,
				ViewState::Threads { list, .. } => &list.search_query,
				ViewState::Posts { list, .. } => &list.search_query,
				ViewState::User { .. } => "",
			};
			Span::styled(
				format!(" SEARCH: {query}█ "),
				Style::default()
					.fg(tc.bg)
					.bg(tc.highlight)
					.add_modifier(Modifier::BOLD),
			)
		}
		InputMode::Login => Span::styled(
			" LOGIN ",
			Style::default()
				.fg(tc.bg)
				.bg(tc.error)
				.add_modifier(Modifier::BOLD),
		),
	};

	let hints = match app.input_mode {
		InputMode::Normal => " j/k:移动 Enter:进入 /:搜索 q:退出",
		InputMode::Search => " Enter/Esc:退出搜索",
		InputMode::Login => " Tab:切换字段 Enter:提交 Esc:取消",
	};

	let status_msg = app
		.status_message
		.as_deref()
		.map(|s| format!("  {s}"))
		.unwrap_or_default();

	let line = Line::from(vec![
		mode_span,
		Span::styled(hints, Style::default().fg(tc.muted)),
		Span::styled(status_msg, Style::default().fg(tc.accent)),
	]);

	let bar = Paragraph::new(line).style(Style::default().bg(tc.bg));
	frame.render_widget(bar, area);
}
