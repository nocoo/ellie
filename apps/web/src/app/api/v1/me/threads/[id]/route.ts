import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * DELETE /api/v1/me/threads/:id
 * Delete own thread (author only)
 */
export const DELETE = proxyRoute<{ id: string }>({
	method: "DELETE",
	path: ({ id }) => `/api/v1/me/threads/${id}`,
	body: "empty",
	debugTag: "me/threads/[id]/route",
});
