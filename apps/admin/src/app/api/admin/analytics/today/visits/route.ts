// BFF: GET /api/admin/analytics/today/visits
// Forwards to worker GET /api/admin/analytics/today/visits (KPI card).
//
// The worker KPI response is the aggregate-only KV-cached payload
// (totalViews / human/bot breakdown / activeUsers + anonPresent). It
// carries NO ip / ua / username, so we use the standard `passthrough`
// — the 60s worker-side TTL is the freshness contract.

import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const res = await adminApiAs(admin, request).raw("GET", "/api/admin/analytics/today/visits");
	return passthrough(res);
});
