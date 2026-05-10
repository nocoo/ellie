import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * GET /api/v1/moderation/users/:id/ip-records
 * Get IP records for a user (Admin/SuperMod only)
 */
export const GET = proxyRoute<{ id: string }>({
	method: "GET",
	path: ({ id }) => `/api/v1/moderation/users/${id}/ip-records`,
	debugTag: "moderation/users/[id]/ip-records/route",
});
