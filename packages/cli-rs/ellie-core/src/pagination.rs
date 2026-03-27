use base64::prelude::{BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};

/// Cursor payload matching the TypeScript CursorPayload from @ellie/types.
/// Encoded as base64(JSON({ sortValue, id })).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPayload {
	pub sort_value: i64,
	pub id: u64,
}

pub const DEFAULT_PAGE_SIZE: usize = 20;
pub const MAX_PAGE_SIZE: usize = 50;

/// Encode a cursor payload to an opaque base64 string.
pub fn encode_cursor(payload: &CursorPayload) -> String {
	let json = serde_json::to_string(payload).expect("CursorPayload is always serializable");
	BASE64_STANDARD.encode(json.as_bytes())
}

/// Decode an opaque cursor string back to a payload. Returns `None` if invalid.
pub fn decode_cursor(cursor: &str) -> Option<CursorPayload> {
	let bytes = BASE64_STANDARD.decode(cursor).ok()?;
	serde_json::from_slice(&bytes).ok()
}

/// Clamp a requested page size to `[1, MAX_PAGE_SIZE]`, defaulting to `DEFAULT_PAGE_SIZE`.
pub fn clamp_page_size(limit: Option<usize>) -> usize {
	match limit {
		Some(n) if (1..=MAX_PAGE_SIZE).contains(&n) => n,
		Some(n) if n > MAX_PAGE_SIZE => MAX_PAGE_SIZE,
		_ => DEFAULT_PAGE_SIZE,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn encode_decode_round_trip() {
		let payload = CursorPayload {
			sort_value: 1700000000,
			id: 42,
		};
		let encoded = encode_cursor(&payload);
		let decoded = decode_cursor(&encoded).unwrap();
		assert_eq!(decoded, payload);
	}

	#[test]
	fn decode_from_typescript_compatible_cursor() {
		// Simulate what the TypeScript encodeCursor produces:
		// btoa(JSON.stringify({ sortValue: 1700000000, id: 99 }))
		let ts_cursor = BASE64_STANDARD.encode(r#"{"sortValue":1700000000,"id":99}"#.as_bytes());
		let decoded = decode_cursor(&ts_cursor).unwrap();
		assert_eq!(decoded.sort_value, 1700000000);
		assert_eq!(decoded.id, 99);
	}

	#[test]
	fn decode_invalid_base64() {
		assert!(decode_cursor("not-valid!!!").is_none());
	}

	#[test]
	fn decode_valid_base64_but_invalid_json() {
		let encoded = BASE64_STANDARD.encode(b"not json");
		assert!(decode_cursor(&encoded).is_none());
	}

	#[test]
	fn decode_valid_json_but_wrong_shape() {
		let encoded = BASE64_STANDARD.encode(br#"{"foo": "bar"}"#);
		assert!(decode_cursor(&encoded).is_none());
	}

	#[test]
	fn encoded_cursor_contains_special_chars() {
		// Cursors with certain values produce base64 with =, +, / characters.
		// Verify we handle padding correctly.
		let payload = CursorPayload {
			sort_value: 1,
			id: 1,
		};
		let encoded = encode_cursor(&payload);
		// Standard base64 may have padding
		let decoded = decode_cursor(&encoded).unwrap();
		assert_eq!(decoded, payload);
	}

	#[test]
	fn clamp_page_size_defaults() {
		assert_eq!(clamp_page_size(None), DEFAULT_PAGE_SIZE);
		assert_eq!(clamp_page_size(Some(0)), DEFAULT_PAGE_SIZE);
	}

	#[test]
	fn clamp_page_size_valid_range() {
		assert_eq!(clamp_page_size(Some(1)), 1);
		assert_eq!(clamp_page_size(Some(25)), 25);
		assert_eq!(clamp_page_size(Some(50)), 50);
	}

	#[test]
	fn clamp_page_size_over_max() {
		assert_eq!(clamp_page_size(Some(100)), MAX_PAGE_SIZE);
		assert_eq!(clamp_page_size(Some(999)), MAX_PAGE_SIZE);
	}
}
