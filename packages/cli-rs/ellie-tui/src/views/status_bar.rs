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
				ViewState::Forums { list, .. } => &list.search_query,
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
		InputMode::Help => Span::styled(
			" HELP ",
			Style::default()
				.fg(tc.bg)
				.bg(tc.highlight)
				.add_modifier(Modifier::BOLD),
		),
	};

	let hints = match app.input_mode {
		InputMode::Normal => " j/k:移动 Enter:进入 /:搜索 ?:帮助 q:退出",
		InputMode::Search => " Enter/Esc:退出搜索",
		InputMode::Login => " Tab:切换字段 Enter:提交 Esc:取消",
		InputMode::Help => " Esc/?/q:关闭帮助",
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

#[cfg(test)]
mod tests {
	use super::*;
	use ellie_core::config::Config;
	use ratatui::Terminal;
	use ratatui::backend::TestBackend;

	use crate::app::{App, Theme};

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
	fn render_normal_mode() {
		let backend = TestBackend::new(80, 1);
		let mut terminal = Terminal::new(backend).unwrap();
		let app = App::new(Config::default_config());
		let tc = Theme::Default.colors();
		terminal.draw(|f| draw(f, f.area(), &app, &tc)).unwrap();
		let text = buf_text(&terminal);
		assert!(text.contains("NORMAL"));
	}

	#[test]
	fn render_search_mode() {
		let backend = TestBackend::new(80, 1);
		let mut terminal = Terminal::new(backend).unwrap();
		let mut app = App::new(Config::default_config());
		app.input_mode = InputMode::Search;
		let tc = Theme::Default.colors();
		terminal.draw(|f| draw(f, f.area(), &app, &tc)).unwrap();
		let text = buf_text(&terminal);
		assert!(text.contains("SEARCH"));
	}

	#[test]
	fn render_help_mode() {
		let backend = TestBackend::new(80, 1);
		let mut terminal = Terminal::new(backend).unwrap();
		let mut app = App::new(Config::default_config());
		app.input_mode = InputMode::Help;
		let tc = Theme::Default.colors();
		terminal.draw(|f| draw(f, f.area(), &app, &tc)).unwrap();
		let text = buf_text(&terminal);
		assert!(text.contains("HELP"));
	}

	#[test]
	fn render_status_message() {
		let backend = TestBackend::new(80, 1);
		let mut terminal = Terminal::new(backend).unwrap();
		let mut app = App::new(Config::default_config());
		app.status_message = Some("loaded 5 forums".to_string());
		let tc = Theme::Default.colors();
		terminal.draw(|f| draw(f, f.area(), &app, &tc)).unwrap();
		let text = buf_text(&terminal);
		assert!(text.contains("loaded 5 forums"));
	}
}
