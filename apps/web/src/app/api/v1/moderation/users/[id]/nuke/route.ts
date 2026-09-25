import { invalidateDisplayAfterWrite } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * POST /api/v1/moderation/users/:id/nuke
 * Ban user and delete all their content (Admin/SuperMod only)
 */
export const POST = proxyRoute<{ id: string }>({
	method: "POST",
	path: ({ id }) => `/api/v1/moderation/users/${id}/nuke`,
	body: "empty",
	transform: (result) => {
		invalidateDisplayAfterWrite({ forumSummaries: true });
		return result;
	},
	debugTag: "moderation/users/[id]/nuke/route",
});
