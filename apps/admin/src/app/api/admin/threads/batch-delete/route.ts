import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const POST = createProxyHandler(async (request, admin) => {
	const body = await request.json();
	const api = adminApiAs(admin);
	const res = await api.raw("POST", "/api/admin/threads/batch-delete", body);
	return passthrough(res);
});
