import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const res = await adminApiAs(admin, request).raw("GET", `/api/admin/admin-logs/${id}`);
	return passthrough(res);
});
