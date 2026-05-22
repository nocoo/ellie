import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

// GET /api/admin/statistics/job/forums — read-only progress snapshot.
// See apps/worker/src/lib/stats-job.ts for the payload shape.
export const GET = createProxyHandler(async (request, admin) => {
	const api = adminApiAs(admin, request);
	const res = await api.raw("GET", "/api/admin/statistics/job/forums");
	return passthrough(res);
});
