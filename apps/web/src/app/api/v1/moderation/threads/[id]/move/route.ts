import { invalidateDisplayAfterWrite, parseRouteId } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * PATCH /api/v1/moderation/threads/:id/move
 * Move thread to another forum (Mod+ only)
 *
 * Worker returns only the target forumId; source is not in the envelope →
 * full-clear thread-count to avoid stranding a stale source total.
 */
export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/move`,
	body: "json",
	transform: (result, { params }) => {
		const threadId = parseRouteId(params.id);
		invalidateDisplayAfterWrite({
			forumSummaries: true,
			threadCounts: true,
			siteStats: true,
			threadDetail: threadId != null ? { threadId } : { all: true },
		});
		return result;
	},
	debugTag: "moderation/threads/[id]/move/route",
});
