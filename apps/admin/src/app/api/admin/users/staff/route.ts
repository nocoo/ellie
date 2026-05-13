import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const res = await adminApiAs(admin, request).raw("GET", "/api/admin/users/staff");
	return passthrough(res);
});
