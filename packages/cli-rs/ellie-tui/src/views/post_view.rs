use ellie_core::types::Post;
use ratatui::Frame;
use ratatui::layout::{Constraint, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Cell, Paragraph, Row, Table, TableState};

use crate::theme::ThemeColors;
use crate::views::{format_timestamp, strip_markup, truncate_to_width};

/// Render the post list as a table with position | author | time | content columns.
pub fn draw(
	frame: &mut Frame,
	area: Rect,
	posts: &[Post],
	table_state: &mut TableState,
	loading: bool,
	tc: &ThemeColors,
) {
	// Empty / loading state
	if posts.is_empty() {
		let msg = if loading {
			"  Loading posts..."
		} else {
			"  No posts in this thread"
		};
		let p = Paragraph::new(Span::styled(msg, Style::default().fg(tc.muted)))
			.style(Style::default().bg(tc.bg));
		frame.render_widget(p, area);
		return;
	}

	// Column widths: position(6) | author(14) | time(21) | content(flex)
	let fixed_cols = 6 + 14 + 21 + 6; // 6 for padding/spacing
	let content_width = (area.width as usize).saturating_sub(fixed_cols);

	let rows: Vec<Row> = posts
		.iter()
		.map(|post| {
			let cleaned = strip_markup(&post.content);
			let preview_line = cleaned.lines().next().unwrap_or("");
			let preview = truncate_to_width(preview_line, content_width);

			Row::new(vec![
				Cell::from(Line::from(Span::styled(
					format!("#{}", post.position),
					Style::default().fg(tc.muted),
				))),
				Cell::from(Line::from(Span::styled(
					truncate_to_width(&post.author_name, 12),
					Style::default().fg(tc.accent),
				))),
				Cell::from(Line::from(Span::styled(
					format_timestamp(post.created_at),
					Style::default().fg(tc.muted),
				))),
				Cell::from(Line::from(Span::styled(
					preview,
					Style::default().fg(tc.fg),
				))),
			])
		})
		.collect();

	let header_style = Style::default().fg(tc.muted).add_modifier(Modifier::BOLD);
	let header = Row::new(vec![
		Cell::from(Span::styled("  楼层", header_style)),
		Cell::from(Span::styled("作者", header_style)),
		Cell::from(Span::styled("发布时间", header_style)),
		Cell::from(Span::styled("内容", header_style)),
	]);

	let widths = [
		Constraint::Length(6),
		Constraint::Length(14),
		Constraint::Length(21),
		Constraint::Min(20),
	];

	let table = Table::new(rows, widths)
		.header(header)
		.row_highlight_style(
			Style::default()
				.fg(tc.highlight)
				.add_modifier(Modifier::BOLD),
		)
		.highlight_symbol("▸ ")
		.style(Style::default().bg(tc.bg).fg(tc.fg));

	frame.render_stateful_widget(table, area, table_state);
}

#[cfg(test)]
mod tests {
	use super::*;
	use ratatui::Terminal;
	use ratatui::backend::TestBackend;

	use crate::app::Theme;

	fn dummy_post(id: u64, content: &str) -> Post {
		Post {
			id,
			thread_id: 1,
			forum_id: 1,
			content: content.to_string(),
			author_id: 1,
			author_name: "alice".to_string(),
			position: 1,
			created_at: 1711540800,
			is_first: true,
		}
	}

	#[test]
	fn render_loading_state() {
		let backend = TestBackend::new(60, 3);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let mut ts = TableState::default();
		terminal
			.draw(|f| draw(f, f.area(), &[], &mut ts, true, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("Loading posts"));
	}

	#[test]
	fn render_empty_state() {
		let backend = TestBackend::new(60, 3);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let mut ts = TableState::default();
		terminal
			.draw(|f| draw(f, f.area(), &[], &mut ts, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("No posts"));
	}

	#[test]
	fn render_post_items() {
		let backend = TestBackend::new(120, 5);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let posts = vec![
			dummy_post(1, "Hello this is a post"),
			dummy_post(2, "Another reply"),
		];
		let mut ts = TableState::default();
		ts.select(Some(0));
		terminal
			.draw(|f| draw(f, f.area(), &posts, &mut ts, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("alice"));
		assert!(text.contains("Hello this is a post"));
		// Position should appear as #1
		assert!(text.contains("#1"));
	}

	#[test]
	fn render_strips_markup() {
		let backend = TestBackend::new(120, 4);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let posts = vec![dummy_post(1, "<b>bold</b> [i]italic[/i] :laugh: text")];
		let mut ts = TableState::default();
		ts.select(Some(0));
		terminal
			.draw(|f| draw(f, f.area(), &posts, &mut ts, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		// Should not contain raw tags
		assert!(!text.contains("<b>"));
		assert!(!text.contains("[i]"));
		// Emoji should be present
		assert!(text.contains('😄'));
	}

	#[test]
	fn render_header_position_first() {
		let backend = TestBackend::new(120, 4);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let posts = vec![dummy_post(1, "Test")];
		let mut ts = TableState::default();
		terminal
			.draw(|f| draw(f, f.area(), &posts, &mut ts, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let symbols: Vec<&str> = buf.iter().map(|c| c.symbol()).collect();
		// CJK chars in TestBackend occupy 2 cells, so check individual chars
		assert!(symbols.contains(&"楼"));
		assert!(symbols.contains(&"层"));
		assert!(symbols.contains(&"发"));
		assert!(symbols.contains(&"时"));
	}
}
