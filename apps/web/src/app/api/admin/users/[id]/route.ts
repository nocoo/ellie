import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (_request, _admin, context) => {
	const { id } = await context.params;
	const res = await adminApi.raw("GET", `/api/admin/users/${id}`);
	return passthrough(res);
});

export const PATCH = createProxyHandler(async (request, _admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const res = await adminApi.raw("PATCH", `/api/admin/users/${id}`, body);
	return passthrough(res);
});
