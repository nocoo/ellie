import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (_request, admin, context) => {
	const { id } = await context.params;
	const api = adminApiAs(admin);
	const res = await api.raw("POST", `/api/admin/users/${id}/unban`);
	return passthrough(res);
});
