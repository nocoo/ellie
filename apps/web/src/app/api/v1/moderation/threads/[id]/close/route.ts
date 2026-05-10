import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * PATCH /api/v1/moderation/threads/:id/close
 * Open/close thread (Mod+ only)
 */
export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/close`,
	body: "json",
	debugTag: "moderation/threads/[id]/close/route",
});
