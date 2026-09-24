import { invalidateDisplayAfterWrite } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

/**
 * PATCH /api/v1/moderation/threads/:id/digest
 * Set thread digest level (Mod+ only)
 */
export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/digest`,
	body: "json",
	transform: (result) => {
		invalidateDisplayAfterWrite({ homeDisplay: true });
		return result;
	},
	debugTag: "moderation/threads/[id]/digest/route",
});
