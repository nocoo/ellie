use ratatui::Frame;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};

use crate::theme::ThemeColors;
use crate::views::login_form::centered_rect;

const HELP_LINES: &[(&str, &str)] = &[
	("j / ↓", "Move down"),
	("k / ↑", "Move up"),
	("g", "Jump to top"),
	("G", "Jump to bottom"),
	("Enter", "Open selected item"),
	("Esc / Backspace", "Go back"),
	("n", "Load next page"),
	("r", "Refresh current view"),
	("/", "Search / filter"),
	("u", "View author profile"),
	("L", "Login"),
	("t", "Cycle theme"),
	("?", "Toggle this help"),
	("q / Ctrl+C", "Quit"),
];

/// Render the help panel as a centered overlay.
pub fn draw(frame: &mut Frame, tc: &ThemeColors) {
	let height = (HELP_LINES.len() as u16) + 3; // +2 border +1 title padding
	let area = centered_rect(44, height, frame.area());

	frame.render_widget(Clear, area);

	let block = Block::default()
		.title(" Help — Keybindings ")
		.borders(Borders::ALL)
		.border_style(Style::default().fg(tc.accent))
		.style(Style::default().bg(tc.bg));

	let inner = block.inner(area);
	frame.render_widget(block, area);

	let lines: Vec<Line> = HELP_LINES
		.iter()
		.map(|(key, desc)| {
			Line::from(vec![
				Span::styled(
					format!("  {:<18}", key),
					Style::default()
						.fg(tc.highlight)
						.add_modifier(Modifier::BOLD),
				),
				Span::styled(*desc, Style::default().fg(tc.fg)),
			])
		})
		.collect();

	let help = Paragraph::new(lines);
	frame.render_widget(help, inner);
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn help_lines_not_empty() {
		assert!(!HELP_LINES.is_empty());
	}

	#[test]
	fn all_help_entries_have_content() {
		for (key, desc) in HELP_LINES {
			assert!(!key.is_empty(), "key should not be empty");
			assert!(!desc.is_empty(), "description should not be empty");
		}
	}
}
