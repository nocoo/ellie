import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

// GET /api/admin/statistics/job/threads — read-only progress snapshot.
export const GET = createProxyHandler(async (request, admin) => {
	const api = adminApiAs(admin, request);
	const res = await api.raw("GET", "/api/admin/statistics/job/threads");
	return passthrough(res);
});
