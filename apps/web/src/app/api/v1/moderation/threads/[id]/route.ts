import { invalidateDisplayAfterWrite } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * DELETE /api/v1/moderation/threads/:id
 * Delete a thread (Mod+ only)
 */
export const DELETE = proxyRoute<{ id: string }>({
	method: "DELETE",
	path: ({ id }) => `/api/v1/moderation/threads/${id}`,
	body: "empty",
	transform: (result) => {
		invalidateDisplayAfterWrite({ forumSummaries: true, threadCounts: true, siteStats: true });
		return result;
	},
	debugTag: "moderation/threads/[id]/route",
});
