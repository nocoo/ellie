use ellie_core::client::AuthExpiredError;
use ellie_core::pagination::DEFAULT_PAGE_SIZE;

use crate::app::{App, InputMode, PendingAction, ViewState};

/// Process the pending action, if any. This runs network I/O synchronously
/// (ureq is blocking) and updates App state with the results.
pub fn dispatch_pending_action(app: &mut App) {
	let action = match app.pending_action.take() {
		Some(a) => a,
		None => return,
	};

	app.loading = true;

	match action {
		PendingAction::LoadForums => load_forums(app),
		PendingAction::LoadThreads { forum_id } => load_threads(app, forum_id, false),
		PendingAction::LoadMoreThreads { forum_id } => load_threads(app, forum_id, true),
		PendingAction::LoadPosts { thread_id } => load_posts(app, thread_id, false),
		PendingAction::LoadMorePosts { thread_id } => load_posts(app, thread_id, true),
		PendingAction::LoadUser { user_id } => load_user(app, user_id),
		PendingAction::Login { username, password } => do_login(app, &username, &password),
		PendingAction::RefreshCurrentView => refresh_current(app),
	}

	app.loading = false;
}

// ─── Individual action handlers ─────────────────────────

fn load_forums(app: &mut App) {
	match app.client.get_forums() {
		Ok(resp) => {
			app.forums = resp.data;
			app.status_message = Some(format!("loaded {} forums", app.forums.len()));
		}
		Err(e) => {
			if handle_auth_expired(app, &e) {
				return;
			}
			app.status_message = Some(format!("error: {e}"));
		}
	}
}

fn load_threads(app: &mut App, forum_id: u64, append: bool) {
	let cursor = if append { current_cursor(app) } else { None };

	match app
		.client
		.get_threads(forum_id, DEFAULT_PAGE_SIZE, cursor.as_deref())
	{
		Ok(resp) => {
			// Extract pagination before moving data
			let has_more = resp.has_more();
			let next_cursor = resp.next_cursor().map(String::from);

			if append {
				app.threads.extend(resp.data);
			} else {
				app.threads = resp.data;
			}

			// Update pagination state
			if let Some(list) = app.current_list_mut() {
				list.next_cursor = next_cursor;
				list.has_more = has_more;
			}

			let count = app.threads.len();
			app.status_message = Some(format!("loaded {count} threads"));
		}
		Err(e) => {
			if handle_auth_expired(app, &e) {
				return;
			}
			app.status_message = Some(format!("error: {e}"));
		}
	}
}

fn load_posts(app: &mut App, thread_id: u64, append: bool) {
	let cursor = if append { current_cursor(app) } else { None };

	match app
		.client
		.get_posts(thread_id, DEFAULT_PAGE_SIZE, cursor.as_deref())
	{
		Ok(resp) => {
			// Extract pagination before moving data
			let has_more = resp.has_more();
			let next_cursor = resp.next_cursor().map(String::from);

			if append {
				app.posts.extend(resp.data);
			} else {
				app.posts = resp.data;
			}

			if let Some(list) = app.current_list_mut() {
				list.next_cursor = next_cursor;
				list.has_more = has_more;
			}

			let count = app.posts.len();
			app.status_message = Some(format!("loaded {count} posts"));
		}
		Err(e) => {
			if handle_auth_expired(app, &e) {
				return;
			}
			app.status_message = Some(format!("error: {e}"));
		}
	}
}

fn load_user(app: &mut App, user_id: u64) {
	match app.client.get_user(user_id) {
		Ok(resp) => {
			app.current_user = Some(resp.data);
			app.status_message = None;
		}
		Err(e) => {
			if handle_auth_expired(app, &e) {
				return;
			}
			app.current_user = None; // Clear stale data on failure
			app.status_message = Some(format!("error: {e}"));
		}
	}
}

fn do_login(app: &mut App, username: &str, password: &str) {
	match app.client.login(username, password) {
		Ok(resp) => {
			// Persist auth to config
			app.config.set_auth(resp.token, resp.user.clone());
			if let Err(e) = app.config.write(None) {
				app.status_message = Some(format!("logged in, but failed to save config: {e}"));
			} else {
				app.status_message = Some(format!("welcome, {}!", resp.user.username));
			}
			app.logged_in_user = Some(resp.user);
			app.login_form.reset();
		}
		Err(e) => {
			app.login_form.error = Some(format!("{e}"));
			app.input_mode = InputMode::Login; // stay in login mode
			app.status_message = Some(format!("login failed: {e}"));
		}
	}
}

fn refresh_current(app: &mut App) {
	match &app.current_view {
		ViewState::Forums { .. } => {
			app.pending_action = Some(PendingAction::LoadForums);
			dispatch_pending_action(app);
		}
		ViewState::Threads { forum_id, .. } => {
			let fid = *forum_id;
			// Reset pagination
			if let Some(list) = app.current_list_mut() {
				list.next_cursor = None;
				list.has_more = true;
			}
			load_threads(app, fid, false);
		}
		ViewState::Posts { thread_id, .. } => {
			let tid = *thread_id;
			if let Some(list) = app.current_list_mut() {
				list.next_cursor = None;
				list.has_more = true;
			}
			load_posts(app, tid, false);
		}
		ViewState::User { user_id } => {
			let uid = *user_id;
			load_user(app, uid);
		}
	}
}

// ─── Helpers ────────────────────────────────────────────

/// Get the next_cursor from the current view's list state.
fn current_cursor(app: &App) -> Option<String> {
	match &app.current_view {
		ViewState::Forums { list }
		| ViewState::Threads { list, .. }
		| ViewState::Posts { list, .. } => list.next_cursor.clone(),
		ViewState::User { .. } => None,
	}
}

/// Handle TOKEN_EXPIRED errors by clearing auth state and prompting re-login.
/// Returns true if the error was an auth expiry.
fn handle_auth_expired(app: &mut App, error: &anyhow::Error) -> bool {
	if error.downcast_ref::<AuthExpiredError>().is_some() {
		app.config.clear_auth();
		let _ = app.config.write(None);
		app.client.logout();
		app.logged_in_user = None;
		app.status_message = Some("session expired, please login again (L)".to_string());
		return true;
	}
	false
}

/// Set up actions when entering a new view. Called after push_view by event handlers.
pub fn schedule_data_load(app: &mut App) {
	match &app.current_view {
		ViewState::Forums { .. } => {
			if app.forums.is_empty() {
				app.pending_action = Some(PendingAction::LoadForums);
			}
		}
		ViewState::Threads { forum_id, .. } => {
			let fid = *forum_id;
			app.pending_action = Some(PendingAction::LoadThreads { forum_id: fid });
		}
		ViewState::Posts { thread_id, .. } => {
			let tid = *thread_id;
			app.pending_action = Some(PendingAction::LoadPosts { thread_id: tid });
		}
		ViewState::User { user_id } => {
			let uid = *user_id;
			app.pending_action = Some(PendingAction::LoadUser { user_id: uid });
		}
	}
}

#[cfg(test)]
mod tests {
	use ellie_core::config::Config;

	use super::*;
	use crate::app::ListState;

	#[test]
	fn schedule_load_forums_on_empty() {
		let mut app = App::new(Config::default_config());
		app.pending_action = None; // clear the initial LoadForums
		app.forums.clear();
		schedule_data_load(&mut app);
		assert_eq!(app.pending_action, Some(PendingAction::LoadForums));
	}

	#[test]
	fn schedule_load_threads_on_push() {
		let mut app = App::new(Config::default_config());
		app.pending_action = None;
		app.push_view(ViewState::Threads {
			forum_id: 5,
			forum_name: "Test".to_string(),
			list: ListState::default(),
		});
		schedule_data_load(&mut app);
		assert_eq!(
			app.pending_action,
			Some(PendingAction::LoadThreads { forum_id: 5 })
		);
	}

	#[test]
	fn schedule_load_posts_on_push() {
		let mut app = App::new(Config::default_config());
		app.pending_action = None;
		app.push_view(ViewState::Posts {
			thread_id: 42,
			subject: "Test".to_string(),
			list: ListState::default(),
		});
		schedule_data_load(&mut app);
		assert_eq!(
			app.pending_action,
			Some(PendingAction::LoadPosts { thread_id: 42 })
		);
	}

	#[test]
	fn schedule_load_user_on_push() {
		let mut app = App::new(Config::default_config());
		app.pending_action = None;
		app.push_view(ViewState::User { user_id: 99 });
		schedule_data_load(&mut app);
		assert_eq!(
			app.pending_action,
			Some(PendingAction::LoadUser { user_id: 99 })
		);
	}

	#[test]
	fn pending_action_default_is_load_forums() {
		let app = App::new(Config::default_config());
		assert_eq!(app.pending_action, Some(PendingAction::LoadForums));
	}

	#[test]
	fn current_cursor_returns_none_for_user_view() {
		let app = App::new(Config::default_config());
		// Default view is Forums, cursor is None
		assert!(current_cursor(&app).is_none());
	}
}
