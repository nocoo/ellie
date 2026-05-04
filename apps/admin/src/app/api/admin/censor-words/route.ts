import { adminApi, adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request) => {
	const url = new URL(request.url);
	const res = await adminApi.raw("GET", `/api/admin/censor-words?${url.searchParams.toString()}`);
	return passthrough(res);
});

export const POST = createProxyHandler(async (request, admin) => {
	const body = await request.json();
	const api = adminApiAs(admin);
	const res = await api.raw("POST", "/api/admin/censor-words", body);
	return passthrough(res);
});
