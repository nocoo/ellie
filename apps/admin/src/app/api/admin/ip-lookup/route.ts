// Admin IP lookup BFF proxy — Phase G.6.2.
//
// Pure passthrough to worker `GET /api/admin/ip-lookup?ip=<addr>`. The
// upstream provider key (`IP_LOOKUP_API_KEY`) lives ONLY in the worker
// — this route MUST NOT read, import, log, or forward it. We only carry
// the admin's identity (Key B + actor headers via `adminApiAs`) and
// the queried IP from the original request.
import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const url = new URL(request.url);
	const res = await adminApiAs(admin, request).raw(
		"GET",
		`/api/admin/ip-lookup?${url.searchParams.toString()}`,
	);
	return passthrough(res);
});
