CREATE INDEX idx_cap_tokens_expires_at ON cap_tokens(expires_at);
CREATE INDEX idx_cap_nonces_expires_at ON cap_nonces(expires_at);
CREATE INDEX idx_cap_challenge_ip_window ON cap_challenge_ip(window_start);
