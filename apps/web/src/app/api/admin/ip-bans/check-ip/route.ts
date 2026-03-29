import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request) => {
	const url = new URL(request.url);
	const ip = url.searchParams.get("ip") ?? "";
	const res = await adminApi.raw("GET", `/api/admin/ip-bans/check-ip?ip=${encodeURIComponent(ip)}`);
	return passthrough(res);
});
