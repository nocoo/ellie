import { adminApi, adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";
import type { NextRequest } from "next/server";

export const GET = createProxyHandler(async (request: NextRequest) => {
	const url = new URL(request.url);
	const prefix = url.searchParams.get("prefix") || "";
	const res = await adminApi.raw("GET", `/api/admin/settings?prefix=${encodeURIComponent(prefix)}`);
	return passthrough(res);
});

export const PUT = createProxyHandler(async (request, admin) => {
	const body = await request.json();
	const api = adminApiAs(admin);
	const res = await api.raw("PUT", "/api/admin/settings", body);
	return passthrough(res);
});
