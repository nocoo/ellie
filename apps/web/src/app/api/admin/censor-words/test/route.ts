import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request) => {
	const body = await request.json();
	const res = await adminApi.raw("POST", "/api/admin/censor-words/test", body);
	return passthrough(res);
});
