import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const PUT = createProxyHandler(async (request) => {
	const body = await request.json();
	const res = await adminApi.raw("PUT", "/api/admin/settings", body);
	return passthrough(res);
});
