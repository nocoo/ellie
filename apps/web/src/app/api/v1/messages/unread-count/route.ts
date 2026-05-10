// Proxy route: GET /api/v1/messages/unread-count

import { proxyRoute } from "@/lib/forum-route-proxy";

export const GET = proxyRoute<Record<string, never>>({
	method: "GET",
	path: () => "/api/v1/messages/unread-count",
	query: "none",
	debugTag: "messages/unread-count",
});
