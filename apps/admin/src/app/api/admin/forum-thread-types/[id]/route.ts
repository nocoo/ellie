import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

/**
 * Proxy to Worker `/api/admin/forum-thread-types/:id`.
 *   PATCH  → partial update of a thread-type row
 *   DELETE → hard delete or soft-disable depending on thread references
 */

export const PATCH = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const res = await adminApiAs(admin, request).raw(
		"PATCH",
		`/api/admin/forum-thread-types/${id}`,
		body,
	);
	return passthrough(res);
});

export const DELETE = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const res = await adminApiAs(admin, request).raw("DELETE", `/api/admin/forum-thread-types/${id}`);
	return passthrough(res);
});
