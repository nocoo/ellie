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
}

/** Check if KV user cache is enabled */
export function isKvUserCacheEnabled(env: Env): boolean {
	return env.USE_KV_USER_CACHE === "true";
}

export interface CFRequest extends Request {
	cf?: IncomingRequestCfProperties;
}
