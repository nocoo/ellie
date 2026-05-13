import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const api = adminApiAs(admin, request);
	const res = await api.raw("GET", `/api/admin/users/${id}`);
	return passthrough(res);
});

export const PATCH = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const api = adminApiAs(admin, request);
	const res = await api.raw("PATCH", `/api/admin/users/${id}`, body);
	return passthrough(res);
});
