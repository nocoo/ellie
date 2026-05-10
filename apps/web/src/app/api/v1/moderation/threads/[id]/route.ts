import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * DELETE /api/v1/moderation/threads/:id
 * Delete a thread (Mod+ only)
 */
export const DELETE = proxyRoute<{ id: string }>({
	method: "DELETE",
	path: ({ id }) => `/api/v1/moderation/threads/${id}`,
	body: "empty",
	debugTag: "moderation/threads/[id]/route",
});
