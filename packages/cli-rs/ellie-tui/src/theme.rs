use ratatui::style::Color;

/// Full colour palette for a theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ThemeColors {
	pub bg: Color,
	pub fg: Color,
	pub muted: Color,
	pub border: Color,
	pub accent: Color,
	pub highlight: Color,
	pub highlight_bg: Color, // scrollbar track, selection background
	pub error: Color,
	pub sticky: Color, // pinned thread colour
	pub digest: Color, // digest/featured thread colour
}

use crate::app::Theme;

impl Theme {
	/// Get the full colour palette for this theme.
	pub fn colors(self) -> ThemeColors {
		match self {
			Self::Default => ThemeColors {
				bg: Color::Reset,
				fg: Color::Reset,
				muted: Color::DarkGray,
				border: Color::DarkGray,
				accent: Color::Cyan,
				highlight: Color::Blue,
				highlight_bg: Color::DarkGray,
				error: Color::Red,
				sticky: Color::Yellow,
				digest: Color::Green,
			},
			Self::Dracula => ThemeColors {
				bg: Color::Rgb(40, 42, 54),           // #282a36
				fg: Color::Rgb(248, 248, 242),        // #f8f8f2
				muted: Color::Rgb(98, 114, 164),      // #6272a4 (comment)
				border: Color::Rgb(68, 71, 90),       // #44475a (current line)
				accent: Color::Rgb(189, 147, 249),    // #bd93f9 (purple)
				highlight: Color::Rgb(139, 233, 253), // #8be9fd (cyan)
				highlight_bg: Color::Rgb(68, 71, 90), // #44475a
				error: Color::Rgb(255, 85, 85),       // #ff5555 (red)
				sticky: Color::Rgb(241, 250, 140),    // #f1fa8c (yellow)
				digest: Color::Rgb(80, 250, 123),     // #50fa7b (green)
			},
			Self::Nord => ThemeColors {
				bg: Color::Rgb(46, 52, 64),           // #2e3440 (nord0)
				fg: Color::Rgb(216, 222, 233),        // #d8dee9 (nord4)
				muted: Color::Rgb(76, 86, 106),       // #4c566a (nord3)
				border: Color::Rgb(67, 76, 94),       // #434c5e (nord2)
				accent: Color::Rgb(136, 192, 208),    // #88c0d0 (nord8, frost)
				highlight: Color::Rgb(129, 161, 193), // #81a1c1 (nord9)
				highlight_bg: Color::Rgb(59, 66, 82), // #3b4252 (nord1)
				error: Color::Rgb(191, 97, 106),      // #bf616a (nord11, aurora red)
				sticky: Color::Rgb(235, 203, 139),    // #ebcb8b (nord13, aurora yellow)
				digest: Color::Rgb(163, 190, 140),    // #a3be8c (nord14, aurora green)
			},
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn default_theme_colors() {
		let c = Theme::Default.colors();
		assert_eq!(c.bg, Color::Reset);
		assert_eq!(c.fg, Color::Reset);
		assert_eq!(c.accent, Color::Cyan);
		assert_eq!(c.error, Color::Red);
		assert_eq!(c.highlight_bg, Color::DarkGray);
	}

	#[test]
	fn dracula_theme_colors() {
		let c = Theme::Dracula.colors();
		assert_eq!(c.bg, Color::Rgb(40, 42, 54));
		assert_eq!(c.fg, Color::Rgb(248, 248, 242));
		assert_eq!(c.error, Color::Rgb(255, 85, 85));
	}

	#[test]
	fn nord_theme_colors() {
		let c = Theme::Nord.colors();
		assert_eq!(c.bg, Color::Rgb(46, 52, 64));
		assert_eq!(c.fg, Color::Rgb(216, 222, 233));
		assert_eq!(c.error, Color::Rgb(191, 97, 106));
	}

	#[test]
	fn all_themes_have_distinct_palettes() {
		let d = Theme::Default.colors();
		let dr = Theme::Dracula.colors();
		let n = Theme::Nord.colors();
		// Each theme should have a different accent colour
		assert_ne!(d.accent, dr.accent);
		assert_ne!(dr.accent, n.accent);
		assert_ne!(d.accent, n.accent);
	}
}
