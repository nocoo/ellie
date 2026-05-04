import { adminApi, adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (_request, _admin, context) => {
	const { id } = await context.params;
	const res = await adminApi.raw("GET", `/api/admin/forums/${id}`);
	return passthrough(res);
});

export const PATCH = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const api = adminApiAs(admin);
	const res = await api.raw("PATCH", `/api/admin/forums/${id}`, body);
	return passthrough(res);
});

export const DELETE = createProxyHandler(async (_request, admin, context) => {
	const { id } = await context.params;
	const api = adminApiAs(admin);
	const res = await api.raw("DELETE", `/api/admin/forums/${id}`);
	return passthrough(res);
});
