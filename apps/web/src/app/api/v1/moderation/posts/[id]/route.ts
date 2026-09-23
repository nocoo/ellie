import { invalidateDisplayAfterWrite } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * DELETE /api/v1/moderation/posts/:id
 * Delete a post (Mod+ only)
 */
export const DELETE = proxyRoute<{ id: string }>({
	method: "DELETE",
	path: ({ id }) => `/api/v1/moderation/posts/${id}`,
	body: "empty",
	transform: (result) => {
		invalidateDisplayAfterWrite({ forumSummaries: true, threadCounts: true, siteStats: true });
		return result;
	},
	debugTag: "moderation/posts/[id]/route",
});

/**
 * PATCH /api/v1/moderation/posts/:id
 * Edit a post (Mod+ only)
 */
export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/moderation/posts/${id}`,
	body: "json",
	transform: (result) => {
		invalidateDisplayAfterWrite({ forumSummaries: true, siteStats: true });
		return result;
	},
	debugTag: "moderation/posts/[id]/route",
});
