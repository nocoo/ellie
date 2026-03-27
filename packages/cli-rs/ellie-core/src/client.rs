use std::fmt;

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
pub struct LoginResponse {
	pub token: String,
	pub refresh_token: String,
	pub user: LoggedUser,
}

// ─── Client ──────────────────────────────────────────────

pub struct ApiClient {
	agent: Agent,
	base_url: String,
	api_key: String,
	token: Option<String>,
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
		}
	}

	pub fn set_token(&mut self, token: Option<String>) {
		self.token = token;
	}

	pub fn is_authenticated(&self) -> bool {
		self.token.is_some()
	}

	/// GET request with auth headers.
	fn api_get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
		let url = format!("{}{}", self.base_url, path);
		let mut req = self.agent.get(&url).header("X-API-Key", &self.api_key);

		if let Some(token) = &self.token {
			req = req.header("Authorization", &format!("Bearer {token}"));
		}

		let resp = req.call()?;
		let status: u16 = resp.status().into();

		if status >= 400 {
			return self.parse_error(status, resp.into_body());
		}

		Ok(resp.into_body().read_json()?)
	}

	/// POST request with JSON body and auth headers.
	fn api_post<T: DeserializeOwned>(
		&self,
		path: &str,
		body: &serde_json::Value,
	) -> Result<T> {
		let url = format!("{}{}", self.base_url, path);
		let mut req = self.agent.post(&url).header("X-API-Key", &self.api_key);

		if let Some(token) = &self.token {
			req = req.header("Authorization", &format!("Bearer {token}"));
		}

		let resp = req.send_json(body)?;
		let status: u16 = resp.status().into();

		if status >= 400 {
			return self.parse_error(status, resp.into_body());
		}

		Ok(resp.into_body().read_json()?)
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
		Ok(LoginResponse {
			token: res.data.token,
			refresh_token: res.data.refresh_token,
			user: res.data.user,
		})
	}

	/// Clear local auth state.
	pub fn logout(&mut self) {
		self.token = None;
	}
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
		let mut client =
			ApiClient::new("https://example.com".to_string(), "test-key".to_string());
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
}
