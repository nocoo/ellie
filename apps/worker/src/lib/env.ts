// Worker environment types

export interface Env {
	DB: D1Database;
	ENVIRONMENT: string;
	JWT_SECRET: string;
	KV: KVNamespace;
}

export interface CFRequest extends Request {
	cf?: IncomingRequestCfProperties;
}
