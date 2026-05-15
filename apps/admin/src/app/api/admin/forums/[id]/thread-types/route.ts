import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

/**
 * Proxy to Worker `/api/admin/forums/:forumId/thread-types`.
 *   GET  → list config + thread types for a forum (admin payload)
 *   POST → create a new thread type under the forum
 */

export const GET = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const res = await adminApiAs(admin, request).raw("GET", `/api/admin/forums/${id}/thread-types`);
	return passthrough(res);
});

export const POST = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const res = await adminApiAs(admin, request).raw(
		"POST",
		`/api/admin/forums/${id}/thread-types`,
		body,
	);
	return passthrough(res);
});
