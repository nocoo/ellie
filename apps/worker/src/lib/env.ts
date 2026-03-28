// Worker environment types

export interface Env {
	API_KEY: string;
	ADMIN_API_KEY: string;
	DB: D1Database;
	ENVIRONMENT: string;
	JWT_SECRET: string;
	KV: KVNamespace;
	/** Comma-separated CORS allowed origins (wrangler [vars]) */
	ALLOWED_ORIGINS?: string;
}

export interface CFRequest extends Request {
	cf?: IncomingRequestCfProperties;
}
