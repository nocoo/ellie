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
			created_at: 0,
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
		terminal
			.draw(|f| draw(f, f.area(), &[], &ListState::default(), true, &tc))
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
		terminal
			.draw(|f| draw(f, f.area(), &[], &ListState::default(), false, &tc))
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
		let backend = TestBackend::new(80, 5);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let threads = vec![dummy_thread(1, "Hello world"), dummy_thread(2, "Rust tips")];
		terminal
			.draw(|f| draw(f, f.area(), &threads, &ListState::default(), false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("Hello world"));
		assert!(text.contains("Rust tips"));
	}

	#[test]
	fn render_sticky_thread() {
		let backend = TestBackend::new(80, 3);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let mut t = dummy_thread(1, "Important");
		t.sticky = StickyLevel::Global;
		terminal
			.draw(|f| draw(f, f.area(), &[t], &ListState::default(), false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		// Sticky threads show the [置顶] prefix; CJK chars are split across cells
		// in TestBackend, so check for the surrounding brackets
		assert!(text.contains("Important"));
		assert!(text.contains("["));
	}
}
