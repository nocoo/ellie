import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

/**
 * Proxy to Worker `PATCH /api/admin/forums/:forumId/thread-types/reorder`.
 * Body: `{ ids: number[] }` — the FULL ordered set of thread-type ids
 * for the forum (Worker rejects partial / extra / cross-forum lists).
 */

export const PATCH = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const res = await adminApiAs(admin, request).raw(
		"PATCH",
		`/api/admin/forums/${id}/thread-types/reorder`,
		body,
	);
	return passthrough(res);
});
