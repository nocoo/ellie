use ellie_core::types::Forum;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};

use crate::app::ListState;
use crate::theme::ThemeColors;
use crate::views::visible_items;

/// Render the forum list view.
pub fn draw(
	frame: &mut Frame,
	area: Rect,
	forums: &[Forum],
	list_state: &ListState,
	loading: bool,
	tc: &ThemeColors,
) {
	// Empty / loading state
	if forums.is_empty() {
		let msg = if loading {
			"  Loading forums..."
		} else {
			"  No forums available"
		};
		let p = Paragraph::new(Span::styled(msg, Style::default().fg(tc.muted)))
			.style(Style::default().bg(tc.bg));
		frame.render_widget(p, area);
		return;
	}

	let items: Vec<ListItem> = visible_items(forums, list_state)
		.enumerate()
		.map(|(i, forum)| {
			let style = if i == list_state.selected_row {
				Style::default()
					.fg(tc.highlight)
					.add_modifier(Modifier::BOLD)
			} else {
				Style::default().fg(tc.fg)
			};
			let marker = if i == list_state.selected_row {
				"▸ "
			} else {
				"  "
			};
			let line = format!(
				"{}{:<30} {:>6} threads {:>8} posts",
				marker, forum.name, forum.threads, forum.posts
			);
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
