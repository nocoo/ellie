import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const api = adminApiAs(admin, request);
	const res = await api.raw("GET", `/api/admin/attachments/${id}`);
	return passthrough(res);
});

export const DELETE = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const api = adminApiAs(admin, request);
	const res = await api.raw("DELETE", `/api/admin/attachments/${id}`);
	return passthrough(res);
});
