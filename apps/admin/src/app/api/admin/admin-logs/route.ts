import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const url = new URL(request.url);
	const res = await adminApiAs(admin, request).raw(
		"GET",
		`/api/admin/admin-logs?${url.searchParams.toString()}`,
	);
	return passthrough(res);
});
