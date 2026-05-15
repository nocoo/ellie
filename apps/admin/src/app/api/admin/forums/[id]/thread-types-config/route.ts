import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

/**
 * Proxy to Worker `PATCH /api/admin/forums/:forumId/thread-types-config`.
 * Body: partial `{ enabled?, required?, listable?, prefix? }`.
 * Worker enforces `required=1 ⇒ enabled=1` on the merged state.
 */

export const PATCH = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const res = await adminApiAs(admin, request).raw(
		"PATCH",
		`/api/admin/forums/${id}/thread-types-config`,
		body,
	);
	return passthrough(res);
});
