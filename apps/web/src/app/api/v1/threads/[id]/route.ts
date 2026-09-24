// Proxy route: PATCH /api/v1/threads/:id
// Browser → Next.js → Worker (edit thread subject — author + moderator path).

import { invalidateDisplayAfterWrite, parseRouteId } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";

export const PATCH = proxyRoute<{ id: string }>({
	method: "PATCH",
	path: ({ id }) => `/api/v1/threads/${id}`,
	body: "json",
	transform: (result, { params }) => {
		const threadId = parseRouteId(params.id);
		invalidateDisplayAfterWrite({
			forumSummaries: true,
			threadDetail: threadId != null ? { threadId } : { all: true },
		});
		return result;
	},
	debugTag: "threads/[id]/route",
});
