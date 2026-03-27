use std::fs;
use std::path::PathBuf;

use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};

use crate::types::LoggedUser;

/// Single source of truth for all CLI configuration.
/// Stored at `~/.config/ellie/config.json` (XDG on Linux, Library on macOS).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
	pub api_url: String,
	pub api_key: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub auth: Option<AuthConfig>,
	#[serde(default = "default_theme")]
	pub theme: String,
}

fn default_theme() -> String {
	"default".to_string()
}

/// Authentication state persisted between sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
	pub token: String,
	pub user: LoggedUser,
}

impl Config {
	/// Default config with production API URL and empty API key.
	pub fn default_config() -> Self {
		Self {
			api_url: "https://ellie.worker.hexly.ai".to_string(),
			api_key: String::new(),
			auth: None,
			theme: default_theme(),
		}
	}

	/// Resolve the config file path using XDG/platform conventions.
	pub fn config_path() -> Option<PathBuf> {
		ProjectDirs::from("", "", "ellie").map(|dirs| dirs.config_dir().join("config.json"))
	}

	/// Resolve config path from an explicit override or the default XDG location.
	fn resolve_path(explicit_path: Option<&PathBuf>) -> Option<PathBuf> {
		explicit_path.cloned().or_else(Self::config_path)
	}

	/// Load config from file. Falls back to defaults if file doesn't exist.
	pub fn load(explicit_path: Option<&PathBuf>) -> Self {
		let Some(path) = Self::resolve_path(explicit_path) else {
			return Self::default_config();
		};

		if !path.exists() {
			return Self::default_config();
		}

		match fs::read_to_string(&path) {
			Ok(contents) => serde_json::from_str(&contents).unwrap_or_else(|_| {
				eprintln!(
					"warning: config file at {} is malformed, using defaults",
					path.display()
				);
				Self::default_config()
			}),
			Err(_) => Self::default_config(),
		}
	}

	/// Write config to file, creating parent directories if needed.
	pub fn write(&self, explicit_path: Option<&PathBuf>) -> Result<()> {
		let path =
			Self::resolve_path(explicit_path).context("could not determine config file path")?;

		if let Some(parent) = path.parent() {
			fs::create_dir_all(parent).with_context(|| {
				format!("failed to create config directory: {}", parent.display())
			})?;
		}

		let json = serde_json::to_string_pretty(self)?;
		fs::write(&path, json)
			.with_context(|| format!("failed to write config to {}", path.display()))?;

		Ok(())
	}

	/// Update the auth section after login.
	pub fn set_auth(&mut self, token: String, user: LoggedUser) {
		self.auth = Some(AuthConfig { token, user });
	}

	/// Clear auth state on logout or token expiry.
	pub fn clear_auth(&mut self) {
		self.auth = None;
	}

	/// Check if user is authenticated.
	pub fn is_authenticated(&self) -> bool {
		self.auth.is_some()
	}

	/// Get the current username, if authenticated.
	pub fn username(&self) -> Option<&str> {
		self.auth.as_ref().map(|a| a.user.username.as_str())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::types::UserRole;
	use tempfile::TempDir;

	fn temp_config_path(dir: &TempDir) -> PathBuf {
		dir.path().join("config.json")
	}

	#[test]
	fn default_config_values() {
		let config = Config::default_config();
		assert_eq!(config.api_url, "https://ellie.worker.hexly.ai");
		assert!(config.api_key.is_empty());
		assert!(config.auth.is_none());
		assert_eq!(config.theme, "default");
	}

	#[test]
	fn load_nonexistent_file_returns_defaults() {
		let dir = TempDir::new().unwrap();
		let path = temp_config_path(&dir);
		let config = Config::load(Some(&path));
		assert_eq!(config.theme, "default");
		assert!(config.auth.is_none());
	}

	#[test]
	fn write_then_load_round_trip() {
		let dir = TempDir::new().unwrap();
		let path = temp_config_path(&dir);

		let mut config = Config::default_config();
		config.api_key = "test-key".to_string();
		config.theme = "dracula".to_string();
		config.set_auth(
			"jwt-token".to_string(),
			LoggedUser {
				user_id: 1,
				username: "alice".to_string(),
				role: UserRole::Admin,
			},
		);
		config.write(Some(&path)).unwrap();

		let loaded = Config::load(Some(&path));
		assert_eq!(loaded.api_key, "test-key");
		assert_eq!(loaded.theme, "dracula");
		assert_eq!(loaded.username(), Some("alice"));
	}

	#[test]
	fn load_malformed_file_returns_defaults() {
		let dir = TempDir::new().unwrap();
		let path = temp_config_path(&dir);
		fs::write(&path, "not valid json!!!").unwrap();

		let config = Config::load(Some(&path));
		assert_eq!(config.theme, "default");
	}

	#[test]
	fn set_and_clear_auth() {
		let mut config = Config::default_config();
		assert!(!config.is_authenticated());

		config.set_auth(
			"token".to_string(),
			LoggedUser {
				user_id: 1,
				username: "bob".to_string(),
				role: UserRole::User,
			},
		);
		assert!(config.is_authenticated());
		assert_eq!(config.username(), Some("bob"));

		config.clear_auth();
		assert!(!config.is_authenticated());
		assert_eq!(config.username(), None);
	}

	#[test]
	fn write_creates_parent_directories() {
		let dir = TempDir::new().unwrap();
		let path = dir.path().join("nested").join("deep").join("config.json");

		let config = Config::default_config();
		config.write(Some(&path)).unwrap();

		assert!(path.exists());
	}

	#[test]
	fn config_json_format() {
		let config = Config::default_config();
		let json = serde_json::to_string_pretty(&config).unwrap();
		// Verify camelCase keys
		assert!(json.contains("apiUrl"));
		assert!(json.contains("apiKey"));
		// auth should be omitted when None
		assert!(!json.contains("auth"));
	}

	#[test]
	fn deserialize_partial_config() {
		// Config with only required fields, theme defaults to "default"
		let json = r#"{
			"apiUrl": "http://localhost:8787",
			"apiKey": "key"
		}"#;
		let config: Config = serde_json::from_str(json).unwrap();
		assert_eq!(config.theme, "default");
		assert!(config.auth.is_none());
	}
}
