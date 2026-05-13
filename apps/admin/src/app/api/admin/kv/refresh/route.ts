import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request, admin) => {
	const body = await request.json().catch(() => ({}));
	const api = adminApiAs(admin, request);
	const res = await api.raw("POST", "/api/admin/kv/refresh", body);
	return passthrough(res);
});
