// BFF: GET /api/admin/analytics/today/visits/list
// Forwards to worker GET /api/admin/analytics/today/visits/list
// (per-target rollup). The worker responds with
// `Cache-Control: no-store, private` because the list MUST always
// reflect the latest flush; the standard `passthrough` strips that
// header, so we re-attach it here.

import { adminApiAs, createProxyHandler } from "@/lib/admin-proxy";

const NO_STORE = "no-store, private";

export const GET = createProxyHandler(async (request, admin) => {
	const url = new URL(request.url);
	const search = url.searchParams.toString();
	const target = `/api/admin/analytics/today/visits/list${search ? `?${search}` : ""}`;
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
