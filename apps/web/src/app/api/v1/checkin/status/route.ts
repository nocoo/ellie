// Proxy route: GET /api/v1/checkin/status
// Browser → Next.js → Worker (get checkin status)

import { proxyRoute } from "@/lib/forum-route-proxy";

export const GET = proxyRoute<Record<string, never>>({
	method: "GET",
	path: () => "/api/v1/checkin/status",
	query: "none",
	debugTag: "checkin/status",
});
