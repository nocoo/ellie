import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";
import type { NextRequest } from "next/server";

export const GET = createProxyHandler(async (request: NextRequest) => {
	const url = new URL(request.url);
	const prefix = url.searchParams.get("prefix") || "";
	const res = await adminApi.raw("GET", `/api/admin/settings?prefix=${encodeURIComponent(prefix)}`);
	return passthrough(res);
});

export const PUT = createProxyHandler(async (request) => {
	const body = await request.json();
	const res = await adminApi.raw("PUT", "/api/admin/settings", body);
	return passthrough(res);
});
