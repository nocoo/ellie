pub mod forum_list;
pub mod help_panel;
pub mod login_form;
pub mod post_view;
pub mod search_bar;
pub mod status_bar;
pub mod thread_list;
pub mod user_profile;

use crate::app::ListState;

/// Get an iterator over visible items (filtered or all).
pub fn visible_items<'a, T>(
	items: &'a [T],
	list_state: &'a ListState,
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
pub fn truncate(s: &str, max: usize) -> String {
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
		let ls = ListState::default();
		let result: Vec<_> = visible_items(&items, &ls).collect();
		assert_eq!(result, vec![&1, &2, &3]);
	}

	#[test]
	fn visible_items_with_filter() {
		let items = vec![10, 20, 30, 40];
		let mut ls = ListState::default();
		ls.search_query = "x".to_string();
		ls.filtered_indices = vec![1, 3];
		let result: Vec<_> = visible_items(&items, &ls).collect();
		assert_eq!(result, vec![&20, &40]);
	}
}
