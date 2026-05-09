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
	 * Feature flag: use KV cache for forum tree (structural metadata).
	 * When "true", forum tree is read from KV with 10min TTL + explicit invalidation.
	 * Default: false (direct D1 queries).
	 */
	USE_KV_FORUM_CACHE?: string;
	/**
	 * Feature flag: use the v2 forum cache (forum:tree:v2 / forum:summary:v2 /
	 * forum:meta:v2 — bucket-aware, lazy expansion, generation-keyed). When
	 * "true", `GET /api/v1/forums*` reads/writes the v2 KV layer; the legacy
	 * v1 cache (USE_KV_FORUM_CACHE) and the D1 fallback remain for the
	 * disabled path. Default: false.
	 */
	USE_KV_FORUM_CACHE_V2?: string;
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
	 * Dove template slug used for verification emails (docs/17 §8). Plain var
	 * so ops can swap templates without a code deploy. The template MUST accept
	 * a single `code` string variable.
	 */
	DOVE_TEMPLATE_SLUG?: string;
}

/** Check if KV user cache is enabled */
export function isKvUserCacheEnabled(env: Env): boolean {
	return env.USE_KV_USER_CACHE === "true";
}

/** Check if the v2 forum KV cache is enabled. */
export function isKvForumCacheV2Enabled(env: Env): boolean {
	return env.USE_KV_FORUM_CACHE_V2 === "true";
}

export interface CFRequest extends Request {
	cf?: IncomingRequestCfProperties;
}
