import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request, admin) => {
	const api = adminApiAs(admin, request);
	const res = await api.raw("POST", "/api/admin/statistics/recalc-forums");
	return passthrough(res);
});
