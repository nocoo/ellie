// URL path parameter extraction helpers

/**
 * Extract the last numeric path segment from a URL.
 * e.g. "/api/admin/forums/42" -> 42
 * Returns null if the segment is non-numeric.
 */
export function parseIdFromPath(request: Request): number | null {
	const url = new URL(request.url);
	const segments = url.pathname.split("/");
	const last = segments[segments.length - 1];
	const id = Number.parseInt(last ?? "", 10);
	return Number.isNaN(id) ? null : id;
}

/**
 * Extract a numeric path segment at a specific position from the end.
 * e.g. parsePathSegment(request, 1) for "/api/admin/threads/42/sticky" -> 42
 */
export function parsePathSegment(request: Request, fromEnd: number): number | null {
	const url = new URL(request.url);
	const segments = url.pathname.split("/");
	const target = segments[segments.length - 1 - fromEnd];
	const id = Number.parseInt(target ?? "", 10);
	return Number.isNaN(id) ? null : id;
}
