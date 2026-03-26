// CORS middleware for Cloudflare Worker

const ALLOWED_ORIGINS = [
	"https://ellie.nocoo.cloud",
	"https://ellie.worker.hexly.ai",
	"http://localhost:3000",
];

export function corsHeaders(origin?: string): Record<string, string> {
	const headers: Record<string, string> = {
		"Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Authorization",
		"Access-Control-Max-Age": "86400",
	};

	if (origin && ALLOWED_ORIGINS.includes(origin)) {
		headers["Access-Control-Allow-Origin"] = origin;
	}

	return headers;
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
