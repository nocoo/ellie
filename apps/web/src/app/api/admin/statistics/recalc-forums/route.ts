import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async () => {
	const res = await adminApi.raw("POST", "/api/admin/statistics/recalc-forums");
	return passthrough(res);
});
