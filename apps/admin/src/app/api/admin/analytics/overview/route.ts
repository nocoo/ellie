// BFF: /api/admin/analytics/overview
// Forwards to worker GET /api/admin/analytics/overview.

import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const res = await adminApiAs(admin, request).raw("GET", "/api/admin/analytics/overview");
	return passthrough(res);
});
