// BFF proxy for the user-scoped admin check-in endpoints (Phase F).
// Forwards GET /api/admin/users/:id/checkins?from=&to= to the worker.
// The PATCH date / streak routes live in nested files because Next's
// dynamic-segment routing forces one handler file per [param] folder.

import { adminApi, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const GET = createProxyHandler(async (request, _admin, context) => {
	const { id } = await context.params;
	const url = new URL(request.url);
	const qs = url.searchParams.toString();
	const path =
		qs.length > 0 ? `/api/admin/users/${id}/checkins?${qs}` : `/api/admin/users/${id}/checkins`;
	const res = await adminApi.raw("GET", path);
	return passthrough(res);
});
