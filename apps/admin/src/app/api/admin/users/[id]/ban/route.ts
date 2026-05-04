import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const api = adminApiAs(admin);
	const res = await api.raw("POST", `/api/admin/users/${id}/ban`, body);
	return passthrough(res);
});
