import type { NextRequest } from "next/server";
import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request: NextRequest, admin) => {
	const url = new URL(request.url);
	const prefix = url.searchParams.get("prefix") || "";
	const res = await adminApiAs(admin, request).raw(
		"GET",
		`/api/admin/settings?prefix=${encodeURIComponent(prefix)}`,
	);
	return passthrough(res);
});

export const PUT = createProxyHandler(async (request, admin) => {
	const body = await request.json();
	const api = adminApiAs(admin, request);
	const res = await api.raw("PUT", "/api/admin/settings", body);
	return passthrough(res);
});
