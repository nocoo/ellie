use ellie_core::types::{StickyLevel, Thread};
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};

use crate::app::ListState;
use crate::theme::ThemeColors;
use crate::views::{truncate, visible_items};

/// Render the thread list view.
pub fn draw(
	frame: &mut Frame,
	area: Rect,
	threads: &[Thread],
	list_state: &ListState,
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

	let items: Vec<ListItem> = visible_items(threads, list_state)
		.enumerate()
		.map(|(i, thread)| {
			let is_selected = i == list_state.selected_row;
			let mut style = if is_selected {
				Style::default()
					.fg(tc.highlight)
					.add_modifier(Modifier::BOLD)
			} else {
				Style::default().fg(tc.fg)
			};

			// Sticky threads get special colour
			if thread.sticky != StickyLevel::None && !is_selected {
				style = style.fg(tc.sticky);
			}
			if thread.digest != 0 && !is_selected {
				style = style.fg(tc.digest);
			}

			let marker = if is_selected { "▸ " } else { "  " };
			let prefix = match thread.sticky {
				StickyLevel::None => "",
				_ => "[置顶] ",
			};
			let line = format!(
				"{}{}{:<40} {:<12} {}/{}",
				marker,
				prefix,
				truncate(&thread.subject, 40),
				thread.author_name,
				thread.replies,
				thread.views,
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
