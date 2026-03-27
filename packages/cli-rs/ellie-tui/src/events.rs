use crossterm::event::{self, Event, KeyCode, KeyEvent, KeyModifiers};

use crate::actions::schedule_data_load;
use crate::app::{App, InputMode, PendingAction, ViewState};
use crate::views::forum_list;

/// Poll for a keyboard event with 50ms timeout.
/// Returns `Some(KeyEvent)` if a key was pressed, `None` on timeout or non-key events.
pub fn poll_key_event() -> Option<KeyEvent> {
	if event::poll(std::time::Duration::from_millis(50)).ok()? {
		if let Event::Key(key) = event::read().ok()? {
			Some(key)
		} else {
			None
		}
	} else {
		None
	}
}

/// Dispatch a key event to the appropriate handler based on current input mode.
pub fn handle_key_event(app: &mut App, key: KeyEvent) {
	match app.input_mode {
		InputMode::Normal => handle_normal_mode(app, key),
		InputMode::Search => handle_search_mode(app, key),
		InputMode::Login => handle_login_mode(app, key),
		InputMode::Help => handle_help_mode(app, key),
	}
}

// ─── Normal Mode ─────────────────────────────────────────

fn handle_normal_mode(app: &mut App, key: KeyEvent) {
	match key.code {
		// Quit
		KeyCode::Char('q') => app.should_quit = true,

		// Navigation: down
		KeyCode::Char('j') | KeyCode::Down => {
			let total = current_item_count(app);
			if let Some(list) = app.current_list_mut() {
				list.move_down(total);
			}
			sync_forum_table_state(app);
		}

		// Navigation: up
		KeyCode::Char('k') | KeyCode::Up => {
			if let Some(list) = app.current_list_mut() {
				list.move_up();
			}
			sync_forum_table_state(app);
		}

		// Jump to top
		KeyCode::Char('g') => {
			if let Some(list) = app.current_list_mut() {
				list.jump_top();
			}
			sync_forum_table_state(app);
		}

		// Jump to bottom
		KeyCode::Char('G') => {
			let total = current_item_count(app);
			if let Some(list) = app.current_list_mut() {
				list.jump_bottom(total);
			}
			sync_forum_table_state(app);
		}

		// Enter selection
		KeyCode::Enter => handle_enter(app),

		// Go back
		KeyCode::Esc | KeyCode::Backspace => {
			app.pop_view();
		}

		// Enter search mode
		KeyCode::Char('/') => {
			app.input_mode = InputMode::Search;
		}

		// Login
		KeyCode::Char('L') => {
			if app.logged_in_user.is_none() {
				app.input_mode = InputMode::Login;
				app.login_form.reset();
			}
		}

		// View user profile of current item's author
		KeyCode::Char('u') => handle_view_user(app),

		// Next page (load more)
		KeyCode::Char('n') => match &app.current_view {
			ViewState::Threads { forum_id, list, .. } if list.has_more => {
				let fid = *forum_id;
				app.pending_action = Some(PendingAction::LoadMoreThreads { forum_id: fid });
				app.status_message = Some("loading more...".to_string());
			}
			ViewState::Posts {
				thread_id, list, ..
			} if list.has_more => {
				let tid = *thread_id;
				app.pending_action = Some(PendingAction::LoadMorePosts { thread_id: tid });
				app.status_message = Some("loading more...".to_string());
			}
			_ => {}
		},

		// Refresh current view
		KeyCode::Char('r') => {
			app.pending_action = Some(PendingAction::RefreshCurrentView);
			app.status_message = Some("refreshing...".to_string());
		}

		// Cycle theme
		KeyCode::Char('t') => {
			let next = app.theme.next();
			next.save(&mut app.config);
			app.theme = next;
			let label = next.label();
			match app.config.write(None) {
				Ok(()) => app.status_message = Some(format!("theme: {label}")),
				Err(_) => app.status_message = Some(format!("theme: {label} (save failed)")),
			}
		}

		// Help panel
		KeyCode::Char('?') => {
			app.input_mode = InputMode::Help;
		}

		// Ctrl+C always quits
		KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => {
			app.should_quit = true;
		}

		_ => {}
	}
}

// ─── Search Mode ─────────────────────────────────────────

fn handle_search_mode(app: &mut App, key: KeyEvent) {
	match key.code {
		// Exit search
		KeyCode::Enter | KeyCode::Esc => {
			app.input_mode = InputMode::Normal;
		}

		// Delete character
		KeyCode::Backspace => {
			if let Some(list) = app.current_list_mut() {
				list.search_query.pop();
				apply_current_filter(app);
			}
		}

		// Append character
		KeyCode::Char(c) => {
			if let Some(list) = app.current_list_mut() {
				list.search_query.push(c);
			}
			apply_current_filter(app);
		}

		_ => {}
	}
}

// ─── Login Mode ──────────────────────────────────────────

fn handle_login_mode(app: &mut App, key: KeyEvent) {
	match key.code {
		// Cancel login
		KeyCode::Esc => {
			app.input_mode = InputMode::Normal;
			app.login_form.reset();
		}

		// Submit login
		KeyCode::Enter => {
			let username = app.login_form.username.clone();
			let password = app.login_form.password.clone();
			app.input_mode = InputMode::Normal;
			app.pending_action = Some(PendingAction::Login { username, password });
			app.status_message = Some("logging in...".to_string());
		}

		// Toggle field focus
		KeyCode::Tab | KeyCode::BackTab => {
			app.login_form.toggle_focus();
		}

		// Delete character in current field
		KeyCode::Backspace => {
			app.login_form.active_field_mut().pop();
		}

		// Type character into current field
		KeyCode::Char(c) => {
			app.login_form.active_field_mut().push(c);
		}

		_ => {}
	}
}

// ─── Help Mode ───────────────────────────────────────────

fn handle_help_mode(app: &mut App, key: KeyEvent) {
	match key.code {
		KeyCode::Esc | KeyCode::Char('q') | KeyCode::Char('?') => {
			app.input_mode = InputMode::Normal;
		}
		_ => {}
	}
}

// ─── Helpers ─────────────────────────────────────────────

/// Get the total number of items in the current view's data cache.
/// For Forums view, this returns the tree node count (which may differ from
/// the flat `forums.len()` if orphan grouping changes).
fn current_item_count(app: &App) -> usize {
	match &app.current_view {
		ViewState::Forums { .. } => {
			let tree = forum_list::build_forum_tree(&app.forums);
			tree.len()
		}
		ViewState::Threads { .. } => app.threads.len(),
		ViewState::Posts { .. } => app.posts.len(),
		ViewState::User { .. } => 0,
	}
}

/// Handle Enter key: drill into the selected item.
fn handle_enter(app: &mut App) {
	match &app.current_view {
		ViewState::Forums { list, .. } => {
			// Use the tree to find the correct forum — skip groups.
			let tree = forum_list::build_forum_tree(&app.forums);
			let row = list.selected_row;
			if let Some(node) = tree.get(row) {
				if node.is_group {
					return; // Groups are headers, not navigable
				}
				let forum_id = node.forum.id;
				let forum_name = node.forum.name.clone();
				app.push_view(ViewState::Threads {
					forum_id,
					forum_name,
					list: Default::default(),
				});
				schedule_data_load(app);
				app.status_message = Some("loading threads...".to_string());
			}
		}
		ViewState::Threads { .. } => {
			let idx = match app.current_list_mut() {
				Some(list) => list.selected_index(),
				None => return,
			};
			if let Some(thread) = app.threads.get(idx) {
				let thread_id = thread.id;
				let subject = thread.subject.clone();
				app.push_view(ViewState::Posts {
					thread_id,
					subject,
					list: Default::default(),
				});
				schedule_data_load(app);
				app.status_message = Some("loading posts...".to_string());
			}
		}
		// In posts view or user view, Enter does nothing
		ViewState::Posts { .. } | ViewState::User { .. } => {}
	}
}

/// Handle 'u' key: view the author profile of the currently selected item.
fn handle_view_user(app: &mut App) {
	let idx = match app.current_list_mut() {
		Some(list) => list.selected_index(),
		None => return,
	};

	let user_id = match &app.current_view {
		ViewState::Threads { .. } => app.threads.get(idx).map(|t| t.author_id),
		ViewState::Posts { .. } => app.posts.get(idx).map(|p| p.author_id),
		_ => None,
	};

	if let Some(uid) = user_id {
		app.current_user = None; // Clear stale data before loading new profile
		app.push_view(ViewState::User { user_id: uid });
		schedule_data_load(app);
		app.status_message = Some("loading user profile...".to_string());
	}
}

/// Apply the current search filter to the active view's data.
fn apply_current_filter(app: &mut App) {
	// We must avoid simultaneous borrows of app.forums/threads/posts (immutable)
	// and app.current_view (mutable). We match on current_view mutably and access
	// the data fields directly since they don't overlap with the view enum.
	match &mut app.current_view {
		ViewState::Forums { list, .. } => {
			list.apply_filter(&app.forums, |f, q| f.name.to_lowercase().contains(q));
		}
		ViewState::Threads { list, .. } => {
			list.apply_filter(&app.threads, |t, q| t.subject.to_lowercase().contains(q));
		}
		ViewState::Posts { list, .. } => {
			list.apply_filter(&app.posts, |p, q| p.content.to_lowercase().contains(q));
		}
		ViewState::User { .. } => {}
	}
}

/// Keep the ratatui `TableState` selection in sync with the `ListState`
/// for the Forums view. Called after any navigation action.
fn sync_forum_table_state(app: &mut App) {
	if let ViewState::Forums {
		list, table_state, ..
	} = &mut app.current_view
	{
		table_state.select(Some(list.selected_row));
	}
}

#[cfg(test)]
mod tests {
	use ellie_core::config::Config;

	use super::*;

	fn make_app() -> App {
		App::new(Config::default_config())
	}

	fn key(code: KeyCode) -> KeyEvent {
		KeyEvent::new(code, KeyModifiers::NONE)
	}

	fn key_with_mod(code: KeyCode, modifiers: KeyModifiers) -> KeyEvent {
		KeyEvent::new(code, modifiers)
	}

	// ─── Normal mode tests ─────────────────────────────

	#[test]
	fn quit_on_q() {
		let mut app = make_app();
		handle_key_event(&mut app, key(KeyCode::Char('q')));
		assert!(app.should_quit);
	}

	#[test]
	fn quit_on_ctrl_c() {
		let mut app = make_app();
		handle_key_event(
			&mut app,
			key_with_mod(KeyCode::Char('c'), KeyModifiers::CONTROL),
		);
		assert!(app.should_quit);
	}

	#[test]
	fn navigate_down_up() {
		let mut app = make_app();
		// Add some forums so we have items to navigate
		app.forums = vec![
			dummy_forum(1, "A"),
			dummy_forum(2, "B"),
			dummy_forum(3, "C"),
		];

		handle_key_event(&mut app, key(KeyCode::Char('j')));
		assert_eq!(app.current_list_mut().unwrap().selected_row, 1);

		handle_key_event(&mut app, key(KeyCode::Char('k')));
		assert_eq!(app.current_list_mut().unwrap().selected_row, 0);
	}

	#[test]
	fn navigate_with_arrow_keys() {
		let mut app = make_app();
		app.forums = vec![dummy_forum(1, "A"), dummy_forum(2, "B")];

		handle_key_event(&mut app, key(KeyCode::Down));
		assert_eq!(app.current_list_mut().unwrap().selected_row, 1);

		handle_key_event(&mut app, key(KeyCode::Up));
		assert_eq!(app.current_list_mut().unwrap().selected_row, 0);
	}

	#[test]
	fn jump_top_and_bottom() {
		let mut app = make_app();
		app.forums = vec![
			dummy_forum(1, "A"),
			dummy_forum(2, "B"),
			dummy_forum(3, "C"),
		];

		handle_key_event(&mut app, key(KeyCode::Char('G')));
		assert_eq!(app.current_list_mut().unwrap().selected_row, 2);

		handle_key_event(&mut app, key(KeyCode::Char('g')));
		assert_eq!(app.current_list_mut().unwrap().selected_row, 0);
	}

	#[test]
	fn enter_drills_into_forum() {
		let mut app = make_app();
		app.forums = vec![dummy_forum(1, "Campus")];

		handle_key_event(&mut app, key(KeyCode::Enter));
		match &app.current_view {
			ViewState::Threads {
				forum_id,
				forum_name,
				..
			} => {
				assert_eq!(*forum_id, 1);
				assert_eq!(forum_name, "Campus");
			}
			_ => panic!("expected Threads view"),
		}
		assert_eq!(app.view_stack.len(), 1);
	}

	#[test]
	fn esc_pops_view() {
		let mut app = make_app();
		app.forums = vec![dummy_forum(1, "A")];
		handle_key_event(&mut app, key(KeyCode::Enter)); // push Threads
		handle_key_event(&mut app, key(KeyCode::Esc)); // pop back
		assert!(matches!(app.current_view, ViewState::Forums { .. }));
	}

	#[test]
	fn backspace_pops_view() {
		let mut app = make_app();
		app.forums = vec![dummy_forum(1, "A")];
		handle_key_event(&mut app, key(KeyCode::Enter));
		handle_key_event(&mut app, key(KeyCode::Backspace));
		assert!(matches!(app.current_view, ViewState::Forums { .. }));
	}

	#[test]
	fn slash_enters_search_mode() {
		let mut app = make_app();
		handle_key_event(&mut app, key(KeyCode::Char('/')));
		assert_eq!(app.input_mode, InputMode::Search);
	}

	#[test]
	fn l_enters_login_mode_when_not_logged_in() {
		let mut app = make_app();
		handle_key_event(&mut app, key(KeyCode::Char('L')));
		assert_eq!(app.input_mode, InputMode::Login);
	}

	#[test]
	fn l_does_nothing_when_logged_in() {
		let mut app = make_app();
		app.logged_in_user = Some(ellie_core::types::LoggedUser {
			user_id: 1,
			username: "alice".to_string(),
			role: ellie_core::types::UserRole::User,
		});
		handle_key_event(&mut app, key(KeyCode::Char('L')));
		assert_eq!(app.input_mode, InputMode::Normal);
	}

	#[test]
	fn t_cycles_theme() {
		let mut app = make_app();
		use crate::app::Theme;
		assert_eq!(app.theme, Theme::Default);

		handle_key_event(&mut app, key(KeyCode::Char('t')));
		assert_eq!(app.theme, Theme::Dracula);
		assert_eq!(app.config.theme, "dracula");

		handle_key_event(&mut app, key(KeyCode::Char('t')));
		assert_eq!(app.theme, Theme::Nord);
		assert_eq!(app.config.theme, "nord");

		handle_key_event(&mut app, key(KeyCode::Char('t')));
		assert_eq!(app.theme, Theme::Default);
		assert_eq!(app.config.theme, "default");
	}

	#[test]
	fn r_sets_refreshing_status() {
		let mut app = make_app();
		handle_key_event(&mut app, key(KeyCode::Char('r')));
		assert!(app.status_message.as_ref().unwrap().contains("refreshing"));
	}

	#[test]
	fn n_sets_loading_more_status() {
		let mut app = make_app();
		// Must be in a Threads view with has_more=true for 'n' to trigger
		app.push_view(ViewState::Threads {
			forum_id: 1,
			forum_name: "Test".to_string(),
			list: crate::app::ListState::default(), // has_more defaults to true
		});
		app.threads = vec![dummy_thread(1, 1, "T1", 1)];
		handle_key_event(&mut app, key(KeyCode::Char('n')));
		assert!(
			app.status_message
				.as_ref()
				.unwrap()
				.contains("loading more")
		);
		assert_eq!(
			app.pending_action,
			Some(PendingAction::LoadMoreThreads { forum_id: 1 })
		);
	}

	#[test]
	fn n_does_nothing_in_forums_view() {
		let mut app = make_app();
		app.pending_action = None;
		handle_key_event(&mut app, key(KeyCode::Char('n')));
		// 'n' in forums view does nothing
		assert!(app.pending_action.is_none());
	}

	// ─── Search mode tests ─────────────────────────────

	#[test]
	fn search_mode_typing() {
		let mut app = make_app();
		app.forums = vec![dummy_forum(1, "Apple"), dummy_forum(2, "Banana")];
		app.input_mode = InputMode::Search;

		handle_key_event(&mut app, key(KeyCode::Char('a')));
		assert_eq!(app.current_list_mut().unwrap().search_query, "a");
		// Filter should be applied: both "Apple" and "Banana" contain "a"
		assert_eq!(app.current_list_mut().unwrap().filtered_indices, vec![0, 1]);
	}

	#[test]
	fn search_mode_backspace() {
		let mut app = make_app();
		app.forums = vec![dummy_forum(1, "Apple"), dummy_forum(2, "Banana")];
		app.input_mode = InputMode::Search;

		handle_key_event(&mut app, key(KeyCode::Char('x')));
		assert_eq!(app.current_list_mut().unwrap().search_query, "x");

		handle_key_event(&mut app, key(KeyCode::Backspace));
		assert_eq!(app.current_list_mut().unwrap().search_query, "");
	}

	#[test]
	fn search_mode_enter_exits() {
		let mut app = make_app();
		app.input_mode = InputMode::Search;
		handle_key_event(&mut app, key(KeyCode::Enter));
		assert_eq!(app.input_mode, InputMode::Normal);
	}

	#[test]
	fn search_mode_esc_exits() {
		let mut app = make_app();
		app.input_mode = InputMode::Search;
		handle_key_event(&mut app, key(KeyCode::Esc));
		assert_eq!(app.input_mode, InputMode::Normal);
	}

	// ─── Login mode tests ──────────────────────────────

	#[test]
	fn login_mode_typing() {
		let mut app = make_app();
		app.input_mode = InputMode::Login;

		handle_key_event(&mut app, key(KeyCode::Char('a')));
		assert_eq!(app.login_form.username, "a");

		handle_key_event(&mut app, key(KeyCode::Tab));
		handle_key_event(&mut app, key(KeyCode::Char('p')));
		assert_eq!(app.login_form.password, "p");
	}

	#[test]
	fn login_mode_backspace() {
		let mut app = make_app();
		app.input_mode = InputMode::Login;

		handle_key_event(&mut app, key(KeyCode::Char('a')));
		handle_key_event(&mut app, key(KeyCode::Char('b')));
		handle_key_event(&mut app, key(KeyCode::Backspace));
		assert_eq!(app.login_form.username, "a");
	}

	#[test]
	fn login_mode_esc_cancels() {
		let mut app = make_app();
		app.input_mode = InputMode::Login;
		handle_key_event(&mut app, key(KeyCode::Char('a')));
		handle_key_event(&mut app, key(KeyCode::Esc));
		assert_eq!(app.input_mode, InputMode::Normal);
		// Form should be reset
		assert!(app.login_form.username.is_empty());
	}

	#[test]
	fn login_mode_enter_submits() {
		let mut app = make_app();
		app.input_mode = InputMode::Login;
		handle_key_event(&mut app, key(KeyCode::Enter));
		assert_eq!(app.input_mode, InputMode::Normal);
		assert!(app.status_message.as_ref().unwrap().contains("logging in"));
	}

	// ─── View user tests ───────────────────────────────

	#[test]
	fn u_views_thread_author() {
		let mut app = make_app();
		app.forums = vec![dummy_forum(1, "F")];
		handle_key_event(&mut app, key(KeyCode::Enter)); // push Threads
		app.threads = vec![dummy_thread(10, 1, "Thread1", 42)];

		handle_key_event(&mut app, key(KeyCode::Char('u')));
		match &app.current_view {
			ViewState::User { user_id } => assert_eq!(*user_id, 42),
			_ => panic!("expected User view"),
		}
	}

	#[test]
	fn u_clears_current_user_before_loading() {
		let mut app = make_app();
		// Set a stale user from a previous view
		app.current_user = Some(ellie_core::types::User {
			id: 99,
			username: "stale".to_string(),
			role: ellie_core::types::UserRole::User,
			status: ellie_core::types::UserStatus::Active,
			posts: 0,
			threads: 0,
			credits: 0,
			email: String::new(),
			avatar: String::new(),
			reg_date: 0,
			last_login: 0,
		});

		app.forums = vec![dummy_forum(1, "F")];
		handle_key_event(&mut app, key(KeyCode::Enter)); // push Threads
		app.threads = vec![dummy_thread(10, 1, "Thread1", 42)];

		handle_key_event(&mut app, key(KeyCode::Char('u')));
		// current_user should be cleared so the loading state shows
		assert!(app.current_user.is_none());
	}

	// ─── Help mode tests ──────────────────────────────

	#[test]
	fn question_mark_opens_help() {
		let mut app = make_app();
		handle_key_event(&mut app, key(KeyCode::Char('?')));
		assert_eq!(app.input_mode, InputMode::Help);
	}

	#[test]
	fn help_mode_esc_closes() {
		let mut app = make_app();
		app.input_mode = InputMode::Help;
		handle_key_event(&mut app, key(KeyCode::Esc));
		assert_eq!(app.input_mode, InputMode::Normal);
	}

	#[test]
	fn help_mode_q_closes() {
		let mut app = make_app();
		app.input_mode = InputMode::Help;
		handle_key_event(&mut app, key(KeyCode::Char('q')));
		assert_eq!(app.input_mode, InputMode::Normal);
	}

	#[test]
	fn help_mode_question_mark_toggles() {
		let mut app = make_app();
		app.input_mode = InputMode::Help;
		handle_key_event(&mut app, key(KeyCode::Char('?')));
		assert_eq!(app.input_mode, InputMode::Normal);
	}

	// ─── Helpers ───────────────────────────────────────

	fn dummy_forum(id: u64, name: &str) -> ellie_core::types::Forum {
		ellie_core::types::Forum {
			id,
			parent_id: 0,
			name: name.to_string(),
			description: String::new(),
			icon: String::new(),
			display_order: 0,
			threads: 0,
			posts: 0,
			forum_type: ellie_core::types::ForumType::Forum,
			status: 1,
			last_thread_id: 0,
			last_post_at: 0,
			last_poster: String::new(),
		}
	}

	fn dummy_thread(
		id: u64,
		forum_id: u64,
		subject: &str,
		author_id: u64,
	) -> ellie_core::types::Thread {
		ellie_core::types::Thread {
			id,
			forum_id,
			subject: subject.to_string(),
			author_id,
			author_name: "user".to_string(),
			created_at: 0,
			views: 0,
			replies: 0,
			last_post_at: 0,
			last_poster: "user".to_string(),
			sticky: ellie_core::types::StickyLevel::None,
			digest: 0,
			closed: 0,
			special: 0,
			highlight: 0,
			recommends: 0,
		}
	}
}
