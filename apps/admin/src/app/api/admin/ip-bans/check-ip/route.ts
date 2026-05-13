import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, admin) => {
	const url = new URL(request.url);
	const ip = url.searchParams.get("ip") ?? "";
	const res = await adminApiAs(admin, request).raw(
		"GET",
		`/api/admin/ip-bans/check-ip?ip=${encodeURIComponent(ip)}`,
	);
	return passthrough(res);
});
