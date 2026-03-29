import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (_request, _admin, context) => {
	const { id } = await context.params;
	const res = await adminApi.raw("POST", `/api/admin/users/${id}/nuke`);
	return passthrough(res);
});
