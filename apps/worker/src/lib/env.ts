// Worker environment types

export interface Env {
	API_KEY: string;
	DB: D1Database;
	ENVIRONMENT: string;
	JWT_SECRET: string;
	KV: KVNamespace;
}

export interface CFRequest extends Request {
	cf?: IncomingRequestCfProperties;
}
