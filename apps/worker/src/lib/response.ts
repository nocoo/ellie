// Standardized JSON response builders for Cloudflare Worker handlers

import { corsHeaders } from "../middleware/cors";

/**
 * Build a standard JSON response with { data, meta } envelope.
 */
export function jsonResponse<T>(
	data: T,
	origin?: string,
	meta?: Record<string, unknown>,
	status = 200,
): Response {
	return new Response(
		JSON.stringify({
			data,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
				...meta,
			},
		}),
		{
			status,
			headers: {
				...corsHeaders(origin),
				"Content-Type": "application/json",
			},
		},
	);
}

/**
 * Build an offset-paginated JSON response for admin list endpoints.
 */
export function paginatedResponse<T>(
	data: T[],
	total: number,
	page: number,
	limit: number,
	origin?: string,
): Response {
	return jsonResponse(data, origin, {
		total,
		page,
		limit,
		pages: Math.ceil(total / limit),
	});
}
