import { invalidateDisplayAfterWrite, parseRouteId } from "@/lib/display-invalidation";
import { proxyRoute } from "@/lib/forum-route-proxy";
import { getMemoryRuntime } from "@/lib/memory-runtime";

const invalidate = <T>(result: T, ctx: { params: { id: string } }): T => {
	const threadId = parseRouteId(ctx.params.id);
	getMemoryRuntime().clear("forum-read");
	invalidateDisplayAfterWrite({
		homeDisplay: true,
		threadDetail: threadId != null ? { threadId } : { all: true },
	});
	return result;
};

export const POST = proxyRoute<{ id: string }>({
	method: "POST",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/recommend`,
	body: "empty",
	transform: invalidate,
	debugTag: "moderation/threads/[id]/recommend/route",
});

export const DELETE = proxyRoute<{ id: string }>({
	method: "DELETE",
	path: ({ id }) => `/api/v1/moderation/threads/${id}/recommend`,
	body: "empty",
	transform: invalidate,
	debugTag: "moderation/threads/[id]/recommend/route",
});
