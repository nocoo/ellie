// D4-b: POST /api/admin/users/:id/purge — proxy to Worker.
//
// F1 update: switched from manually injecting X-Admin-Actor-* headers to the
// shared `adminApiAs(admin)` actor-bound client. Behavior is identical — the
// helper still emits the same two headers — but new audit-logged routes
// (F3-a/b/c) can adopt the same path without copy-pasting header maps.
//
// Worker uses these headers for:
//   - response.audit field (existing D4-b contract; preserved)
//   - F1 admin_logs.actor when handlers call writeAdminLog() (added in F3-a)

import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const api = adminApiAs(admin);
	const res = await api.raw("POST", `/api/admin/users/${id}/purge`, body);
	return passthrough(res);
});
