// PATCH /api/admin/users/:id/checkins/:dateLocal — toggle a single day's
// check-in for the user. Body { checkedIn: boolean }. Worker handles
// validation (date shape, calendar legality, "streak" reservation) and
// runs recomputeFromHistory(allowEmptyReset:true) so aggregates stay in
// sync with the audit log.

import { adminApiAs, createProxyHandler, passthrough } from "@/lib/admin-proxy";

export const PATCH = createProxyHandler(async (request, admin, context) => {
	const { id, dateLocal } = await context.params;
	const body = await request.json();
	const api = adminApiAs(admin, request);
	const res = await api.raw(
		"PATCH",
		`/api/admin/users/${id}/checkins/${encodeURIComponent(dateLocal)}`,
		body,
	);
	return passthrough(res);
});
