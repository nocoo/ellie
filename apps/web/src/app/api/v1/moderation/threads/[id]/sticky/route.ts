import { invalidateDisplayAfterWrite } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * PATCH /api/v1/moderation/threads/:id/sticky
 * Set thread sticky level (Mod+ only)
 */
export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/sticky`,
	body: "json",
	transform: (result) => {
		invalidateDisplayAfterWrite({ forumSummaries: true, threadCounts: true, siteStats: true });
		return result;
	},
	debugTag: "moderation/threads/[id]/sticky/route",
});
