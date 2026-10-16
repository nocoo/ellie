-- One-time Cap challenge nonces, redeemed tokens, and per-IP challenge
-- counters. KV cannot atomically consume a key, so these live in D1.
CREATE TABLE cap_tokens (
	token TEXT PRIMARY KEY NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE TABLE cap_nonces (
	signature_hex TEXT PRIMARY KEY NOT NULL,
	expires_at INTEGER NOT NULL
);

CREATE TABLE cap_challenge_ip (
	ip TEXT PRIMARY KEY NOT NULL,
	window_start INTEGER NOT NULL,
	count INTEGER NOT NULL
);
