import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (_request, _admin, context) => {
	const { id } = await context.params;
	const res = await adminApi.raw("GET", `/api/admin/reports/${id}`);
	return passthrough(res);
});

export const PATCH = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = (await request.json()) as Record<string, unknown>;

	// Inject handler info from admin session
	// handlerId is fixed to 0 (admin has no numeric ID), only handlerName is used
	const enrichedBody = {
		...body,
		handlerId: 0,
		handlerName: admin.name || admin.email,
	};

	const res = await adminApi.raw("PATCH", `/api/admin/reports/${id}`, enrichedBody);
	return passthrough(res);
});
