import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (_request, _admin, context) => {
	const { id } = await context.params;
	const res = await adminApi.raw("GET", `/api/admin/attachments/${id}`);
	return passthrough(res);
});

export const DELETE = createProxyHandler(async (_request, _admin, context) => {
	const { id } = await context.params;
	const res = await adminApi.raw("DELETE", `/api/admin/attachments/${id}`);
	return passthrough(res);
});
