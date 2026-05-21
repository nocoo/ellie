// BFF: /api/admin/analytics/checkin?range=<>
// Forwards to worker GET /api/admin/analytics/checkin.

import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const url = new URL(request.url);
	const search = url.searchParams.toString();
	const target = `/api/admin/analytics/checkin${search ? `?${search}` : ""}`;
	const res = await adminApiAs(admin, request).raw("GET", target);
	return passthrough(res);
});
