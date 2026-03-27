mod helpers;

use ellie_core::types::{ApiResponse, Forum, Post, Thread};

// ─── D1 Isolation Verification ──────────────────────────

#[test]
#[ignore] // Run with: cargo test --test integration -- --ignored
fn d1_isolation_gate() {
	let client = helpers::test_client();
	helpers::assert_test_environment(&client);
}

// ─── GET /api/v1/forums ─────────────────────────────────

#[test]
#[ignore]
fn get_forums_e2e() {
	let client = helpers::test_client();
	helpers::assert_test_environment(&client);

	let result: ApiResponse<Vec<Forum>> = client.get_forums().unwrap();
	assert!(!result.data.is_empty(), "forums list should not be empty");

	// Verify forum structure
	let first = &result.data[0];
	assert!(first.id > 0);
	assert!(!first.name.is_empty());
}

// ─── GET /api/v1/threads with pagination ────────────────

#[test]
#[ignore]
fn get_threads_pagination_e2e() {
	let client = helpers::test_client();
	helpers::assert_test_environment(&client);

	// First, get forums to find a valid forum_id
	let forums: ApiResponse<Vec<Forum>> = client.get_forums().unwrap();
	assert!(
		!forums.data.is_empty(),
		"need at least one forum for thread test"
	);

	let forum_id = forums.data[0].id;

	// Fetch first page (small limit to test pagination)
	let page1: ApiResponse<Vec<Thread>> = client.get_threads(forum_id, 2, None).unwrap();
	// The forum might have threads or not, but the call should succeed
	assert!(page1.data.len() <= 2, "should respect limit");

	// If there's pagination, fetch next page
	if let Some(pg) = &page1.pagination {
		if pg.has_more {
			let cursor = pg.next_cursor.as_deref().unwrap();
			let page2: ApiResponse<Vec<Thread>> =
				client.get_threads(forum_id, 2, Some(cursor)).unwrap();
			assert!(page2.data.len() <= 2);

			// Pages should not overlap (different thread IDs)
			if !page1.data.is_empty() && !page2.data.is_empty() {
				let page1_ids: Vec<u64> = page1.data.iter().map(|t| t.id).collect();
				let page2_ids: Vec<u64> = page2.data.iter().map(|t| t.id).collect();
				for id in &page2_ids {
					assert!(
						!page1_ids.contains(id),
						"page2 should not contain page1 thread IDs"
					);
				}
			}
		}
	}
}

// ─── GET /api/v1/posts ──────────────────────────────────

#[test]
#[ignore]
fn get_posts_e2e() {
	let client = helpers::test_client();
	helpers::assert_test_environment(&client);

	// Get a thread to fetch posts for
	let forums: ApiResponse<Vec<Forum>> = client.get_forums().unwrap();
	assert!(!forums.data.is_empty());

	let threads: ApiResponse<Vec<Thread>> = client.get_threads(forums.data[0].id, 1, None).unwrap();
	if threads.data.is_empty() {
		// No threads in the first forum, skip
		return;
	}

	let thread_id = threads.data[0].id;
	let posts: ApiResponse<Vec<Post>> = client.get_posts(thread_id, 5, None).unwrap();
	assert!(
		!posts.data.is_empty(),
		"thread should have at least one post"
	);

	let first_post = &posts.data[0];
	assert_eq!(first_post.thread_id, thread_id);
	assert!(!first_post.content.is_empty());
}

// ─── POST /api/v1/auth/login ────────────────────────────

#[test]
#[ignore]
fn login_e2e() {
	let mut client = helpers::test_client();
	helpers::assert_test_environment(&client);

	// Test credentials must be provided via environment
	let username = std::env::var("ELLIE_TEST_USERNAME").expect("ELLIE_TEST_USERNAME must be set");
	let password = std::env::var("ELLIE_TEST_PASSWORD").expect("ELLIE_TEST_PASSWORD must be set");

	let result = client.login(&username, &password);
	match result {
		Ok(resp) => {
			assert!(!resp.token.is_empty());
			assert!(!resp.refresh_token.is_empty());
			assert_eq!(resp.user.username, username);
			assert!(client.is_authenticated());
		}
		Err(e) => {
			// If login fails due to invalid test credentials, that's informative
			panic!(
				"login failed: {e}. Ensure ELLIE_TEST_USERNAME/PASSWORD are valid test accounts."
			);
		}
	}
}

// ─── Authenticated endpoint access ─────────────────────

#[test]
#[ignore]
fn get_user_profile_e2e() {
	let mut client = helpers::test_client();
	helpers::assert_test_environment(&client);

	let username = std::env::var("ELLIE_TEST_USERNAME").expect("ELLIE_TEST_USERNAME must be set");
	let password = std::env::var("ELLIE_TEST_PASSWORD").expect("ELLIE_TEST_PASSWORD must be set");

	let login_resp = client.login(&username, &password).unwrap();
	let user_id = login_resp.user.user_id;

	// Fetch own profile
	let user_resp = client.get_user(user_id).unwrap();
	assert_eq!(user_resp.data.username, username);
	assert!(user_resp.data.id > 0);
}
