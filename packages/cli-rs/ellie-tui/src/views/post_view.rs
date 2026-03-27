use ellie_core::types::Post;
use ratatui::Frame;
use ratatui::layout::{Constraint, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Cell, Paragraph, Row, Table, TableState};

use crate::theme::ThemeColors;
use crate::views::truncate_to_width;

/// Render the post list as a table with author + content preview columns.
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

	// Dynamic content preview width = total width - author(14) - position(6) - padding(4)
	let content_width = (area.width as usize).saturating_sub(24);

	let rows: Vec<Row> = posts
		.iter()
		.map(|post| {
			let preview = post.content.lines().next().unwrap_or("");
			let preview = truncate_to_width(preview, content_width);

			Row::new(vec![
				Cell::from(Line::from(Span::styled(
					truncate_to_width(&post.author_name, 12),
					Style::default().fg(tc.accent),
				))),
				Cell::from(Line::from(Span::styled(
					preview,
					Style::default().fg(tc.fg),
				))),
				Cell::from(Line::from(Span::styled(
					format!("#{}", post.position),
					Style::default().fg(tc.muted),
				))),
			])
		})
		.collect();

	let header = Row::new(vec![
		Cell::from(Span::styled(
			"  作者",
			Style::default().fg(tc.muted).add_modifier(Modifier::BOLD),
		)),
		Cell::from(Span::styled(
			"内容",
			Style::default().fg(tc.muted).add_modifier(Modifier::BOLD),
		)),
		Cell::from(Span::styled(
			" 楼层",
			Style::default().fg(tc.muted).add_modifier(Modifier::BOLD),
		)),
	]);

	let widths = [
		Constraint::Length(14),
		Constraint::Min(20),
		Constraint::Length(6),
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
			created_at: 0,
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
		let backend = TestBackend::new(80, 5);
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
	}
}
