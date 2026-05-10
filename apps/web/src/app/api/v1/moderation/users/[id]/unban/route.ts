import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * POST /api/v1/moderation/users/:id/unban
 * Unban a user (Admin/SuperMod only)
 */
export const POST = proxyRoute<{ id: string }>({
	method: "POST",
	path: ({ id }) => `/api/v1/moderation/users/${id}/unban`,
	body: "empty",
	debugTag: "moderation/users/[id]/unban/route",
});
