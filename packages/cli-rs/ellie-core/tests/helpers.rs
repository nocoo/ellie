use ellie_core::client::ApiClient;
use ellie_core::types::LiveResponse;
use std::net::IpAddr;
use std::time::Duration;
use ureq::{Agent, http::Uri};

fn local_test_url(url: &str) -> anyhow::Result<String> {
	let uri: Uri = url.parse()?;
	let authority = uri
		.authority()
		.ok_or_else(|| anyhow::anyhow!("missing host"))?;
	let host = uri
		.host()
		.unwrap_or_default()
		.trim_start_matches('[')
		.trim_end_matches(']');
	let ip: IpAddr = host.parse()?;
	anyhow::ensure!(
		uri.scheme_str() == Some("http")
			&& ip.is_loopback()
			&& !authority.as_str().contains('@')
			&& !url.contains(['#', '\\'])
			&& uri.path() == "/"
			&& uri.query().is_none(),
		"SAFETY: ELLIE_API_URL must be an HTTP loopback IP origin"
	);
	Ok(url.trim_end_matches('/').to_string())
}

fn local_test_client(url: &str, key: String) -> anyhow::Result<ApiClient> {
	let base_url = local_test_url(url)?;
	let agent = Agent::config_builder()
		.proxy(None)
		.max_redirects(0)
		.timeout_global(Some(Duration::from_secs(10)))
		.http_status_as_error(false)
		.build()
		.into();
	Ok(ApiClient::with_agent(base_url, key, agent))
}

/// Shared test client — reads URL/key from env, refuses to default to production.
pub fn test_client() -> ApiClient {
	local_test_client(
		&std::env::var("ELLIE_API_URL")
			.expect("ELLIE_API_URL must be set (use local test Worker URL)"),
		std::env::var("ELLIE_API_KEY").expect("ELLIE_API_KEY must be set"),
	)
	.expect("SAFETY: invalid local test Worker URL")
}

/// Verify the target Worker is running in test mode before any L2 test touches data.
/// Panics with a clear message if connected to production — prevents accidental
/// test traffic against real user data.
pub fn assert_test_environment(client: &ApiClient) {
	let live: LiveResponse = client.get_live().expect("GET /api/live failed");
	assert_eq!(
		live.environment.as_deref(),
		Some("test"),
		"SAFETY: L2 tests must target a test Worker (environment={:?}), \
		 not production. Set ELLIE_API_URL to your test Worker URL.",
		live.environment
	);
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::io::{Read, Write};
	use std::net::TcpListener;

	#[test]
	fn accepts_only_loopback_http_origins() {
		for url in ["http://127.0.0.1:17031", "http://[::1]:17031/"] {
			assert!(local_test_url(url).is_ok(), "{url}");
		}
		for url in [
			"https://127.0.0.1",
			"http://ellie.worker.hexly.ai",
			"http://127.0.0.1.evil.test",
			"http://127.0.0.1@evil.test",
			"http://evil@127.0.0.1",
			"http://0.0.0.0",
			"http://192.168.1.1",
			"http://[::]",
			"http://localhost",
			"http://127.1",
			"http://127.0.0.1/path",
			"http://127.0.0.1?target=remote",
			"http://127.0.0.1#remote",
			"file:///tmp/test",
			"/api/live",
		] {
			assert!(local_test_client(url, "fake-key".into()).is_err(), "{url}");
		}
	}

	#[test]
	fn test_transport_does_not_follow_redirects() {
		let target = TcpListener::bind("127.0.0.1:0").unwrap();
		target.set_nonblocking(true).unwrap();
		let source = TcpListener::bind("127.0.0.1:0").unwrap();
		let base_url = format!("http://{}", source.local_addr().unwrap());
		let location = format!("http://{}/api/live", target.local_addr().unwrap());
		let server = std::thread::spawn(move || {
			let (mut stream, _) = source.accept().unwrap();
			stream
				.set_read_timeout(Some(Duration::from_secs(5)))
				.unwrap();
			let mut request = [0; 4096];
			assert!(stream.read(&mut request).unwrap() > 0);
			write!(
				stream,
				"HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
			)
			.unwrap();
		});
		let result = local_test_client(&base_url, "fake-key".into())
			.unwrap()
			.get_live();
		server.join().unwrap();
		assert!(result.is_err());
		assert_eq!(
			target.accept().unwrap_err().kind(),
			std::io::ErrorKind::WouldBlock
		);
	}
}
