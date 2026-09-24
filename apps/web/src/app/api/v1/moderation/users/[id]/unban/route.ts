import { invalidateDisplayAfterWrite } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * POST /api/v1/moderation/users/:id/unban
 * Unban a user (Admin/SuperMod only)
 */
export const POST = proxyRoute<{ id: string }>({
	method: "POST",
	path: ({ id }) => `/api/v1/moderation/users/${id}/unban`,
	body: "empty",
	transform: (result) => {
		invalidateDisplayAfterWrite({ homeDisplay: true });
		return result;
	},
	debugTag: "moderation/users/[id]/unban/route",
});
