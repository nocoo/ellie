use serde::{Deserialize, Serialize};

// ─── Enums ───────────────────────────────────────────────

/// User role levels. Matches Discuz! X3.4 groupid mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "i32", into = "i32")]
pub enum UserRole {
	User = 0,
	Admin = 1,
	SuperMod = 2,
	Mod = 3,
}

impl From<UserRole> for i32 {
	fn from(r: UserRole) -> Self {
		r as i32
	}
}

impl TryFrom<i32> for UserRole {
	type Error = String;
	fn try_from(v: i32) -> Result<Self, Self::Error> {
		match v {
			0 => Ok(Self::User),
			1 => Ok(Self::Admin),
			2 => Ok(Self::SuperMod),
			3 => Ok(Self::Mod),
			_ => Err(format!("invalid UserRole: {v}")),
		}
	}
}

/// User account status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "i32", into = "i32")]
pub enum UserStatus {
	Active = 0,
	Banned = -1,
	Archived = -2,
}

impl From<UserStatus> for i32 {
	fn from(s: UserStatus) -> Self {
		s as i32
	}
}

impl TryFrom<i32> for UserStatus {
	type Error = String;
	fn try_from(v: i32) -> Result<Self, Self::Error> {
		match v {
			0 => Ok(Self::Active),
			-1 => Ok(Self::Banned),
			-2 => Ok(Self::Archived),
			_ => Err(format!("invalid UserStatus: {v}")),
		}
	}
}

/// Thread sticky/pin level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "i32", into = "i32")]
pub enum StickyLevel {
	None = 0,
	Forum = 1,
	Global = 2,
	Category = 3,
}

impl From<StickyLevel> for i32 {
	fn from(s: StickyLevel) -> Self {
		s as i32
	}
}

impl TryFrom<i32> for StickyLevel {
	type Error = String;
	fn try_from(v: i32) -> Result<Self, Self::Error> {
		match v {
			0 => Ok(Self::None),
			1 => Ok(Self::Forum),
			2 => Ok(Self::Global),
			3 => Ok(Self::Category),
			_ => Err(format!("invalid StickyLevel: {v}")),
		}
	}
}

/// Forum hierarchy type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForumType {
	Group,
	Forum,
	Sub,
}

// ─── Entity Structs ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
	pub id: u64,
	pub username: String,
	pub email: String,
	pub avatar: String,
	pub status: UserStatus,
	pub role: UserRole,
	pub reg_date: u64,
	pub last_login: u64,
	pub threads: u64,
	pub posts: u64,
	pub credits: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Forum {
	pub id: u64,
	pub parent_id: u64,
	pub name: String,
	pub description: String,
	pub icon: String,
	pub display_order: i32,
	pub threads: u64,
	pub posts: u64,
	#[serde(rename = "type")]
	pub forum_type: ForumType,
	pub status: i32,
	pub last_thread_id: u64,
	pub last_post_at: u64,
	pub last_poster: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
	pub id: u64,
	pub forum_id: u64,
	pub author_id: u64,
	pub author_name: String,
	pub subject: String,
	pub created_at: u64,
	pub last_post_at: u64,
	pub last_poster: String,
	pub replies: u64,
	pub views: u64,
	pub closed: i32,
	pub sticky: StickyLevel,
	pub digest: i32,
	pub special: i32,
	pub highlight: i64,
	pub recommends: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Post {
	pub id: u64,
	pub thread_id: u64,
	pub forum_id: u64,
	pub author_id: u64,
	pub author_name: String,
	pub content: String,
	pub created_at: u64,
	pub is_first: bool,
	pub position: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
	pub id: u64,
	pub thread_id: u64,
	pub post_id: u64,
	pub author_id: u64,
	pub filename: String,
	pub file_path: String,
	pub file_size: u64,
	pub is_image: bool,
	pub width: u32,
	pub has_thumb: bool,
	pub downloads: u64,
	pub created_at: u64,
}

// ─── API Response Wrappers ───────────────────────────────

/// Standard success envelope: `{ "data": T }` or `{ "data": T, "meta": {...} }`.
///
/// The Worker returns a `meta` object with `nextCursor`, `timestamp`, and `requestId`.
/// `has_more` is inferred from the presence of `nextCursor`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
	pub data: T,
	#[serde(default)]
	pub meta: Option<ResponseMeta>,
}

impl<T> ApiResponse<T> {
	/// Whether the server indicated more pages are available.
	pub fn has_more(&self) -> bool {
		self.meta.as_ref().is_some_and(|m| m.next_cursor.is_some())
	}

	/// The cursor for fetching the next page, if any.
	pub fn next_cursor(&self) -> Option<&str> {
		self.meta.as_ref().and_then(|m| m.next_cursor.as_deref())
	}
}

/// Metadata returned alongside paginated responses.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseMeta {
	pub next_cursor: Option<String>,
	#[serde(default)]
	pub timestamp: Option<u64>,
	#[serde(default)]
	pub request_id: Option<String>,
}

/// Standard error envelope: `{ "error": { "code": "...", "message": "..." } }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorResponse {
	pub error: ErrorDetail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorDetail {
	pub code: String,
	pub message: String,
}

/// Health check response from `GET /api/live`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveResponse {
	pub status: String,
	pub environment: String,
	pub timestamp: u64,
}

/// Login response data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginData {
	pub token: String,
	pub refresh_token: String,
	pub user: LoggedUser,
}

/// Minimal user info stored in auth state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoggedUser {
	pub user_id: u64,
	pub username: String,
	pub role: UserRole,
}

#[cfg(test)]
mod tests {
	use super::*;

	// ─── Enum round-trip tests ─────────────────────────

	#[test]
	fn user_role_round_trip() {
		for (val, expected) in [
			(0, UserRole::User),
			(1, UserRole::Admin),
			(3, UserRole::Mod),
		] {
			let role = UserRole::try_from(val).unwrap();
			assert_eq!(role, expected);
			assert_eq!(i32::from(role), val);
		}
		assert!(UserRole::try_from(99).is_err());
	}

	#[test]
	fn user_status_round_trip() {
		assert_eq!(UserStatus::try_from(0).unwrap(), UserStatus::Active);
		assert_eq!(UserStatus::try_from(-1).unwrap(), UserStatus::Banned);
		assert_eq!(UserStatus::try_from(-2).unwrap(), UserStatus::Archived);
		assert!(UserStatus::try_from(5).is_err());
	}

	#[test]
	fn sticky_level_round_trip() {
		assert_eq!(StickyLevel::try_from(0).unwrap(), StickyLevel::None);
		assert_eq!(StickyLevel::try_from(2).unwrap(), StickyLevel::Global);
		assert!(StickyLevel::try_from(10).is_err());
	}

	#[test]
	fn forum_type_serde() {
		let json = r#""group""#;
		let ft: ForumType = serde_json::from_str(json).unwrap();
		assert_eq!(ft, ForumType::Group);
		assert_eq!(serde_json::to_string(&ForumType::Sub).unwrap(), r#""sub""#);
	}

	// ─── Entity deserialization tests ──────────────────

	#[test]
	fn deserialize_user() {
		let json = r#"{
			"id": 123,
			"username": "alice",
			"email": "alice@example.com",
			"avatar": "default.png",
			"status": 0,
			"role": 1,
			"regDate": 1609459200,
			"lastLogin": 1700000000,
			"threads": 42,
			"posts": 256,
			"credits": 1000
		}"#;
		let user: User = serde_json::from_str(json).unwrap();
		assert_eq!(user.username, "alice");
		assert_eq!(user.role, UserRole::Admin);
		assert_eq!(user.status, UserStatus::Active);
	}

	#[test]
	fn deserialize_forum() {
		let json = r#"{
			"id": 1,
			"parentId": 0,
			"name": "Campus",
			"description": "Campus talk",
			"icon": "",
			"displayOrder": 1,
			"threads": 100,
			"posts": 5000,
			"type": "forum",
			"status": 1,
			"lastThreadId": 99,
			"lastPostAt": 1700000000,
			"lastPoster": "bob"
		}"#;
		let forum: Forum = serde_json::from_str(json).unwrap();
		assert_eq!(forum.name, "Campus");
		assert_eq!(forum.forum_type, ForumType::Forum);
	}

	#[test]
	fn deserialize_thread() {
		let json = r#"{
			"id": 42,
			"forumId": 1,
			"authorId": 10,
			"authorName": "alice",
			"subject": "Hello World",
			"createdAt": 1700000000,
			"lastPostAt": 1700001000,
			"lastPoster": "bob",
			"replies": 5,
			"views": 200,
			"closed": 0,
			"sticky": 1,
			"digest": 0,
			"special": 0,
			"highlight": 0,
			"recommends": 3
		}"#;
		let thread: Thread = serde_json::from_str(json).unwrap();
		assert_eq!(thread.subject, "Hello World");
		assert_eq!(thread.sticky, StickyLevel::Forum);
	}

	#[test]
	fn deserialize_post() {
		let json = r#"{
			"id": 1001,
			"threadId": 42,
			"forumId": 1,
			"authorId": 10,
			"authorName": "alice",
			"content": "<p>Hello!</p>",
			"createdAt": 1700000000,
			"isFirst": true,
			"position": 1
		}"#;
		let post: Post = serde_json::from_str(json).unwrap();
		assert!(post.is_first);
		assert_eq!(post.position, 1);
	}

	// ─── API response wrapper tests ────────────────────

	#[test]
	fn deserialize_api_response_with_meta() {
		let json = r#"{
			"data": [],
			"meta": {
				"nextCursor": "eyJzb3J0VmFsdWUiOjEsImlkIjo5OX0=",
				"timestamp": 1700000000,
				"requestId": "550e8400-e29b-41d4-a716-446655440000"
			}
		}"#;
		let resp: ApiResponse<Vec<Thread>> = serde_json::from_str(json).unwrap();
		assert!(resp.data.is_empty());
		assert!(resp.has_more());
		let meta = resp.meta.unwrap();
		assert_eq!(
			meta.next_cursor.as_deref(),
			Some("eyJzb3J0VmFsdWUiOjEsImlkIjo5OX0=")
		);
		assert_eq!(meta.timestamp, Some(1700000000));
		assert!(meta.request_id.is_some());
	}

	#[test]
	fn deserialize_api_response_without_meta() {
		let json = r#"{ "data": { "id": 1, "parentId": 0, "name": "Test", "description": "", "icon": "", "displayOrder": 0, "threads": 0, "posts": 0, "type": "group", "status": 1, "lastThreadId": 0, "lastPostAt": 0, "lastPoster": "" } }"#;
		let resp: ApiResponse<Forum> = serde_json::from_str(json).unwrap();
		assert_eq!(resp.data.name, "Test");
		assert!(resp.meta.is_none());
		assert!(!resp.has_more());
	}

	#[test]
	fn has_more_with_cursor() {
		let resp: ApiResponse<Vec<u8>> = ApiResponse {
			data: vec![],
			meta: Some(ResponseMeta {
				next_cursor: Some("abc".to_string()),
				timestamp: None,
				request_id: None,
			}),
		};
		assert!(resp.has_more());
		assert_eq!(resp.next_cursor(), Some("abc"));
	}

	#[test]
	fn has_more_without_cursor() {
		let resp: ApiResponse<Vec<u8>> = ApiResponse {
			data: vec![],
			meta: Some(ResponseMeta {
				next_cursor: None,
				timestamp: Some(123),
				request_id: None,
			}),
		};
		assert!(!resp.has_more());
		assert_eq!(resp.next_cursor(), None);
	}

	#[test]
	fn has_more_no_meta() {
		let resp: ApiResponse<Vec<u8>> = ApiResponse {
			data: vec![],
			meta: None,
		};
		assert!(!resp.has_more());
		assert_eq!(resp.next_cursor(), None);
	}

	#[test]
	fn deserialize_error_response() {
		let json = r#"{ "error": { "code": "TOKEN_EXPIRED", "message": "JWT has expired" } }"#;
		let err: ErrorResponse = serde_json::from_str(json).unwrap();
		assert_eq!(err.error.code, "TOKEN_EXPIRED");
	}

	#[test]
	fn deserialize_live_response() {
		let json = r#"{ "status": "ok", "environment": "test", "timestamp": 1700000000 }"#;
		let live: LiveResponse = serde_json::from_str(json).unwrap();
		assert_eq!(live.environment, "test");
	}

	#[test]
	fn deserialize_login_data() {
		let json = r#"{
			"token": "jwt.token.here",
			"refreshToken": "uuid-refresh",
			"user": { "userId": 1, "username": "alice", "role": 1 }
		}"#;
		let data: LoginData = serde_json::from_str(json).unwrap();
		assert_eq!(data.user.username, "alice");
		assert_eq!(data.user.role, UserRole::Admin);
	}
}
