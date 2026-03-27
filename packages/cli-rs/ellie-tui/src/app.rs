use ellie_core::config::Config;
use ellie_core::types::{Forum, LoggedUser, Post, Thread, User};

// ─── Input Modes ─────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputMode {
	Normal,
	Search,
	Login,
}

// ─── List State ──────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ListState {
	pub selected_row: usize,
	pub search_query: String,
	pub filtered_indices: Vec<usize>,
	pub next_cursor: Option<String>,
	pub has_more: bool,
}

impl Default for ListState {
	fn default() -> Self {
		Self {
			selected_row: 0,
			search_query: String::new(),
			filtered_indices: Vec::new(),
			next_cursor: None,
			has_more: true,
		}
	}
}

impl ListState {
	/// Move selection down, wrapping at bounds.
	pub fn move_down(&mut self, total: usize) {
		if total == 0 {
			return;
		}
		let max = self.visible_count(total).saturating_sub(1);
		if self.selected_row < max {
			self.selected_row += 1;
		}
	}

	/// Move selection up.
	pub fn move_up(&mut self) {
		self.selected_row = self.selected_row.saturating_sub(1);
	}

	/// Jump to first item.
	pub fn jump_top(&mut self) {
		self.selected_row = 0;
	}

	/// Jump to last item.
	pub fn jump_bottom(&mut self, total: usize) {
		let count = self.visible_count(total);
		self.selected_row = count.saturating_sub(1);
	}

	/// Number of visible items (filtered or total).
	pub fn visible_count(&self, total: usize) -> usize {
		if self.filtered_indices.is_empty() && self.search_query.is_empty() {
			total
		} else {
			self.filtered_indices.len()
		}
	}

	/// Get the actual index into the data array for the current selection.
	pub fn selected_index(&self) -> usize {
		if self.filtered_indices.is_empty() {
			self.selected_row
		} else {
			self.filtered_indices
				.get(self.selected_row)
				.copied()
				.unwrap_or(0)
		}
	}

	/// Apply search filter against a list of items using a match function.
	pub fn apply_filter<T>(&mut self, items: &[T], matches: impl Fn(&T, &str) -> bool) {
		if self.search_query.is_empty() {
			self.filtered_indices.clear();
		} else {
			let query = self.search_query.to_lowercase();
			self.filtered_indices = items
				.iter()
				.enumerate()
				.filter(|(_, item)| matches(item, &query))
				.map(|(i, _)| i)
				.collect();
		}
		// Clamp selection to visible range
		let count = self.visible_count(items.len());
		if count == 0 {
			self.selected_row = 0;
		} else if self.selected_row >= count {
			self.selected_row = count - 1;
		}
	}

	/// Reset search state.
	pub fn clear_search(&mut self) {
		self.search_query.clear();
		self.filtered_indices.clear();
	}
}

// ─── View State ──────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum ViewState {
	Forums {
		list: ListState,
	},
	Threads {
		forum_id: u64,
		forum_name: String,
		list: ListState,
	},
	Posts {
		thread_id: u64,
		subject: String,
		list: ListState,
	},
	User {
		user_id: u64,
	},
}

// ─── Login Form State ────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct LoginFormState {
	pub username: String,
	pub password: String,
	/// 0 = username field, 1 = password field
	pub focus: u8,
	pub error: Option<String>,
}

impl LoginFormState {
	pub fn toggle_focus(&mut self) {
		self.focus = if self.focus == 0 { 1 } else { 0 };
	}

	pub fn active_field_mut(&mut self) -> &mut String {
		if self.focus == 0 {
			&mut self.username
		} else {
			&mut self.password
		}
	}

	pub fn reset(&mut self) {
		*self = Self::default();
	}
}

// ─── App ─────────────────────────────────────────────────

pub struct App {
	// Lifecycle
	pub should_quit: bool,
	pub input_mode: InputMode,
	pub loading: bool,
	pub status_message: Option<String>,

	// Navigation stack (each view keeps its own list state)
	pub view_stack: Vec<ViewState>,
	pub current_view: ViewState,

	// Data caches
	pub forums: Vec<Forum>,
	pub threads: Vec<Thread>,
	pub posts: Vec<Post>,
	pub current_user: Option<User>,

	// Auth
	pub logged_in_user: Option<LoggedUser>,

	// Login form
	pub login_form: LoginFormState,

	// Config (single source of truth)
	pub config: Config,

	// Theme
	pub theme: Theme,
}

// ─── Theme ───────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Theme {
	Default,
	Dracula,
	Nord,
}

impl Theme {
	pub fn label(&self) -> &str {
		match self {
			Self::Default => "default",
			Self::Dracula => "dracula",
			Self::Nord => "nord",
		}
	}

	pub fn from_label(label: &str) -> Self {
		match label {
			"dracula" => Self::Dracula,
			"nord" => Self::Nord,
			_ => Self::Default,
		}
	}

	pub fn next(&self) -> Self {
		match self {
			Self::Default => Self::Dracula,
			Self::Dracula => Self::Nord,
			Self::Nord => Self::Default,
		}
	}

	pub fn load(config: &Config) -> Self {
		Self::from_label(&config.theme)
	}

	pub fn save(&self, config: &mut Config) {
		config.theme = self.label().to_string();
	}
}

impl App {
	pub fn new(config: Config) -> Self {
		let theme = Theme::load(&config);
		let logged_in_user = config.auth.as_ref().map(|a| a.user.clone());
		Self {
			should_quit: false,
			input_mode: InputMode::Normal,
			loading: false,
			status_message: None,
			view_stack: Vec::new(),
			current_view: ViewState::Forums {
				list: ListState::default(),
			},
			forums: Vec::new(),
			threads: Vec::new(),
			posts: Vec::new(),
			current_user: None,
			logged_in_user,
			login_form: LoginFormState::default(),
			config,
			theme,
		}
	}

	pub fn push_view(&mut self, view: ViewState) {
		self.view_stack.push(self.current_view.clone());
		self.current_view = view;
	}

	pub fn pop_view(&mut self) -> bool {
		if let Some(view) = self.view_stack.pop() {
			self.current_view = view;
			true
		} else {
			false
		}
	}

	/// Get a mutable reference to the current view's list state, if applicable.
	pub fn current_list_mut(&mut self) -> Option<&mut ListState> {
		match &mut self.current_view {
			ViewState::Forums { list } => Some(list),
			ViewState::Threads { list, .. } => Some(list),
			ViewState::Posts { list, .. } => Some(list),
			ViewState::User { .. } => None,
		}
	}

	/// Get the breadcrumb trail for the current view.
	pub fn breadcrumb(&self) -> String {
		let mut parts = Vec::new();
		for view in &self.view_stack {
			match view {
				ViewState::Forums { .. } => parts.push("版块".to_string()),
				ViewState::Threads { forum_name, .. } => parts.push(forum_name.clone()),
				ViewState::Posts { subject, .. } => parts.push(subject.clone()),
				ViewState::User { .. } => parts.push("用户".to_string()),
			}
		}
		match &self.current_view {
			ViewState::Forums { .. } => parts.push("版块".to_string()),
			ViewState::Threads { forum_name, .. } => parts.push(forum_name.clone()),
			ViewState::Posts { subject, .. } => parts.push(subject.clone()),
			ViewState::User { user_id } => parts.push(format!("用户 #{user_id}")),
		}
		parts.join(" > ")
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	// ─── ListState tests ─────────────────────────────

	#[test]
	fn list_state_default() {
		let ls = ListState::default();
		assert_eq!(ls.selected_row, 0);
		assert!(ls.search_query.is_empty());
		assert!(ls.has_more);
	}

	#[test]
	fn list_state_move_down_and_up() {
		let mut ls = ListState::default();
		ls.move_down(5);
		assert_eq!(ls.selected_row, 1);
		ls.move_down(5);
		assert_eq!(ls.selected_row, 2);
		ls.move_up();
		assert_eq!(ls.selected_row, 1);
		ls.move_up();
		assert_eq!(ls.selected_row, 0);
		// Can't go below 0
		ls.move_up();
		assert_eq!(ls.selected_row, 0);
	}

	#[test]
	fn list_state_move_down_at_boundary() {
		let mut ls = ListState::default();
		ls.move_down(2); // 0 -> 1
		assert_eq!(ls.selected_row, 1);
		ls.move_down(2); // already at max (1), stays
		assert_eq!(ls.selected_row, 1);
	}

	#[test]
	fn list_state_move_down_empty() {
		let mut ls = ListState::default();
		ls.move_down(0); // empty list, stays at 0
		assert_eq!(ls.selected_row, 0);
	}

	#[test]
	fn list_state_jump_top_and_bottom() {
		let mut ls = ListState::default();
		ls.selected_row = 5;
		ls.jump_top();
		assert_eq!(ls.selected_row, 0);

		ls.jump_bottom(10);
		assert_eq!(ls.selected_row, 9);

		ls.jump_bottom(0);
		assert_eq!(ls.selected_row, 0); // saturating_sub
	}

	#[test]
	fn list_state_visible_count_no_filter() {
		let ls = ListState::default();
		assert_eq!(ls.visible_count(10), 10);
	}

	#[test]
	fn list_state_selected_index_no_filter() {
		let mut ls = ListState::default();
		ls.selected_row = 3;
		assert_eq!(ls.selected_index(), 3);
	}

	#[test]
	fn list_state_apply_filter() {
		let mut ls = ListState::default();
		let items = vec!["apple", "banana", "cherry", "avocado"];
		ls.search_query = "a".to_string();
		ls.apply_filter(&items, |item, q| item.to_lowercase().contains(q));
		// "apple" (0), "banana" (1), "avocado" (3) match
		assert_eq!(ls.filtered_indices, vec![0, 1, 3]);
		assert_eq!(ls.visible_count(items.len()), 3);
	}

	#[test]
	fn list_state_selected_index_with_filter() {
		let mut ls = ListState::default();
		ls.filtered_indices = vec![2, 5, 8];
		ls.selected_row = 1;
		assert_eq!(ls.selected_index(), 5);
	}

	#[test]
	fn list_state_clear_search() {
		let mut ls = ListState::default();
		ls.search_query = "test".to_string();
		ls.filtered_indices = vec![1, 2, 3];
		ls.clear_search();
		assert!(ls.search_query.is_empty());
		assert!(ls.filtered_indices.is_empty());
	}

	#[test]
	fn list_state_filter_clamps_selection() {
		let mut ls = ListState::default();
		ls.selected_row = 5;
		let items = vec!["apple", "banana"];
		ls.search_query = "x".to_string(); // nothing matches
		ls.apply_filter(&items, |item, q| item.contains(q));
		assert_eq!(ls.selected_row, 0); // clamped
	}

	// ─── LoginFormState tests ─────────────────────────

	#[test]
	fn login_form_toggle_focus() {
		let mut form = LoginFormState::default();
		assert_eq!(form.focus, 0);
		form.toggle_focus();
		assert_eq!(form.focus, 1);
		form.toggle_focus();
		assert_eq!(form.focus, 0);
	}

	#[test]
	fn login_form_active_field() {
		let mut form = LoginFormState::default();
		form.active_field_mut().push_str("alice");
		assert_eq!(form.username, "alice");
		assert!(form.password.is_empty());

		form.toggle_focus();
		form.active_field_mut().push_str("secret");
		assert_eq!(form.password, "secret");
	}

	#[test]
	fn login_form_reset() {
		let mut form = LoginFormState::default();
		form.username = "alice".to_string();
		form.password = "secret".to_string();
		form.focus = 1;
		form.error = Some("bad".to_string());
		form.reset();
		assert!(form.username.is_empty());
		assert!(form.password.is_empty());
		assert_eq!(form.focus, 0);
		assert!(form.error.is_none());
	}

	// ─── Theme tests ──────────────────────────────────

	#[test]
	fn theme_labels() {
		assert_eq!(Theme::Default.label(), "default");
		assert_eq!(Theme::Dracula.label(), "dracula");
		assert_eq!(Theme::Nord.label(), "nord");
	}

	#[test]
	fn theme_from_label() {
		assert_eq!(Theme::from_label("dracula"), Theme::Dracula);
		assert_eq!(Theme::from_label("nord"), Theme::Nord);
		assert_eq!(Theme::from_label("unknown"), Theme::Default);
	}

	#[test]
	fn theme_cycle() {
		assert_eq!(Theme::Default.next(), Theme::Dracula);
		assert_eq!(Theme::Dracula.next(), Theme::Nord);
		assert_eq!(Theme::Nord.next(), Theme::Default);
	}

	#[test]
	fn theme_save_and_load() {
		let mut config = Config::default_config();
		let theme = Theme::Dracula;
		theme.save(&mut config);
		assert_eq!(config.theme, "dracula");
		let loaded = Theme::load(&config);
		assert_eq!(loaded, Theme::Dracula);
	}

	// ─── App tests ────────────────────────────────────

	#[test]
	fn app_new_defaults() {
		let config = Config::default_config();
		let app = App::new(config);
		assert!(!app.should_quit);
		assert_eq!(app.input_mode, InputMode::Normal);
		assert!(app.logged_in_user.is_none());
		assert_eq!(app.theme, Theme::Default);
		assert!(app.view_stack.is_empty());
	}

	#[test]
	fn app_push_pop_view() {
		let config = Config::default_config();
		let mut app = App::new(config);

		// Push threads view
		app.push_view(ViewState::Threads {
			forum_id: 1,
			forum_name: "Campus".to_string(),
			list: ListState::default(),
		});
		assert_eq!(app.view_stack.len(), 1);

		// Push posts view
		app.push_view(ViewState::Posts {
			thread_id: 42,
			subject: "Hello".to_string(),
			list: ListState::default(),
		});
		assert_eq!(app.view_stack.len(), 2);

		// Pop back to threads
		assert!(app.pop_view());
		assert_eq!(app.view_stack.len(), 1);
		match &app.current_view {
			ViewState::Threads { forum_name, .. } => assert_eq!(forum_name, "Campus"),
			_ => panic!("expected Threads view"),
		}

		// Pop back to forums
		assert!(app.pop_view());
		assert!(app.view_stack.is_empty());
		assert!(matches!(app.current_view, ViewState::Forums { .. }));

		// Can't pop further
		assert!(!app.pop_view());
	}

	#[test]
	fn app_breadcrumb() {
		let config = Config::default_config();
		let mut app = App::new(config);
		assert_eq!(app.breadcrumb(), "版块");

		app.push_view(ViewState::Threads {
			forum_id: 1,
			forum_name: "校园交流".to_string(),
			list: ListState::default(),
		});
		assert_eq!(app.breadcrumb(), "版块 > 校园交流");

		app.push_view(ViewState::Posts {
			thread_id: 42,
			subject: "新生报到".to_string(),
			list: ListState::default(),
		});
		assert_eq!(app.breadcrumb(), "版块 > 校园交流 > 新生报到");
	}

	#[test]
	fn app_current_list_mut() {
		let config = Config::default_config();
		let mut app = App::new(config);

		// Forums view has list
		assert!(app.current_list_mut().is_some());

		// User view does not
		app.push_view(ViewState::User { user_id: 1 });
		assert!(app.current_list_mut().is_none());
	}
}
