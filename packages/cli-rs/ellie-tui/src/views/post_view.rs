use ellie_core::types::Post;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem};

use crate::app::ListState;
use crate::theme::ThemeColors;
use crate::views::visible_items;

/// Render the post list view.
pub fn draw(
	frame: &mut Frame,
	area: Rect,
	posts: &[Post],
	list_state: &ListState,
	tc: &ThemeColors,
) {
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
