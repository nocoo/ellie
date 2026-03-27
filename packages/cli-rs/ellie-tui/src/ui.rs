use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};

use crate::app::{App, InputMode, ViewState};
use crate::theme::ThemeColors;

/// Render the full 4-zone layout.
pub fn draw(frame: &mut Frame, app: &App) {
	let tc = app.theme.colors();

	// 4-zone vertical layout: Header(1) | Breadcrumb(1) | Content(flex) | Status(1)
	let chunks = Layout::default()
		.direction(Direction::Vertical)
		.constraints([
			Constraint::Length(1), // Header
			Constraint::Length(1), // Breadcrumb
			Constraint::Min(1),    // Content
			Constraint::Length(1), // Status bar
		])
		.split(frame.area());

	draw_header(frame, chunks[0], app, &tc);
	draw_breadcrumb(frame, chunks[1], app, &tc);
	draw_content(frame, chunks[2], app, &tc);
	draw_status_bar(frame, chunks[3], app, &tc);
}

// ─── Row 0: Header ──────────────────────────────────────

fn draw_header(frame: &mut Frame, area: Rect, app: &App, tc: &ThemeColors) {
	let title = Span::styled(
		" Ellie Forum — 同济网 ",
		Style::default().fg(tc.accent).add_modifier(Modifier::BOLD),
	);

	let auth = if let Some(user) = &app.logged_in_user {
		Span::styled(format!("[{}] ", user.username), Style::default().fg(tc.fg))
	} else {
		Span::styled("[未登录] ", Style::default().fg(tc.muted))
	};

	// Right-align auth by padding
	let title_len = 22; // approximate CJK + emoji width
	let auth_len = auth.content.len();
	let padding = area.width.saturating_sub((title_len + auth_len) as u16);
	let pad = " ".repeat(padding as usize);

	let line = Line::from(vec![title, Span::raw(pad), auth]);
	let header = Paragraph::new(line).style(Style::default().bg(tc.bg).fg(tc.fg));
	frame.render_widget(header, area);
}

// ─── Row 1: Breadcrumb ──────────────────────────────────

fn draw_breadcrumb(frame: &mut Frame, area: Rect, app: &App, tc: &ThemeColors) {
	let crumb = app.breadcrumb();
	let breadcrumb = Paragraph::new(Line::from(vec![
		Span::styled(" ", Style::default()),
		Span::styled(crumb, Style::default().fg(tc.muted)),
	]))
	.style(Style::default().bg(tc.bg));
	frame.render_widget(breadcrumb, area);
}

// ─── Row 2: Content ─────────────────────────────────────

fn draw_content(frame: &mut Frame, area: Rect, app: &App, tc: &ThemeColors) {
	match &app.current_view {
		ViewState::Forums { list } => {
			draw_forum_list(frame, area, app, list, tc);
		}
		ViewState::Threads { list, .. } => {
			draw_thread_list(frame, area, app, list, tc);
		}
		ViewState::Posts { list, .. } => {
			draw_post_list(frame, area, app, list, tc);
		}
		ViewState::User { user_id } => {
			draw_user_profile(frame, area, *user_id, app, tc);
		}
	}
}

fn draw_forum_list(
	frame: &mut Frame,
	area: Rect,
	app: &App,
	list_state: &crate::app::ListState,
	tc: &ThemeColors,
) {
	let items: Vec<ListItem> = visible_items(&app.forums, list_state)
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

fn draw_thread_list(
	frame: &mut Frame,
	area: Rect,
	app: &App,
	list_state: &crate::app::ListState,
	tc: &ThemeColors,
) {
	let items: Vec<ListItem> = visible_items(&app.threads, list_state)
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
			if thread.sticky != ellie_core::types::StickyLevel::None && !is_selected {
				style = style.fg(tc.sticky);
			}
			if thread.digest != 0 && !is_selected {
				style = style.fg(tc.digest);
			}

			let marker = if is_selected { "▸ " } else { "  " };
			let prefix = match thread.sticky {
				ellie_core::types::StickyLevel::None => "",
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

fn draw_post_list(
	frame: &mut Frame,
	area: Rect,
	app: &App,
	list_state: &crate::app::ListState,
	tc: &ThemeColors,
) {
	let items: Vec<ListItem> = visible_items(&app.posts, list_state)
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
			// Show first line of message as preview
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

fn draw_user_profile(frame: &mut Frame, area: Rect, user_id: u64, app: &App, tc: &ThemeColors) {
	let text = if let Some(user) = &app.current_user {
		let role_str = format!("{:?}", user.role);
		vec![
			Line::from(Span::styled(
				format!("  Username: {}", user.username),
				Style::default().fg(tc.fg),
			)),
			Line::from(Span::styled(
				format!("  Role:     {}", role_str),
				Style::default().fg(tc.accent),
			)),
			Line::from(Span::styled(
				format!("  Posts:    {}", user.posts),
				Style::default().fg(tc.fg),
			)),
			Line::from(Span::styled(
				format!("  Threads:  {}", user.threads),
				Style::default().fg(tc.fg),
			)),
		]
	} else {
		vec![Line::from(Span::styled(
			format!("  Loading user #{user_id}..."),
			Style::default().fg(tc.muted),
		))]
	};

	let profile = Paragraph::new(text).style(Style::default().bg(tc.bg));
	frame.render_widget(profile, area);
}

// ─── Row 3: Status Bar ──────────────────────────────────

fn draw_status_bar(frame: &mut Frame, area: Rect, app: &App, tc: &ThemeColors) {
	let mode_span = match app.input_mode {
		InputMode::Normal => Span::styled(
			" NORMAL ",
			Style::default()
				.fg(tc.bg)
				.bg(tc.accent)
				.add_modifier(Modifier::BOLD),
		),
		InputMode::Search => {
			let query = match &app.current_view {
				ViewState::Forums { list } => &list.search_query,
				ViewState::Threads { list, .. } => &list.search_query,
				ViewState::Posts { list, .. } => &list.search_query,
				ViewState::User { .. } => "",
			};
			Span::styled(
				format!(" SEARCH: {query}█ "),
				Style::default()
					.fg(tc.bg)
					.bg(tc.highlight)
					.add_modifier(Modifier::BOLD),
			)
		}
		InputMode::Login => Span::styled(
			" LOGIN ",
			Style::default()
				.fg(tc.bg)
				.bg(tc.error)
				.add_modifier(Modifier::BOLD),
		),
	};

	let hints = match app.input_mode {
		InputMode::Normal => " j/k:移动 Enter:进入 /:搜索 q:退出",
		InputMode::Search => " Enter/Esc:退出搜索",
		InputMode::Login => " Tab:切换字段 Enter:提交 Esc:取消",
	};

	let status_msg = app
		.status_message
		.as_deref()
		.map(|s| format!("  {s}"))
		.unwrap_or_default();

	let line = Line::from(vec![
		mode_span,
		Span::styled(hints, Style::default().fg(tc.muted)),
		Span::styled(status_msg, Style::default().fg(tc.accent)),
	]);

	let bar = Paragraph::new(line).style(Style::default().bg(tc.bg));
	frame.render_widget(bar, area);
}

// ─── Utility ────────────────────────────────────────────

/// Get an iterator over visible items (filtered or all).
fn visible_items<'a, T>(
	items: &'a [T],
	list_state: &'a crate::app::ListState,
) -> Box<dyn Iterator<Item = &'a T> + 'a> {
	if list_state.filtered_indices.is_empty() && list_state.search_query.is_empty() {
		Box::new(items.iter())
	} else {
		Box::new(
			list_state
				.filtered_indices
				.iter()
				.filter_map(move |&i| items.get(i)),
		)
	}
}

/// Truncate a string to a maximum character width.
fn truncate(s: &str, max: usize) -> String {
	let chars: Vec<char> = s.chars().collect();
	if chars.len() <= max {
		s.to_string()
	} else {
		chars[..max.saturating_sub(1)].iter().collect::<String>() + "…"
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn truncate_short_string() {
		assert_eq!(truncate("hello", 10), "hello");
	}

	#[test]
	fn truncate_long_string() {
		assert_eq!(truncate("hello world", 5), "hell…");
	}

	#[test]
	fn truncate_exact_length() {
		assert_eq!(truncate("hello", 5), "hello");
	}

	#[test]
	fn visible_items_no_filter() {
		let items = vec![1, 2, 3];
		let ls = crate::app::ListState::default();
		let result: Vec<_> = visible_items(&items, &ls).collect();
		assert_eq!(result, vec![&1, &2, &3]);
	}

	#[test]
	fn visible_items_with_filter() {
		let items = vec![10, 20, 30, 40];
		let mut ls = crate::app::ListState::default();
		ls.search_query = "x".to_string();
		ls.filtered_indices = vec![1, 3];
		let result: Vec<_> = visible_items(&items, &ls).collect();
		assert_eq!(result, vec![&20, &40]);
	}
}
