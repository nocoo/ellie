import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request) => {
	const url = new URL(request.url);
	const res = await adminApi.raw("GET", `/api/admin/threads?${url.searchParams.toString()}`);
	return passthrough(res);
});
