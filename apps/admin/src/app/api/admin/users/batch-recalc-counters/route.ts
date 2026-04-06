import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request) => {
	const body = await request.json().catch(() => ({}));
	const res = await adminApi.raw("POST", "/api/admin/users/batch-recalc-counters", body);
	return passthrough(res);
});
