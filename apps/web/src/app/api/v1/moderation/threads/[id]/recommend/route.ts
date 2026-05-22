import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * POST   /api/v1/moderation/threads/:id/recommend — add thread to its
 *                                                   forum's recommended list
 * DELETE /api/v1/moderation/threads/:id/recommend — remove it
 *
 * Mod+ only (worker enforces canModerate). Both verbs are idempotent —
 * see `apps/worker/src/handlers/recommended.ts`. The display layer caps
 * at 6 newest threads; the data layer is uncapped.
 */
export const POST = proxyRoute<{ id: string }>({
	method: "POST",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/recommend`,
	body: "empty",
	debugTag: "moderation/threads/[id]/recommend/route",
});

export const DELETE = proxyRoute<{ id: string }>({
	method: "DELETE",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/recommend`,
	body: "empty",
	debugTag: "moderation/threads/[id]/recommend/route",
});
