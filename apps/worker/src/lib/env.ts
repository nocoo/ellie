// Worker environment types

export interface Env {
	DB: D1Database;
	ENVIRONMENT: string;
	JWT_SECRET: string;
	KV: KVNamespace;
	RATE_LIMITER: DurableObjectNamespace;
}

export interface CFRequest extends Request {
	cf?: IncomingRequestCfProperties;
}
