import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const res = await adminApiAs(admin, request).raw("GET", `/api/admin/censor-words/${id}`);
	return passthrough(res);
});

export const PATCH = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const api = adminApiAs(admin, request);
	const res = await api.raw("PATCH", `/api/admin/censor-words/${id}`, body);
	return passthrough(res);
});

export const DELETE = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const api = adminApiAs(admin, request);
	const res = await api.raw("DELETE", `/api/admin/censor-words/${id}`);
	return passthrough(res);
});
