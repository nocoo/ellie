import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * DELETE /api/v1/me/posts/:id
 * Delete own post (author only)
 */
export const DELETE = proxyRoute<{ id: string }>({
	method: "DELETE",
	path: ({ id }) => `/api/v1/me/posts/${id}`,
	body: "empty",
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
	debugTag: "me/posts/[id]/route",
});
