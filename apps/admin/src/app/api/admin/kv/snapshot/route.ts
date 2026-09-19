import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request, admin) => {
	const res = await adminApiAs(admin, request).raw("POST", "/api/admin/kv/snapshot", {});
	return passthrough(res);
});
