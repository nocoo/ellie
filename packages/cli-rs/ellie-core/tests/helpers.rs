use ellie_core::client::ApiClient;
use ellie_core::types::LiveResponse;

/// Shared test client — reads URL/key from env, refuses to default to production.
pub fn test_client() -> ApiClient {
	ApiClient::new(
		std::env::var("ELLIE_API_URL").expect("ELLIE_API_URL must be set (use test Worker URL)"),
		std::env::var("ELLIE_API_KEY").expect("ELLIE_API_KEY must be set"),
	)
}

/// Verify the target Worker is running in test mode before any L2 test touches data.
/// Panics with a clear message if connected to production — prevents accidental
/// test traffic against real user data.
pub fn assert_test_environment(client: &ApiClient) {
	let live: LiveResponse = client.get_live().expect("GET /api/live failed");
	assert_eq!(
		live.environment, "test",
		"SAFETY: L2 tests must target a test Worker (environment={:?}), \
		 not production. Set ELLIE_API_URL to your test Worker URL.",
		live.environment
	);
}
