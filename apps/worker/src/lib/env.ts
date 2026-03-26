// Worker environment types

export interface Env {
	DB: D1Database;
	ENVIRONMENT: string;
}

export interface CFRequest extends Request {
	cf?: IncomingRequestCfProperties;
}
