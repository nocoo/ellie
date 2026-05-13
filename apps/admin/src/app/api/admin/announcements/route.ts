import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const url = new URL(request.url);
	const res = await adminApiAs(admin, request).raw(
		"GET",
		`/api/admin/announcements?${url.searchParams.toString()}`,
	);
	return passthrough(res);
});

export const POST = createProxyHandler(async (request, admin) => {
	const body = await request.json();
	const api = adminApiAs(admin, request);
	const res = await api.raw("POST", "/api/admin/announcements", body);
	return passthrough(res);
});
