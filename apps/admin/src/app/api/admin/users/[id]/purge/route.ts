// D4-b: POST /api/admin/users/:id/purge — proxy to Worker.
//
// Injects audit headers (X-Admin-Actor-Email / X-Admin-Actor-Name) from the
// admin session. Worker uses these for the response.audit field only;
// purged_by is hard-coded to 0 because admin sessions don't carry a numeric
// users.id (see worker handler comment for the SELF_PURGE deferral).

import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const res = await adminApi.raw("POST", `/api/admin/users/${id}/purge`, body, {
		"X-Admin-Actor-Email": admin.email,
		"X-Admin-Actor-Name": admin.name,
	});
	return passthrough(res);
});
