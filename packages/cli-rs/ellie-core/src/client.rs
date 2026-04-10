use std::fmt;
use std::thread;
use std::time::Duration;

use anyhow::Result;
use serde::de::DeserializeOwned;
use ureq::Agent;

use crate::types::{
	ApiResponse, ErrorResponse, Forum, LiveResponse, LoggedUser, LoginData, Post, Thread, User,
};

// ─── Errors ──────────────────────────────────────────────

/// Structured error for auth expiry — callers match on this to trigger re-login UI.
#[derive(Debug)]
pub struct AuthExpiredError;

impl fmt::Display for AuthExpiredError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "authentication token expired")
	}
}

impl std::error::Error for AuthExpiredError {}

/// API error with status code and structured error detail.
#[derive(Debug)]
pub struct ApiError {
	pub status: u16,
	pub code: String,
	pub message: String,
}

impl fmt::Display for ApiError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "[{}] {} (HTTP {})", self.code, self.message, self.status)
	}
}

impl std::error::Error for ApiError {}

// ─── Login Response ──────────────────────────────────────

/// Processed login result returned to callers.
#[derive(Debug)]
pub struct LoginResponse {
	pub token: String,
	pub refresh_token: String,
	pub user: LoggedUser,
}

// ─── Retry Configuration ─────────────────────────────────

const MAX_RETRIES: u32 = 3;
const INITIAL_BACKOFF_MS: u64 = 200;

// ─── Client ──────────────────────────────────────────────

pub struct ApiClient {
	agent: Agent,
	base_url: String,
	api_key: String,
	token: Option<String>,
	refresh_token: Option<String>,
}

impl ApiClient {
	pub fn new(base_url: String, api_key: String) -> Self {
		// Disable http_status_as_error so we can read 4xx/5xx response bodies
		// for structured error parsing (TOKEN_EXPIRED, etc.)
		let config = Agent::config_builder()
			.timeout_global(Some(std::time::Duration::from_secs(10)))
			.http_status_as_error(false)
			.build();
		let agent: Agent = config.into();
		Self {
			agent,
			base_url,
			api_key,
			token: None,
			refresh_token: None,
		}
	}

	pub fn set_token(&mut self, token: Option<String>) {
		self.token = token;
	}

	pub fn set_refresh_token(&mut self, refresh_token: Option<String>) {
		self.refresh_token = refresh_token;
	}

	pub fn is_authenticated(&self) -> bool {
		self.token.is_some()
	}

	/// GET request with auth headers and retry on transient errors.
	fn api_get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
		let url = format!("{}{}", self.base_url, path);

		for attempt in 0..MAX_RETRIES {
			let mut req = self.agent.get(&url).header("X-API-Key", &self.api_key);
			if let Some(token) = &self.token {
				req = req.header("Authorization", &format!("Bearer {token}"));
			}

			match req.call() {
				Ok(resp) => {
					let status: u16 = resp.status().into();
					if status >= 500 && attempt + 1 < MAX_RETRIES {
						// Server error — retry with backoff
						thread::sleep(backoff_duration(attempt));
						continue;
					}
					if status >= 400 {
						return self.parse_error(status, resp.into_body());
					}
					return Ok(resp.into_body().read_json()?);
				}
				Err(_e) if attempt + 1 < MAX_RETRIES => {
					// Network error — retry with backoff
					thread::sleep(backoff_duration(attempt));
					continue;
				}
				Err(e) => return Err(e.into()),
			}
		}
		unreachable!("retry loop should return within MAX_RETRIES attempts");
	}

	/// POST request with JSON body, auth headers, and retry on transient errors.
	fn api_post<T: DeserializeOwned>(&self, path: &str, body: &serde_json::Value) -> Result<T> {
		let url = format!("{}{}", self.base_url, path);

		for attempt in 0..MAX_RETRIES {
			let mut req = self.agent.post(&url).header("X-API-Key", &self.api_key);
			if let Some(token) = &self.token {
				req = req.header("Authorization", &format!("Bearer {token}"));
			}

			match req.send_json(body) {
				Ok(resp) => {
					let status: u16 = resp.status().into();
					if status >= 500 && attempt + 1 < MAX_RETRIES {
						thread::sleep(backoff_duration(attempt));
						continue;
					}
					if status >= 400 {
						return self.parse_error(status, resp.into_body());
					}
					return Ok(resp.into_body().read_json()?);
				}
				Err(_e) if attempt + 1 < MAX_RETRIES => {
					thread::sleep(backoff_duration(attempt));
					continue;
				}
				Err(e) => return Err(e.into()),
			}
		}
		unreachable!("retry loop should return within MAX_RETRIES attempts");
	}

	/// Parse the Worker's `{ error: { code, message } }` envelope from an error response.
	fn parse_error<T>(&self, status: u16, mut body: ureq::Body) -> Result<T> {
		// Consume the body as a string to parse the error envelope
		match body.read_to_string() {
			Ok(text) => {
				if let Ok(err) = serde_json::from_str::<ErrorResponse>(&text) {
					if status == 401 && err.error.code == "TOKEN_EXPIRED" {
						return Err(AuthExpiredError.into());
					}
					return Err(ApiError {
						status,
						code: err.error.code,
						message: err.error.message,
					}
					.into());
				}
				// Couldn't parse as ErrorResponse
				Err(ApiError {
					status,
					code: format!("HTTP_{status}"),
					message: text,
				}
				.into())
			}
			Err(_) => Err(ApiError {
				status,
				code: format!("HTTP_{status}"),
				message: format!("server returned HTTP {status} with unreadable body"),
			}
			.into()),
		}
	}

	// ─── Public API methods ──────────────────────────────

	/// Health check — `GET /api/live` (no API key required).
	pub fn get_live(&self) -> Result<LiveResponse> {
		let url = format!("{}/api/live", self.base_url);
		let resp = self.agent.get(&url).call()?;
		Ok(resp.into_body().read_json()?)
	}

	/// Fetch all forums.
	pub fn get_forums(&self) -> Result<ApiResponse<Vec<Forum>>> {
		self.api_get("/api/v1/forums")
	}

	/// Fetch a single forum by ID.
	pub fn get_forum(&self, forum_id: u64) -> Result<ApiResponse<Forum>> {
		self.api_get(&format!("/api/v1/forums/{forum_id}"))
	}

	/// Fetch threads for a forum with cursor pagination.
	/// Cursor values are URL-encoded to handle base64 special chars.
	pub fn get_threads(
		&self,
		forum_id: u64,
		limit: usize,
		cursor: Option<&str>,
	) -> Result<ApiResponse<Vec<Thread>>> {
		let cursor_param = cursor
			.map(|c| format!("&cursor={}", urlencoding::encode(c)))
			.unwrap_or_default();
		self.api_get(&format!(
			"/api/v1/threads?forumId={forum_id}&limit={limit}{cursor_param}"
		))
	}

	/// Fetch a single thread by ID.
	pub fn get_thread(&self, thread_id: u64) -> Result<ApiResponse<Thread>> {
		self.api_get(&format!("/api/v1/threads/{thread_id}"))
	}

	/// Fetch posts for a thread with cursor pagination.
	pub fn get_posts(
		&self,
		thread_id: u64,
		limit: usize,
		cursor: Option<&str>,
	) -> Result<ApiResponse<Vec<Post>>> {
		let cursor_param = cursor
			.map(|c| format!("&cursor={}", urlencoding::encode(c)))
			.unwrap_or_default();
		self.api_get(&format!(
			"/api/v1/posts?threadId={thread_id}&limit={limit}{cursor_param}"
		))
	}

	/// Fetch a single post by ID.
	pub fn get_post(&self, post_id: u64) -> Result<ApiResponse<Post>> {
		self.api_get(&format!("/api/v1/posts/{post_id}"))
	}

	/// Fetch a user profile by ID.
	pub fn get_user(&self, user_id: u64) -> Result<ApiResponse<User>> {
		self.api_get(&format!("/api/v1/users/{user_id}"))
	}

	/// Login with username/password. Returns token + user info for caller to persist.
	pub fn login(&mut self, username: &str, password: &str) -> Result<LoginResponse> {
		let body = serde_json::json!({ "username": username, "password": password });
		let res: ApiResponse<LoginData> = self.api_post("/api/v1/auth/login", &body)?;
		self.token = Some(res.data.token.clone());
		self.refresh_token = Some(res.data.refresh_token.clone());
		Ok(LoginResponse {
			token: res.data.token,
			refresh_token: res.data.refresh_token,
			user: res.data.user,
		})
	}

	/// Refresh the JWT using the stored refresh token.
	/// Returns a new LoginResponse with rotated tokens.
	pub fn refresh(&mut self) -> Result<LoginResponse> {
		let refresh_token = self
			.refresh_token
			.clone()
			.ok_or_else(|| anyhow::anyhow!("no refresh token available"))?;

		let body = serde_json::json!({ "refreshToken": refresh_token });
		let res: ApiResponse<LoginData> = self.api_post("/api/v1/auth/refresh", &body)?;
		self.token = Some(res.data.token.clone());
		self.refresh_token = Some(res.data.refresh_token.clone());
		Ok(LoginResponse {
			token: res.data.token,
			refresh_token: res.data.refresh_token,
			user: res.data.user,
		})
	}

	/// Check if a refresh token is available for auto-refresh.
	pub fn has_refresh_token(&self) -> bool {
		self.refresh_token.is_some()
	}

	/// Clear local auth state.
	pub fn logout(&mut self) {
		self.token = None;
		self.refresh_token = None;
	}
}

/// Exponential backoff: 200ms, 400ms, 800ms, ...
fn backoff_duration(attempt: u32) -> Duration {
	Duration::from_millis(INITIAL_BACKOFF_MS * 2u64.pow(attempt))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn client_creation() {
		let client = ApiClient::new("https://example.com".to_string(), "test-key".to_string());
		assert!(!client.is_authenticated());
	}

	#[test]
	fn client_set_token() {
		let mut client = ApiClient::new("https://example.com".to_string(), "test-key".to_string());
		assert!(!client.is_authenticated());

		client.set_token(Some("jwt-token".to_string()));
		assert!(client.is_authenticated());

		client.logout();
		assert!(!client.is_authenticated());
	}

	#[test]
	fn auth_expired_error_display() {
		let err = AuthExpiredError;
		assert_eq!(err.to_string(), "authentication token expired");
	}

	#[test]
	fn api_error_display() {
		let err = ApiError {
			status: 404,
			code: "NOT_FOUND".to_string(),
			message: "resource not found".to_string(),
		};
		assert_eq!(err.to_string(), "[NOT_FOUND] resource not found (HTTP 404)");
	}

	#[test]
	fn auth_expired_error_downcast() {
		let err: anyhow::Error = AuthExpiredError.into();
		assert!(err.downcast_ref::<AuthExpiredError>().is_some());
	}

	#[test]
	fn api_error_downcast() {
		let err: anyhow::Error = ApiError {
			status: 500,
			code: "INTERNAL".to_string(),
			message: "boom".to_string(),
		}
		.into();
		let api_err = err.downcast_ref::<ApiError>().unwrap();
		assert_eq!(api_err.status, 500);
	}

	#[test]
	fn backoff_duration_exponential() {
		assert_eq!(backoff_duration(0), Duration::from_millis(200));
		assert_eq!(backoff_duration(1), Duration::from_millis(400));
		assert_eq!(backoff_duration(2), Duration::from_millis(800));
	}

	#[test]
	fn retry_constants() {
		assert_eq!(MAX_RETRIES, 3);
		assert_eq!(INITIAL_BACKOFF_MS, 200);
	}

	#[test]
	fn login_response_fields() {
		let resp = LoginResponse {
			token: "tok".to_string(),
			refresh_token: "ref".to_string(),
			user: crate::types::LoggedUser {
				user_id: 1,
				username: "alice".to_string(),
				role: crate::types::UserRole::User,
			},
		};
		assert_eq!(resp.token, "tok");
		assert_eq!(resp.refresh_token, "ref");
		assert_eq!(resp.user.username, "alice");
	}

	#[test]
	fn api_error_is_std_error() {
		let err = ApiError {
			status: 400,
			code: "BAD_REQUEST".to_string(),
			message: "missing field".to_string(),
		};
		// Verify it implements std::error::Error
		let e: &dyn std::error::Error = &err;
		assert!(!e.to_string().is_empty());
	}

	#[test]
	fn auth_expired_is_std_error() {
		let err = AuthExpiredError;
		let e: &dyn std::error::Error = &err;
		assert_eq!(e.to_string(), "authentication token expired");
	}

	#[test]
	fn client_set_refresh_token() {
		let mut client = ApiClient::new("https://example.com".to_string(), "test-key".to_string());
		assert!(!client.has_refresh_token());

		client.set_refresh_token(Some("refresh-tok".to_string()));
		assert!(client.has_refresh_token());

		client.logout();
		assert!(!client.has_refresh_token());
	}

	#[test]
	fn logout_clears_both_tokens() {
		let mut client = ApiClient::new("https://example.com".to_string(), "test-key".to_string());
		client.set_token(Some("jwt".to_string()));
		client.set_refresh_token(Some("refresh".to_string()));
		assert!(client.is_authenticated());
		assert!(client.has_refresh_token());

		client.logout();
		assert!(!client.is_authenticated());
		assert!(!client.has_refresh_token());
	}

	#[test]
	fn refresh_without_token_returns_error() {
		let mut client = ApiClient::new("https://example.com".to_string(), "test-key".to_string());
		// No refresh token set
		let result = client.refresh();
		assert!(result.is_err());
		assert!(
			result
				.unwrap_err()
				.to_string()
				.contains("no refresh token available")
		);
	}
}
