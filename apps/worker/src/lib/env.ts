// Worker environment types

export interface Env {
	API_KEY: string;
	ADMIN_API_KEY: string;
	DB: D1Database;
	ENVIRONMENT: string;
	JWT_SECRET: string;
	KV: KVNamespace;
	/** R2 bucket for avatar and attachment uploads */
	R2: R2Bucket;
	/** Comma-separated CORS allowed origins (wrangler [vars]) */
	ALLOWED_ORIGINS?: string;
	/**
	 * Feature flag: use KV cache for user mini profiles.
	 * When "false" (string), uses SQL JOINs instead.
	 * Default: false (JOIN approach).
	 */
	USE_KV_USER_CACHE?: string;
	/**
	 * HMAC key for email-verification codes (docs/17 §6.2).
	 * 6-digit codes are too small to resist offline brute-force after KV
	 * exfiltration; HMAC with a server secret prevents that. Set via
	 * `wrangler secret put EMAIL_VERIFY_HMAC_KEY`.
	 *
	 * Optional in the type because phase 3 only needs it for the new
	 * email-verification handlers; other handlers continue to ignore it.
	 */
	EMAIL_VERIFY_HMAC_KEY?: string;
	/** Dove email-relay base URL, e.g. `https://dove.example.com` (docs/17 §8). */
	DOVE_BASE_URL?: string;
	/** Dove project id whose webhook is used to send verification mail. */
	DOVE_PROJECT_ID?: string;
	/** Dove webhook bearer token (set via `wrangler secret put DOVE_WEBHOOK_TOKEN`). */
	DOVE_WEBHOOK_TOKEN?: string;
	/**
	 * Cloudflare Turnstile shared secret (docs/17 §7.2.1 — rev4).
	 * Set via `wrangler secret put TURNSTILE_SECRET_KEY`. Test environment
	 * uses Cloudflare's documented always-pass test secret
	 * (`1x0000000000000000000000000000000AA`) so unit + e2e tests do not
	 * make real outbound siteverify calls.
	 */
	TURNSTILE_SECRET_KEY?: string;
	/**
	 * Cloudflare Turnstile public site key. Plain var — readable by the
	 * frontend so the widget can be rendered. Test env uses
	 * `1x00000000000000000000AA` (always-pass).
	 */
	TURNSTILE_SITE_KEY?: string;
}

/** Check if KV user cache is enabled */
export function isKvUserCacheEnabled(env: Env): boolean {
	return env.USE_KV_USER_CACHE === "true";
}

export interface CFRequest extends Request {
	cf?: IncomingRequestCfProperties;
}
