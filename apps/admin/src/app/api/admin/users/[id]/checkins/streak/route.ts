// PATCH /api/admin/users/:id/checkins/streak — manual streak override.
// Body { streakDays: number }. The worker response notes that the value
// will be overwritten by the next history-based recompute (i.e. next time
// an admin toggles a day for this user). The UI surfaces that warning
// next to the control.

import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const PATCH = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const body = await request.json();
	const api = adminApiAs(admin, request);
	const res = await api.raw("PATCH", `/api/admin/users/${id}/checkins/streak`, body);
	return passthrough(res);
});
