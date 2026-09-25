import { invalidateDisplayAfterWrite, parseRouteId } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/close`,
	body: "json",
	transform: (result, { params }) => {
		const threadId = parseRouteId(params.id);
		invalidateDisplayAfterWrite({
			homeDisplay: true,
			threadDetail: threadId != null ? { threadId } : { all: true },
		});
		return result;
	},
	debugTag: "moderation/threads/[id]/close/route",
});
