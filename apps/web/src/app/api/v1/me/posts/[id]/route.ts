import { invalidateDisplayAfterWrite } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * DELETE /api/v1/me/posts/:id
 * Delete own post (author only)
 *
 * Deleting a post does not change thread-count. PostId is not a threadId,
 * so the domain-flag default takes the bounded full clear.
 */
export const DELETE = proxyRoute<{ id: string }>({
	method: "DELETE",
	path: ({ id }) => `/api/v1/me/posts/${id}`,
	body: "empty",
	transform: (result) => {
		invalidateDisplayAfterWrite({ forumSummaries: true, siteStats: true });
		return result;
	},
	debugTag: "me/posts/[id]/route",
});

/**
 * PATCH /api/v1/me/posts/:id
 * Edit own post (author only)
 */
export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/me/posts/${id}`,
	body: "json",
	transform: (result) => {
		invalidateDisplayAfterWrite({ forumSummaries: true });
		return result;
	},
	debugTag: "me/posts/[id]/route",
});
