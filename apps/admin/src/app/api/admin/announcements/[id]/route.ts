import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (_request, _admin, context) => {
	const { id } = await context.params;
	const res = await adminApi.raw("GET", `/api/admin/announcements/${id}`);
	return passthrough(res);
});

export const PATCH = createProxyHandler(async (request, _admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const res = await adminApi.raw("PATCH", `/api/admin/announcements/${id}`, body);
	return passthrough(res);
});

export const DELETE = createProxyHandler(async (_request, _admin, context) => {
	const { id } = await context.params;
	const res = await adminApi.raw("DELETE", `/api/admin/announcements/${id}`);
	return passthrough(res);
});
