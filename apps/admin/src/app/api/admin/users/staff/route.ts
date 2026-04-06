import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async () => {
	const res = await adminApi.raw("GET", "/api/admin/users/staff");
	return passthrough(res);
});
