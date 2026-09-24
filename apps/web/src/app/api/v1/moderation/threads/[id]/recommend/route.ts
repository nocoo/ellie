import { invalidateDisplayAfterWrite, parseRouteId } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * POST   /api/v1/moderation/threads/:id/recommend — add thread to its
 *                                                   forum's recommended list
 * DELETE /api/v1/moderation/threads/:id/recommend — remove it
 *
 * Mod+ only (worker enforces canModerate). Both verbs are idempotent —
 * see `apps/worker/src/handlers/recommended.ts`. Display caps at 6 newest
 * threads; recommend cards do not affect thread-count.
 */
const invalidate = <T>(result: T, ctx: { params: { id: string } }): T => {
	const threadId = parseRouteId(ctx.params.id);
	invalidateDisplayAfterWrite({
		homeDisplay: true,
		threadDetail: threadId != null ? { threadId } : { all: true },
	});
	return result;
};

export const POST = proxyRoute<{ id: string }>({
	method: "POST",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/recommend`,
	body: "empty",
	transform: invalidate,
	debugTag: "moderation/threads/[id]/recommend/route",
});

export const DELETE = proxyRoute<{ id: string }>({
	method: "DELETE",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/recommend`,
	body: "empty",
	transform: invalidate,
	debugTag: "moderation/threads/[id]/recommend/route",
});
