use std::collections::HashMap;

use ellie_core::types::{Forum, ForumType};
use ratatui::Frame;
use ratatui::layout::{Constraint, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Cell, Paragraph, Row, Scrollbar, ScrollbarOrientation, ScrollbarState, Table, TableState};

use crate::theme::ThemeColors;
use crate::views::truncate_to_width;

// ─── Forum Tree ──────────────────────────────────────────

/// A forum annotated with its depth in the tree hierarchy.
#[derive(Debug, Clone)]
pub struct ForumNode<'a> {
	pub forum: &'a Forum,
	/// 0 = Group (section header), 1 = Forum, 2 = Sub-forum.
	pub depth: u8,
	/// Whether this node is a group header (not directly selectable for drill-in).
	pub is_group: bool,
}

/// Build a depth-annotated tree from a flat list of forums.
///
/// Groups (`ForumType::Group`) become depth-0 section headers.
/// Forums directly under a group become depth-1.
/// Sub-forums become depth-2.
/// Orphan forums (parent_id = 0, type = Forum) go into a synthetic "其他" group.
///
/// Hidden forums (status=0) and social group forums (status=3) are excluded.
pub fn build_forum_tree(forums: &[Forum]) -> Vec<ForumNode<'_>> {
	if forums.is_empty() {
		return Vec::new();
	}

	// Filter out hidden (status=0) and social group (status=3) forums
	let visible: Vec<_> = forums
		.iter()
		.filter(|f| f.status != 0 && f.status != 3)
		.collect();

	// Index: parent_id → children, sorted by display_order
	let mut children: HashMap<u64, Vec<&Forum>> = HashMap::new();
	for f in &visible {
		children.entry(f.parent_id).or_default().push(f);
	}
	// Sort each bucket by display_order, then by id as tiebreaker
	for bucket in children.values_mut() {
		bucket.sort_by(|a, b| a.display_order.cmp(&b.display_order).then(a.id.cmp(&b.id)));
	}

	// Collect top-level groups (type=Group, parent_id=0), sorted by display_order
	let mut groups: Vec<&Forum> = visible
		.iter()
		.filter(|f| f.forum_type == ForumType::Group && f.parent_id == 0)
		.copied()
		.collect();
	groups.sort_by(|a, b| a.display_order.cmp(&b.display_order).then(a.id.cmp(&b.id)));

	let mut result = Vec::new();

	// Track which forums have been placed in the tree
	let mut placed = std::collections::HashSet::new();

	for group in &groups {
		placed.insert(group.id);
		result.push(ForumNode {
			forum: group,
			depth: 0,
			is_group: true,
		});

		// Direct children of this group (depth=1)
		if let Some(kids) = children.get(&group.id) {
			for kid in kids {
				placed.insert(kid.id);
				result.push(ForumNode {
					forum: kid,
					depth: 1,
					is_group: kid.forum_type == ForumType::Group,
				});

				// Sub-forums (depth=2)
				if let Some(subs) = children.get(&kid.id) {
					for sub in subs {
						placed.insert(sub.id);
						result.push(ForumNode {
							forum: sub,
							depth: 2,
							is_group: false,
						});
					}
				}
			}
		}
	}

	// Orphans: parent_id=0 + type≠Group that weren't placed
	let orphans: Vec<&Forum> = visible
		.iter()
		.filter(|f| !placed.contains(&f.id))
		.copied()
		.collect();

	if !orphans.is_empty() {
		// We don't have a real Forum struct to use as a group header,
		// so we just emit orphans at depth=1 directly (no group header).
		// This keeps the ForumNode lifetime tied to the input slice.
		for orphan in &orphans {
			result.push(ForumNode {
				forum: orphan,
				depth: 1,
				is_group: orphan.forum_type == ForumType::Group,
			});
		}
	}

	result
}

/// Return the index into the flat `forums` slice for a given visual row
/// from the tree. This accounts for the tree reordering.
pub fn tree_row_to_forum_index(
	forums: &[Forum],
	tree: &[ForumNode<'_>],
	row: usize,
) -> Option<usize> {
	let node = tree.get(row)?;
	let target_id = node.forum.id;
	forums.iter().position(|f| f.id == target_id)
}

// ─── Rendering ──────────────────────────────────────────

/// Render the forum list as a tree-structured table.
pub fn draw(
	frame: &mut Frame,
	area: Rect,
	forums: &[Forum],
	table_state: &mut TableState,
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

	let tree = build_forum_tree(forums);

	// Compute max name column width = area width - threads col (10) - posts col (10) - padding (4)
	let name_width = (area.width as usize).saturating_sub(24);

	let rows: Vec<Row> = tree
		.iter()
		.map(|node| {
			let (indent, style) = match node.depth {
				0 => (
					"",
					Style::default().fg(tc.accent).add_modifier(Modifier::BOLD),
				),
				1 => ("  ", Style::default().fg(tc.fg)),
				_ => ("    ", Style::default().fg(tc.muted)),
			};

			let icon = if node.is_group { "▎" } else { "" };
			let name_raw = format!("{indent}{icon}{}", node.forum.name);
			let name = truncate_to_width(&name_raw, name_width);

			if node.is_group {
				// Group rows: show name spanning, leave counts empty
				Row::new(vec![
					Cell::from(Line::from(Span::styled(name, style))),
					Cell::from(""),
					Cell::from(""),
				])
			} else {
				Row::new(vec![
					Cell::from(Line::from(Span::styled(name, style))),
					Cell::from(Line::from(Span::styled(
						format!("{}", node.forum.threads),
						Style::default().fg(tc.muted),
					))),
					Cell::from(Line::from(Span::styled(
						format!("{}", node.forum.posts),
						Style::default().fg(tc.muted),
					))),
				])
			}
		})
		.collect();

	let header_style = Style::default().fg(tc.muted).add_modifier(Modifier::BOLD);
	let header = Row::new(vec![
		Cell::from(Span::styled("  版块", header_style)),
		Cell::from(Span::styled("主题", header_style)),
		Cell::from(Span::styled("帖数", header_style)),
	]);

	let widths = [
		Constraint::Min(20),
		Constraint::Length(10),
		Constraint::Length(10),
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
		let mut scrollbar_state = ScrollbarState::new(row_count)
			.position(table_state.selected().unwrap_or(0));
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

	fn make_forum(id: u64, parent_id: u64, name: &str, ft: ForumType, order: i32) -> Forum {
		make_forum_with_status(id, parent_id, name, ft, order, 1)
	}

	fn make_forum_with_status(
		id: u64,
		parent_id: u64,
		name: &str,
		ft: ForumType,
		order: i32,
		status: i32,
	) -> Forum {
		Forum {
			id,
			parent_id,
			name: name.to_string(),
			description: String::new(),
			icon: String::new(),
			display_order: order,
			threads: 10,
			posts: 100,
			forum_type: ft,
			status,
			last_thread_id: 0,
			last_post_at: 0,
			last_poster: String::new(),
		}
	}

	fn dummy_forum(id: u64, name: &str) -> Forum {
		make_forum(id, 0, name, ForumType::Forum, 0)
	}

	// ─── Tree builder tests ──────────────────────────

	#[test]
	fn build_tree_empty() {
		let tree = build_forum_tree(&[]);
		assert!(tree.is_empty());
	}

	#[test]
	fn build_tree_basic() {
		let forums = vec![
			make_forum(1, 0, "Campus Zone", ForumType::Group, 1),
			make_forum(2, 1, "General", ForumType::Forum, 1),
			make_forum(3, 1, "Homework", ForumType::Forum, 2),
			make_forum(4, 2, "Introductions", ForumType::Sub, 1),
		];
		let tree = build_forum_tree(&forums);

		assert_eq!(tree.len(), 4);

		assert_eq!(tree[0].forum.name, "Campus Zone");
		assert_eq!(tree[0].depth, 0);
		assert!(tree[0].is_group);

		assert_eq!(tree[1].forum.name, "General");
		assert_eq!(tree[1].depth, 1);
		assert!(!tree[1].is_group);

		assert_eq!(tree[2].forum.name, "Introductions");
		assert_eq!(tree[2].depth, 2);
		assert!(!tree[2].is_group);

		assert_eq!(tree[3].forum.name, "Homework");
		assert_eq!(tree[3].depth, 1);
		assert!(!tree[3].is_group);
	}

	#[test]
	fn build_tree_orphans() {
		// Forums with parent_id=0 but type=Forum → orphans at depth=1
		let forums = vec![
			make_forum(10, 0, "Orphan1", ForumType::Forum, 1),
			make_forum(11, 0, "Orphan2", ForumType::Forum, 2),
		];
		let tree = build_forum_tree(&forums);

		assert_eq!(tree.len(), 2);
		assert_eq!(tree[0].depth, 1);
		assert_eq!(tree[1].depth, 1);
		assert_eq!(tree[0].forum.name, "Orphan1");
		assert_eq!(tree[1].forum.name, "Orphan2");
	}

	#[test]
	fn build_tree_display_order() {
		let forums = vec![
			make_forum(1, 0, "Group", ForumType::Group, 1),
			make_forum(3, 1, "C-forum", ForumType::Forum, 3),
			make_forum(2, 1, "A-forum", ForumType::Forum, 1),
			make_forum(4, 1, "B-forum", ForumType::Forum, 2),
		];
		let tree = build_forum_tree(&forums);

		assert_eq!(tree[0].forum.name, "Group");
		assert_eq!(tree[1].forum.name, "A-forum");
		assert_eq!(tree[2].forum.name, "B-forum");
		assert_eq!(tree[3].forum.name, "C-forum");
	}

	#[test]
	fn build_tree_multiple_groups() {
		let forums = vec![
			make_forum(1, 0, "Group A", ForumType::Group, 2),
			make_forum(2, 0, "Group B", ForumType::Group, 1),
			make_forum(3, 1, "Forum A1", ForumType::Forum, 1),
			make_forum(4, 2, "Forum B1", ForumType::Forum, 1),
		];
		let tree = build_forum_tree(&forums);

		// Group B (order=1) comes before Group A (order=2)
		assert_eq!(tree[0].forum.name, "Group B");
		assert_eq!(tree[1].forum.name, "Forum B1");
		assert_eq!(tree[2].forum.name, "Group A");
		assert_eq!(tree[3].forum.name, "Forum A1");
	}

	#[test]
	fn tree_row_to_forum_index_maps_correctly() {
		let forums = vec![
			make_forum(1, 0, "Group", ForumType::Group, 1),
			make_forum(2, 1, "Forum", ForumType::Forum, 1),
		];
		let tree = build_forum_tree(&forums);
		// tree[0] is Group (id=1), which is forums[0]
		assert_eq!(tree_row_to_forum_index(&forums, &tree, 0), Some(0));
		// tree[1] is Forum (id=2), which is forums[1]
		assert_eq!(tree_row_to_forum_index(&forums, &tree, 1), Some(1));
		// Out of bounds
		assert_eq!(tree_row_to_forum_index(&forums, &tree, 5), None);
	}

	#[test]
	fn build_tree_filters_hidden_forums() {
		let forums = vec![
			make_forum(1, 0, "Visible Group", ForumType::Group, 1),
			make_forum_with_status(2, 0, "Hidden Group", ForumType::Group, 2, 0),
			make_forum(3, 1, "Visible Forum", ForumType::Forum, 1),
			make_forum_with_status(4, 1, "Hidden Forum", ForumType::Forum, 2, 0),
		];
		let tree = build_forum_tree(&forums);

		// Only visible forums should appear
		assert_eq!(tree.len(), 2);
		assert_eq!(tree[0].forum.name, "Visible Group");
		assert_eq!(tree[1].forum.name, "Visible Forum");
	}

	#[test]
	fn build_tree_filters_social_group_forums() {
		let forums = vec![
			make_forum(1, 0, "Normal Group", ForumType::Group, 1),
			make_forum_with_status(2, 0, "校友群", ForumType::Group, 2, 3),
			make_forum_with_status(3, 0, "学习工作群", ForumType::Group, 3, 3),
			make_forum(4, 1, "Normal Forum", ForumType::Forum, 1),
			make_forum_with_status(5, 2, "Job Group", ForumType::Forum, 1, 3),
		];
		let tree = build_forum_tree(&forums);

		// Only normal forums should appear, social groups (status=3) are filtered
		assert_eq!(tree.len(), 2);
		assert_eq!(tree[0].forum.name, "Normal Group");
		assert_eq!(tree[1].forum.name, "Normal Forum");
	}

	#[test]
	fn build_tree_filters_mixed_statuses() {
		let forums = vec![
			make_forum(1, 0, "Group A", ForumType::Group, 1),
			make_forum_with_status(2, 1, "Normal", ForumType::Forum, 1, 1),
			make_forum_with_status(3, 1, "Hidden", ForumType::Forum, 2, 0),
			make_forum_with_status(4, 1, "Social", ForumType::Forum, 3, 3),
		];
		let tree = build_forum_tree(&forums);

		// Only the normal forum should appear under the group
		assert_eq!(tree.len(), 2);
		assert_eq!(tree[0].forum.name, "Group A");
		assert_eq!(tree[1].forum.name, "Normal");
	}

	// ─── Render tests ────────────────────────────────

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
		assert!(text.contains("Loading forums"));
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
		assert!(text.contains("No forums available"));
	}

	#[test]
	fn render_forum_items() {
		let backend = TestBackend::new(80, 8);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let forums = vec![
			make_forum(1, 0, "Campus Zone", ForumType::Group, 1),
			make_forum(2, 1, "General", ForumType::Forum, 1),
		];
		let mut ts = TableState::default();
		ts.select(Some(0));
		terminal
			.draw(|f| draw(f, f.area(), &forums, &mut ts, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("Campus Zone"));
		assert!(text.contains("General"));
	}

	#[test]
	fn render_flat_forums() {
		// Orphan forums (no group) should still render
		let backend = TestBackend::new(80, 5);
		let mut terminal = Terminal::new(backend).unwrap();
		let tc = Theme::Default.colors();
		let forums = vec![dummy_forum(1, "Campus"), dummy_forum(2, "Tech")];
		let mut ts = TableState::default();
		terminal
			.draw(|f| draw(f, f.area(), &forums, &mut ts, false, &tc))
			.unwrap();
		let buf = terminal.backend().buffer().content().to_vec();
		let text: String = buf
			.iter()
			.map(|c| c.symbol().chars().next().unwrap_or(' '))
			.collect();
		assert!(text.contains("Campus"));
		assert!(text.contains("Tech"));
	}
}
