use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::Style;
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::theme::ThemeColors;

/// Render the search bar / breadcrumb row (Row 1).
pub fn draw(frame: &mut Frame, area: Rect, breadcrumb: &str, tc: &ThemeColors) {
	let line = Paragraph::new(Line::from(vec![
		Span::styled(" ", Style::default()),
		Span::styled(breadcrumb.to_string(), Style::default().fg(tc.muted)),
	]))
	.style(Style::default().bg(tc.bg));
	frame.render_widget(line, area);
}

#[cfg(test)]
mod tests {
	use super::*;
	use ratatui::Terminal;
	use ratatui::backend::TestBackend;

	use crate::app::Theme;

	#[test]
	fn render_breadcrumb() {
		let backend = TestBackend::new(60, 1);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		terminal
			.draw(|f| draw(f, f.area(), "版块 > 校园", &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains(">"));
	}
}
