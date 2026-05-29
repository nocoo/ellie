import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const res = await adminApiAs(admin, request).raw("GET", "/api/admin/stats/calibrate");
	return passthrough(res);
});

export const POST = createProxyHandler(async (request, admin) => {
	const body = await request.json();
	const res = await adminApiAs(admin, request).raw("POST", "/api/admin/stats/calibrate", body);
	return passthrough(res);
});
