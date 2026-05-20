// BFF: GET /api/admin/analytics/today/logins
// Forwards to worker GET /api/admin/analytics/today/logins (KPI card).
//
// The worker KPI response is the aggregate-only KV-cached payload (no
// PII). We use the standard `passthrough` because the KPI is safe to
// be momentarily reused by the browser cache — TTL on the worker side
// is 60s and the response body carries no ip / ua / username.

import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const res = await adminApiAs(admin, request).raw("GET", "/api/admin/analytics/today/logins");
	return passthrough(res);
});
