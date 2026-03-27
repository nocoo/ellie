pub mod forum_list;
pub mod help_panel;
pub mod login_form;
pub mod post_view;
pub mod search_bar;
pub mod status_bar;
pub mod thread_list;
pub mod user_profile;

use chrono::{Local, TimeZone};
use regex::Regex;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

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

/// Truncate a string to fit within `max_width` terminal columns.
///
/// CJK characters occupy 2 columns each; this function never splits a
/// wide character in half. If truncation is needed, the result ends with "…"
/// (1 column).
pub fn truncate_to_width(s: &str, max_width: usize) -> String {
	if UnicodeWidthStr::width(s) <= max_width {
		return s.to_string();
	}
	// Reserve 1 column for the "…" suffix.
	let target = max_width.saturating_sub(1);
	let mut width = 0;
	let mut end = 0;
	for (i, ch) in s.char_indices() {
		let cw = UnicodeWidthChar::width(ch).unwrap_or(0);
		if width + cw > target {
			break;
		}
		width += cw;
		end = i + ch.len_utf8();
	}
	format!("{}…", &s[..end])
}

/// Pad (or truncate) a string to exactly `target_width` terminal columns.
///
/// If `s` is wider than `target_width`, it is truncated via [`truncate_to_width`].
/// If narrower, spaces are appended.
pub fn pad_to_width(s: &str, target_width: usize) -> String {
	let w = UnicodeWidthStr::width(s);
	if w > target_width {
		truncate_to_width(s, target_width)
	} else {
		let padding = target_width - w;
		format!("{}{}", s, " ".repeat(padding))
	}
}

/// Backward-compatible alias. Prefer [`truncate_to_width`] in new code.
pub fn truncate(s: &str, max_width: usize) -> String {
	truncate_to_width(s, max_width)
}

/// Format a Unix timestamp (seconds) to `YYYY/MM/DD HH:MM:SS` in local time.
/// Returns `"-"` for timestamp 0.
pub fn format_timestamp(ts: u64) -> String {
	if ts == 0 {
		return "-".to_string();
	}
	match Local.timestamp_opt(ts as i64, 0) {
		chrono::LocalResult::Single(dt) => dt.format("%Y/%m/%d %H:%M:%S").to_string(),
		_ => "-".to_string(),
	}
}

/// Discuz emoticon code → Unicode emoji mapping.
/// Covers both raw DZ codes (`:)`, `:D`) and named codes (`:hug:`, `:kiss:`).
const EMOTICON_MAP: &[(&str, &str)] = &[
	// Default pack — punctuation-style
	(":)", "😊"),
	(":(", "😞"),
	(":D", "😃"),
	(":@", "😡"),
	(":o", "😮"),
	(":P", "😛"),
	(":$", "😳"),
	(";)", "😉"),
	(":|", "😅"),
	(":L", "🤣"),
	(":Q", "😢"),
	(":lol", "🤣"),
	// Default pack — named codes
	(":hug:", "🤗"),
	(":victory:", "✌️"),
	(":time:", "⏰"),
	(":kiss:", "😘"),
	(":handshake", "🤝"),
	(":call:", "📞"),
	(":loveliness:", "🥰"),
	// Common named codes from other Discuz installs
	(":laugh:", "😄"),
	(":smile:", "😊"),
	(":cry:", "😢"),
	(":sad:", "😞"),
	(":angry:", "😡"),
	(":tongue:", "😛"),
	(":shy:", "😳"),
	(":cool:", "😎"),
	(":sweat:", "😅"),
	(":heart:", "❤️"),
	(":rose:", "🌹"),
	(":gift:", "🎁"),
	(":beer:", "🍺"),
	(":coffee:", "☕"),
	(":funk:", "😤"),
	(":dizzy:", "😵"),
	(":shutup:", "🤐"),
	(":sleepy:", "😴"),
	(":biggrin:", "😃"),
	(":shocked:", "😱"),
	(":curse:", "🤬"),
	(":titter:", "🤭"),
];

/// Strip HTML tags, BBCode/UBB tags, and Discuz emoticon codes from content.
///
/// - HTML: `<tag ...>` and `</tag>`
/// - BBCode: `[tag]`, `[tag=...]`, `[/tag]`
/// - Emoticons: `:code:` → mapped emoji or removed
/// - Consecutive whitespace collapsed to single space
/// - Leading/trailing whitespace trimmed
pub fn strip_markup(s: &str) -> String {
	// 1. Replace emoticon codes with emoji
	let mut result = s.to_string();
	for &(code, emoji) in EMOTICON_MAP {
		result = result.replace(code, emoji);
	}

	// 2. Strip HTML tags: <...>
	let html_re = Regex::new(r"<[^>]*>").unwrap();
	result = html_re.replace_all(&result, "").to_string();

	// 3. Strip BBCode/UBB tags: [tag], [tag=...], [/tag]
	let bbc_re = Regex::new(r"\[/?[a-zA-Z][a-zA-Z0-9]*(?:=[^\]]*)?]").unwrap();
	result = bbc_re.replace_all(&result, "").to_string();

	// 4. Strip Discuz brace-wrapped emoticon codes: {:soso_e100:}, {:coolmonkey_001:}
	// Must run before the bare :word: regex to avoid leaving empty {}
	let brace_emo_re = Regex::new(r"\{:[^}]+:\}").unwrap();
	result = brace_emo_re.replace_all(&result, "").to_string();

	// 5. Strip remaining Discuz emoticon codes not in map: :word:
	let emo_re = Regex::new(r":[a-zA-Z_][a-zA-Z0-9_]*:").unwrap();
	result = emo_re.replace_all(&result, "").to_string();

	// 6. Collapse consecutive whitespace to single space, trim
	let ws_re = Regex::new(r"\s+").unwrap();
	ws_re.replace_all(result.trim(), " ").to_string()
}

#[cfg(test)]
mod tests {
	use super::*;

	// ─── truncate_to_width ──────────────────────────────

	#[test]
	fn truncate_short_string() {
		assert_eq!(truncate_to_width("hello", 10), "hello");
	}

	#[test]
	fn truncate_long_string() {
		assert_eq!(truncate_to_width("hello world", 5), "hell…");
	}

	#[test]
	fn truncate_exact_width() {
		assert_eq!(truncate_to_width("hello", 5), "hello");
	}

	#[test]
	fn truncate_cjk_basic() {
		// "你好世界" = 4 chars × 2 columns = 8 columns total
		assert_eq!(truncate_to_width("你好世界", 8), "你好世界");
	}

	#[test]
	fn truncate_cjk_overflow() {
		// max_width=5 → target=4 → can fit "你好" (4 cols) then "…"
		assert_eq!(truncate_to_width("你好世界", 5), "你好…");
	}

	#[test]
	fn truncate_cjk_no_half_split() {
		// max_width=4 → target=3 → "你" (2 cols) fits, "好" (2 cols) won't → "你…"
		assert_eq!(truncate_to_width("你好世界", 4), "你…");
	}

	#[test]
	fn truncate_mixed_cjk_ascii() {
		// "Hello你好" = 5 + 4 = 9 columns
		assert_eq!(truncate_to_width("Hello你好", 9), "Hello你好");
		// max_width=7 → target=6 → "Hello" (5) + "你" (2) = 7 > 6 → "Hello…"
		assert_eq!(truncate_to_width("Hello你好", 7), "Hello…");
		// max_width=8 → target=7 → "Hello" (5) + "你" (2) = 7 ≤ 7 → "Hello你…"
		assert_eq!(truncate_to_width("Hello你好", 8), "Hello你…");
	}

	#[test]
	fn truncate_zero_width() {
		assert_eq!(truncate_to_width("hello", 0), "…");
	}

	#[test]
	fn truncate_one_width() {
		// max=1 → target=0 → nothing fits → "…" (which is 1 col)
		assert_eq!(truncate_to_width("hello", 1), "…");
	}

	#[test]
	fn truncate_empty_string() {
		assert_eq!(truncate_to_width("", 10), "");
	}

	// ─── pad_to_width ──────────────────────────────────

	#[test]
	fn pad_ascii_string() {
		assert_eq!(pad_to_width("hi", 5), "hi   ");
	}

	#[test]
	fn pad_cjk_string() {
		// "你好" = 4 cols, target 6 → 2 spaces padding
		assert_eq!(pad_to_width("你好", 6), "你好  ");
	}

	#[test]
	fn pad_exact_width() {
		assert_eq!(pad_to_width("hello", 5), "hello");
	}

	#[test]
	fn pad_too_wide_truncates() {
		assert_eq!(pad_to_width("hello world", 5), "hell…");
	}

	// ─── backward compat alias ─────────────────────────

	#[test]
	fn truncate_alias_works() {
		assert_eq!(truncate("hello", 10), "hello");
		assert_eq!(truncate("hello world", 5), "hell…");
	}

	// ─── visible_items ──────────────────────────────────

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

	// ─── format_timestamp ──────────────────────────────

	#[test]
	fn format_timestamp_zero() {
		assert_eq!(format_timestamp(0), "-");
	}

	#[test]
	fn format_timestamp_valid() {
		let s = format_timestamp(1711540800);
		// Should be a date string like "2024/03/27 ..."
		assert!(s.starts_with("20"));
		assert!(s.contains('/'));
		assert!(s.contains(':'));
		assert_eq!(s.len(), 19); // "YYYY/MM/DD HH:MM:SS"
	}

	// ─── strip_markup ──────────────────────────────────

	#[test]
	fn strip_html_tags() {
		assert_eq!(strip_markup("<b>bold</b> text"), "bold text");
		assert_eq!(strip_markup("<blockquote>quoted</blockquote>"), "quoted");
	}

	#[test]
	fn strip_bbcode_tags() {
		assert_eq!(strip_markup("[b]bold[/b]"), "bold");
		assert_eq!(strip_markup("[color=red]text[/color]"), "text");
		assert_eq!(strip_markup("[i]italic[/i] normal"), "italic normal");
	}

	#[test]
	fn strip_emoticon_to_emoji() {
		assert_eq!(strip_markup(":laugh:"), "😄");
		assert_eq!(strip_markup("hello :smile: world"), "hello 😊 world");
	}

	#[test]
	fn strip_unknown_emoticon() {
		assert_eq!(strip_markup(":unknownemote:"), "");
	}

	#[test]
	fn strip_brace_wrapped_emoticon() {
		assert_eq!(strip_markup("{:soso_e100:}"), "");
		assert_eq!(
			strip_markup("hello {:coolmonkey_001:} world"),
			"hello world"
		);
		assert_eq!(
			strip_markup("text {:soso_e100:} and {:soso_e113:} end"),
			"text and end"
		);
	}

	#[test]
	fn strip_mixed_markup() {
		let input = "<blockquote>[i]hello[/i] :laugh:  world  </blockquote>";
		assert_eq!(strip_markup(input), "hello 😄 world");
	}

	#[test]
	fn strip_collapses_whitespace() {
		assert_eq!(strip_markup("hello   world"), "hello world");
		assert_eq!(strip_markup("  leading  trailing  "), "leading trailing");
	}

	#[test]
	fn strip_preserves_plain_text() {
		assert_eq!(strip_markup("normal text here"), "normal text here");
	}
}
