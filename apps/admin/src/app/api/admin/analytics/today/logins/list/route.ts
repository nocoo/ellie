// BFF: GET /api/admin/analytics/today/logins/list
// Forwards to worker GET /api/admin/analytics/today/logins/list (masked
// detail list). The worker responds with `Cache-Control: no-store,
// private` because the list still contains masked PII (username +
// masked IP), and the standard `passthrough` strips that header. We
// re-attach it here so the browser does NOT replay this response.

import { adminApiAs, createProxyHandler } from "@/lib/admin-proxy";

const NO_STORE = "no-store, private";

export const GET = createProxyHandler(async (request, admin) => {
	const url = new URL(request.url);
	const search = url.searchParams.toString();
	const target = `/api/admin/analytics/today/logins/list${search ? `?${search}` : ""}`;
	const res = await adminApiAs(admin, request).raw("GET", target);
	const body = await res.text();
	return new Response(body, {
		status: res.status,
		headers: {
			"Content-Type": res.headers.get("Content-Type") || "application/json",
			"Cache-Control": NO_STORE,
		},
	});
});
