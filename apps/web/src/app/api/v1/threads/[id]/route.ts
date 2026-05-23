// Proxy route: PATCH /api/v1/threads/:id
// Browser → Next.js → Worker (edit thread subject — author + moderator path).

import { proxyRoute } from "@/lib/forum-route-proxy";

export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/threads/${id}`,
	body: "json",
	debugTag: "threads/[id]/route",
});
