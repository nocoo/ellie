import { proxyRoute } from "@/lib/forum-route-proxy";
import { readUnreadEstimate } from "@/lib/message-unread";

const read = proxyRoute<Record<string, never>>({
	method: "GET",
	path: () => "/api/v1/messages/unread-count",
	query: "none",
	read: readUnreadEstimate,
	debugTag: "messages/unread-count",
});

export const GET: typeof read = async (request, context) => {
	const response = await read(request, context);
	response.headers.set("Cache-Control", "private, no-store");
	return response;
};
