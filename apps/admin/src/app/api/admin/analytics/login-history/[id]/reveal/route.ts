// BFF: POST /api/admin/analytics/login-history/:id/reveal
// Forwards to worker POST /api/admin/analytics/login-history/:id/reveal.
//
// The reveal endpoint returns the RAW ip / ua / username for one row.
// On the worker side success path writes admin_logs with action
// `analytics.login_history.reveal` (404 / 400 do NOT). We MUST:
//   1. Use POST so `adminApiAs(admin, request).raw("POST", ...)` injects
//      `X-Admin-Actor-Email` / `X-Admin-Actor-Name` headers — those are
//      what `resolveActor` reads to record a non-system actor.
//   2. Re-attach `Cache-Control: no-store, private` since the standard
//      `passthrough` strips it and the body carries un-masked PII.

import { adminApiAs, createProxyHandler } from "@/lib/admin-proxy";

const NO_STORE = "no-store, private";

export const POST = createProxyHandler(async (request, admin, context) => {
	const { id } = await context.params;
	const target = `/api/admin/analytics/login-history/${encodeURIComponent(id)}/reveal`;
	// Reveal carries no body — id is in the path. Pass an empty object so
	// the worker sees a well-formed POST.
	const res = await adminApiAs(admin, request).raw("POST", target, {});
	const body = await res.text();
	return new Response(body, {
		status: res.status,
		headers: {
			"Content-Type": res.headers.get("Content-Type") || "application/json",
			"Cache-Control": NO_STORE,
		},
	});
});
