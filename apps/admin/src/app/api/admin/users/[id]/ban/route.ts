import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request, _admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const res = await adminApi.raw("POST", `/api/admin/users/${id}/ban`, body);
	return passthrough(res);
});
