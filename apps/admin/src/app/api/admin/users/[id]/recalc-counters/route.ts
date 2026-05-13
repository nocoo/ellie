import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const api = adminApiAs(admin, request);
	const res = await api.raw("POST", `/api/admin/users/${id}/recalc-counters`);
	return passthrough(res);
});
