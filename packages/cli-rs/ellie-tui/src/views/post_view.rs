use ellie_core::types::Post;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Scrollbar, ScrollbarOrientation, ScrollbarState};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::theme::ThemeColors;
use crate::views::{format_timestamp, truncate_to_width};

/// Render posts as scrollable "cards" with full content.
pub fn draw(
	frame: &mut Frame,
	area: Rect,
	posts: &[Post],
	scroll_offset: u16,
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

	// Build all post cards as lines
	let lines = build_post_lines(posts, area.width as usize, tc);

	// Render scrollable paragraph
	let paragraph = Paragraph::new(lines)
		.scroll((scroll_offset, 0))
		.style(Style::default().bg(tc.bg).fg(tc.fg));
	frame.render_widget(paragraph, area);

	// Scrollbar on the right when content overflows
	let total_lines = total_content_lines(posts, area.width as usize);
	if total_lines > area.height as usize {
		let mut scrollbar_state =
			ScrollbarState::new(total_lines).position(scroll_offset as usize);
		frame.render_stateful_widget(
			Scrollbar::new(ScrollbarOrientation::VerticalRight)
				.begin_symbol(Some("↑"))
				.end_symbol(Some("↓")),
			area,
			&mut scrollbar_state,
		);
	}
}

/// Compute total rendered line count for scroll clamping.
pub fn total_content_lines(posts: &[Post], width: usize) -> usize {
	if posts.is_empty() {
		return 0;
	}
	let mut count = 0;
	for (i, post) in posts.iter().enumerate() {
		count += post_card_line_count(&post.content, width);
		// Add separator after each post except the last
		if i < posts.len() - 1 {
			count += 1;
		}
	}
	count
}

/// Determine which post is at a given scroll position.
/// Returns the index of the post whose card contains the offset.
pub fn post_index_at_scroll(posts: &[Post], scroll_offset: u16, width: usize) -> usize {
	let mut current_offset = 0;
	for (idx, post) in posts.iter().enumerate() {
		let card_lines = post_card_line_count(&post.content, width);
		if current_offset + card_lines > scroll_offset as usize {
			return idx;
		}
		current_offset += card_lines;
		// Add separator after each post except the last
		if idx < posts.len() - 1 {
			current_offset += 1;
		}
	}
	posts.len().saturating_sub(1)
}

/// Count lines in a single post card (including borders, no separator).
fn post_card_line_count(content: &str, width: usize) -> usize {
	// Top border: 1 line
	// Title: 1 line
	// Content: wrapped content
	// Bottom border: 1 line
	// Note: separator is added between posts, not counted here
	let content_lines = wrap_text(content, width.saturating_sub(4)); // -4 for │ padding
	3 + content_lines.len()
}

/// Build all post cards as styled lines with ASCII borders.
fn build_post_lines<'a>(posts: &[Post], width: usize, tc: &'a ThemeColors) -> Vec<Line<'a>> {
	let mut lines = Vec::new();

	for (i, post) in posts.iter().enumerate() {
		// Skip separator for first post
		if i > 0 {
			lines.push(Line::from(""));
		}

		// Top border with title
		let title = format!(
			"#{} {} {}",
			post.position,
			truncate_to_width(&post.author_name, 16),
			format_timestamp(post.created_at)
		);
		let title_len = title.len();
		let top_padding = " ".repeat(width.saturating_sub(title_len + 10));
		let top_border = format!("┌─ {title} {top_padding}─┐");
		lines.push(Line::from(Span::styled(
			top_border,
			Style::default().fg(tc.border),
		)));

		// Title line inside
		let title_padding = " ".repeat(width.saturating_sub(title_len));
		lines.push(Line::from(vec![
			Span::styled("│ ", Style::default().fg(tc.border)),
			Span::styled(
				truncate_to_width(&title, width.saturating_sub(2)),
				Style::default().fg(tc.accent).add_modifier(Modifier::BOLD),
			),
			Span::styled(
				format!("{title_padding} │"),
				Style::default().fg(tc.border),
			),
		]));

		// Content lines
		for content_line in wrap_text(&post.content, width.saturating_sub(4)) {
			// Calculate padding before borrowing content_line
			let content_width = content_line.width();
			let padding = " ".repeat(width.saturating_sub(content_width + 2));
			lines.push(Line::from(vec![
				Span::styled("│ ", Style::default().fg(tc.border)),
				Span::styled(content_line, Style::default().fg(tc.fg)),
				Span::styled(format!("{padding}│"), Style::default().fg(tc.border)),
			]));
		}

		// Bottom border
		let bottom_dash = "─".repeat(width.saturating_sub(4));
		lines.push(Line::from(Span::styled(
			format!("└─{bottom_dash}┘"),
			Style::default().fg(tc.border),
		)));
	}

	lines
}

/// Wrap text to fit within max_width columns, respecting CJK double-width.
fn wrap_text(text: &str, max_width: usize) -> Vec<String> {
	let mut result = Vec::new();
	let mut current_line = String::new();
	let mut current_width = 0;

	for ch in text.chars() {
		let cw = UnicodeWidthChar::width(ch).unwrap_or(1);

		// Handle explicit newlines
		if ch == '\n' {
			result.push(current_line);
			current_line = String::new();
			current_width = 0;
			continue;
		}

		// Check if character fits
		if current_width + cw > max_width && !current_line.is_empty() {
			result.push(current_line);
			current_line = String::new();
			current_width = 0;
		}

		current_line.push(ch);
		current_width += cw;
	}

	if !current_line.is_empty() {
		result.push(current_line);
	}

	result
}

#[cfg(test)]
mod tests {
	use super::*;
	use ratatui::Terminal;
	use ratatui::backend::TestBackend;

	use crate::app::Theme;

	fn dummy_post(id: u64, position: u64, content: &str) -> Post {
		Post {
			id,
			thread_id: 1,
			forum_id: 1,
			content: content.to_string(),
			author_id: 1,
			author_name: "alice".to_string(),
			position,
			created_at: 1711540800,
			is_first: position == 1,
		}
	}

	#[test]
	fn render_loading_state() {
		let backend = TestBackend::new(60, 3);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		terminal
			.draw(|f| draw(f, f.area(), &[], 0, true, &tc))
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
		terminal
			.draw(|f| draw(f, f.area(), &[], 0, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("No posts"));
	}

	#[test]
	fn render_post_cards() {
		let backend = TestBackend::new(60, 10);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let posts = vec![
			dummy_post(1, 1, "First post here"),
			dummy_post(2, 2, "Second reply"),
		];
		terminal
			.draw(|f| draw(f, f.area(), &posts, 0, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let symbols: Vec<&str> = buf.iter().map(|c| c.symbol()).collect();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();

		// Should contain card borders
		assert!(symbols.contains(&"┌"));
		assert!(symbols.contains(&"└"));

		// Should contain content
		assert!(text.contains("First post"));
		assert!(text.contains("Second reply"));
	}

	#[test]
	fn total_content_line_counts_empty() {
		assert_eq!(total_content_lines(&[], 80), 0);
	}

	#[test]
	fn total_content_line_counts_single_post() {
		let post = dummy_post(1, 1, "Short");
		// 1 top + 1 title + 1 content + 1 bottom = 4 lines (no separator for single post)
		assert_eq!(total_content_lines(&[post], 80), 4);
	}

	#[test]
	fn total_content_line_counts_multi_line() {
		let post = dummy_post(1, 1, "A long post that spans multiple lines naturally with\nnewlines");
		let count = total_content_lines(&[post], 40);
		// Should account for the newline in content
		// 4 border lines + 2+ content lines = 6+ total
		assert!(count > 5);
	}

	#[test]
	fn post_index_at_scroll_finds_first_post() {
		let posts = vec![
			dummy_post(1, 1, "First"),
			dummy_post(2, 2, "Second"),
		];
		// Scroll offset 0 should be in first post
		assert_eq!(post_index_at_scroll(&posts, 0, 80), 0);
	}

	#[test]
	fn post_index_at_scroll_clamps_to_last() {
		let posts = vec![
			dummy_post(1, 1, "First"),
			dummy_post(2, 2, "Second"),
		];
		// Large offset should clamp to last post
		assert_eq!(post_index_at_scroll(&posts, 999, 80), 1);
	}

	#[test]
	fn wrap_text_handles_newlines() {
		let result = wrap_text("line1\nline2\nline3", 80);
		assert_eq!(result, vec!["line1", "line2", "line3"]);
	}

	#[test]
	fn wrap_text_truncates_long_words() {
		let result = wrap_text("a", 1);
		assert_eq!(result, vec!["a"]);
	}
}
