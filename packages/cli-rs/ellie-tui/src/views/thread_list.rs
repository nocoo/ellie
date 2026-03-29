use ellie_core::types::{StickyLevel, Thread};
use ratatui::Frame;
use ratatui::layout::{Constraint, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{
	Cell, Paragraph, Row, Scrollbar, ScrollbarOrientation, ScrollbarState, Table, TableState,
};

use crate::theme::ThemeColors;
use crate::views::{format_timestamp, truncate_to_width};

/// Render the thread list as a table with proper column alignment.
pub fn draw(
	frame: &mut Frame,
	area: Rect,
	threads: &[Thread],
	table_state: &mut TableState,
	loading: bool,
	tc: &ThemeColors,
) {
	// Empty / loading state
	if threads.is_empty() {
		let msg = if loading {
			"  Loading threads..."
		} else {
			"  No threads in this forum"
		};
		let p = Paragraph::new(Span::styled(msg, Style::default().fg(tc.muted)))
			.style(Style::default().bg(tc.bg));
		frame.render_widget(p, area);
		return;
	}

	// Column widths: subject(flex) | author(12) | time(21) | replies(8) | views(8)
	let fixed_cols = 12 + 21 + 8 + 8 + 6; // 6 for padding/spacing
	let subject_width = (area.width as usize).saturating_sub(fixed_cols);

	let rows: Vec<Row> = threads
		.iter()
		.map(|thread| {
			let mut style = Style::default().fg(tc.fg);

			// Sticky threads get special colour
			if thread.sticky != StickyLevel::None {
				style = style.fg(tc.sticky);
			}
			if thread.digest != 0 {
				style = style.fg(tc.digest);
			}

			let prefix = match thread.sticky {
				StickyLevel::None => "",
				_ => "[置顶] ",
			};
			let subject_raw = format!("{prefix}{}", thread.subject);
			let subject = truncate_to_width(&subject_raw, subject_width);

			Row::new(vec![
				Cell::from(Line::from(Span::styled(subject, style))),
				Cell::from(Line::from(Span::styled(
					truncate_to_width(&thread.author_name, 12),
					Style::default().fg(tc.muted),
				))),
				Cell::from(Line::from(Span::styled(
					format_timestamp(thread.created_at),
					Style::default().fg(tc.muted),
				))),
				Cell::from(Line::from(Span::styled(
					format!("{:>6}", thread.replies),
					Style::default().fg(tc.muted),
				))),
				Cell::from(Line::from(Span::styled(
					format!("{:>6}", thread.views),
					Style::default().fg(tc.muted),
				))),
			])
		})
		.collect();

	let header_style = Style::default().fg(tc.muted).add_modifier(Modifier::BOLD);
	let header = Row::new(vec![
		Cell::from(Span::styled("  标题", header_style)),
		Cell::from(Span::styled("作者", header_style)),
		Cell::from(Span::styled("发布时间", header_style)),
		Cell::from(Span::styled("回复", header_style)),
		Cell::from(Span::styled("浏览", header_style)),
	]);

	let widths = [
		Constraint::Min(20),
		Constraint::Length(12),
		Constraint::Length(21),
		Constraint::Length(8),
		Constraint::Length(8),
	];

	let row_count = rows.len();
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

	// Scrollbar on the right when content overflows
	let visible_rows = area.height.saturating_sub(1) as usize; // minus header
	if row_count > visible_rows {
		let mut scrollbar_state =
			ScrollbarState::new(row_count).position(table_state.selected().unwrap_or(0));
		frame.render_stateful_widget(
			Scrollbar::new(ScrollbarOrientation::VerticalRight)
				.begin_symbol(Some("↑"))
				.end_symbol(Some("↓")),
			area,
			&mut scrollbar_state,
		);
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use ratatui::Terminal;
	use ratatui::backend::TestBackend;

	use crate::app::Theme;

	fn dummy_thread(id: u64, subject: &str) -> Thread {
		Thread {
			id,
			forum_id: 1,
			subject: subject.to_string(),
			author_id: 1,
			author_name: "user".to_string(),
			created_at: 1711540800,
			views: 0,
			replies: 0,
			last_post_at: 0,
			last_poster: "user".to_string(),
			sticky: StickyLevel::None,
			digest: 0,
			closed: 0,
			special: 0,
			highlight: 0,
			recommends: 0,
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
		assert!(text.contains("Loading threads"));
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
		assert!(text.contains("No threads"));
	}

	#[test]
	fn render_thread_items() {
		let backend = TestBackend::new(120, 5);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let threads = vec![dummy_thread(1, "Hello world"), dummy_thread(2, "Rust tips")];
		let mut ts = TableState::default();
		ts.select(Some(0));
		terminal
			.draw(|f| draw(f, f.area(), &threads, &mut ts, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("Hello world"));
		assert!(text.contains("Rust tips"));
		// Should contain formatted timestamp
		assert!(text.contains("2024/"));
	}

	#[test]
	fn render_sticky_thread() {
		let backend = TestBackend::new(120, 4);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let mut t = dummy_thread(1, "Important");
		t.sticky = StickyLevel::Global;
		let mut ts = TableState::default();
		terminal
			.draw(|f| draw(f, f.area(), &[t], &mut ts, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("Important"));
		assert!(text.contains("["));
	}

	#[test]
	fn render_header_has_time_column() {
		let backend = TestBackend::new(120, 4);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let threads = vec![dummy_thread(1, "Test")];
		let mut ts = TableState::default();
		terminal
			.draw(|f| draw(f, f.area(), &threads, &mut ts, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let symbols: Vec<&str> = buf.iter().map(|c| c.symbol()).collect();
		// CJK chars in TestBackend occupy 2 cells, so check individual chars
		assert!(symbols.contains(&"发"));
		assert!(symbols.contains(&"布"));
		assert!(symbols.contains(&"时"));
		assert!(symbols.contains(&"间"));
	}
}
