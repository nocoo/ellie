import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * GET /api/v1/moderation/users/:id/status
 * Get user status for moderation (Admin/SuperMod only)
 */
export const GET = proxyRoute<{ id: string }>({
	method: "GET",
	path: ({ id }) => `/api/v1/moderation/users/${id}/status`,
	debugTag: "moderation/users/[id]/status/route",
});
