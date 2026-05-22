// Standardized JSON response builders for Cloudflare Worker handlers

import { buildJsonHeaders } from "../middleware/cors";

/**
 * Hot-path variant of {@link jsonResponse} for keyset-cursor list endpoints.
 * The shape is identical to `jsonResponse(data, origin, { nextCursor })` but
 * we skip the `...meta` spread by listing all 3 meta fields inline. Saves a
 * spread + intermediate-object alloc per call — measurable on list endpoints
 * that fire thousands of times per second.
 */
export function jsonListResponse<T>(
	data: T,
	origin: string | undefined,
	nextCursor: string | null,
): Response {
	return new Response(
		JSON.stringify({
			data,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
				nextCursor,
			},
		}),
		{
			headers: buildJsonHeaders(origin),
		},
	);
}

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
			headers: buildJsonHeaders(origin),
		},
	);
}

/**
 * Variant of {@link jsonResponse} that adds `Cache-Control: no-store, private`.
 * Used by admin endpoints that must never serve cached data — both inside
 * the worker (no KV memoization) and downstream (no browser/CDN cache).
 */
export function jsonNoStoreResponse<T>(
	data: T,
	origin?: string,
	meta?: Record<string, unknown>,
	status = 200,
): Response {
	const headers = buildJsonHeaders(origin);
	headers["Cache-Control"] = "no-store, private";
	return new Response(
		JSON.stringify({
			data,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
				...meta,
			},
		}),
		{ status, headers },
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

/**
 * No-store variant of {@link paginatedResponse} for admin CRUD endpoints.
 */
export function paginatedNoStoreResponse<T>(
	data: T[],
	total: number,
	page: number,
	limit: number,
	origin?: string,
): Response {
	return jsonNoStoreResponse(data, origin, {
		total,
		page,
		limit,
		pages: Math.ceil(total / limit),
	});
}
