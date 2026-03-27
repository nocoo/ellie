use ellie_core::types::Post;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};

use crate::app::ListState;
use crate::theme::ThemeColors;
use crate::views::visible_items;

/// Render the post list view.
pub fn draw(
	frame: &mut Frame,
	area: Rect,
	posts: &[Post],
	list_state: &ListState,
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

	let items: Vec<ListItem> = visible_items(posts, list_state)
		.enumerate()
		.map(|(i, post)| {
			let is_selected = i == list_state.selected_row;
			let style = if is_selected {
				Style::default()
					.fg(tc.highlight)
					.add_modifier(Modifier::BOLD)
			} else {
				Style::default().fg(tc.fg)
			};
			let marker = if is_selected { "▸ " } else { "  " };
			// Show first line of content as preview
			let preview = post
				.content
				.lines()
				.next()
				.unwrap_or("")
				.chars()
				.take(60)
				.collect::<String>();
			let line = format!("{}{:<12}  {}", marker, post.author_name, preview);
			ListItem::new(Line::from(Span::styled(line, style)))
		})
		.collect();

	let list = List::new(items)
		.block(
			Block::default()
				.borders(Borders::NONE)
				.style(Style::default().bg(tc.bg)),
		)
		.style(Style::default().fg(tc.fg));
	frame.render_widget(list, area);
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
		terminal
			.draw(|f| draw(f, f.area(), &[], &ListState::default(), true, &tc))
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
			.draw(|f| draw(f, f.area(), &[], &ListState::default(), false, &tc))
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
		terminal
			.draw(|f| draw(f, f.area(), &posts, &ListState::default(), false, &tc))
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
