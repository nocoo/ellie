// CORS middleware for Cloudflare Worker

/** Default origins for local dev when ALLOWED_ORIGINS env var is not set */
const DEFAULT_ORIGINS = ["https://ellie.nocoo.cloud", "http://localhost:3000"];

/** Active allowed origins — set per-request from env via configureAllowedOrigins() */
let allowedOrigins: string[] = DEFAULT_ORIGINS;

/**
 * Parse the ALLOWED_ORIGINS env var (comma-separated) and set module state.
 * Must be called at the start of each request in the router.
 */
export function configureAllowedOrigins(envValue?: string): void {
	if (envValue) {
		allowedOrigins = envValue
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	} else {
		allowedOrigins = DEFAULT_ORIGINS;
	}
}

export function corsHeaders(origin?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
		"Access-Control-Max-Age": "86400",
	};

	if (origin && allowedOrigins.includes(origin)) {
		headers["Access-Control-Allow-Origin"] = origin;
	}

	return headers;
}

/**
 * Build the headers object for a JSON response in one allocation — inlines
 * `corsHeaders(origin)` + the `Content-Type: application/json` entry to skip
 * the spread that the previous `{...corsHeaders(origin), "Content-Type": ...}`
 * pattern required. Hot path: every `jsonResponse` call goes through here.
 */
export function buildJsonHeaders(origin?: string): Record<string, string> {
	if (origin && allowedOrigins.includes(origin)) {
		return {
			"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
			"Access-Control-Max-Age": "86400",
			"Access-Control-Allow-Origin": origin,
			"Content-Type": "application/json",
		};
	}
	return {
		"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
		"Access-Control-Max-Age": "86400",
		"Content-Type": "application/json",
	};
}

export function withCorsHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [key, value] of Object.entries(corsHeaders())) {
		headers.set(key, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
