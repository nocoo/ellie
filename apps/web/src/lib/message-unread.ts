import "server-only";

import { ForumApiError, forumApi } from "./forum-api";
import { getCurrentForumUser, getWorkerJwt } from "./forum-auth";
import { createTtlCache, type TtlCache } from "./ttl-cache";

export const MESSAGE_UNREAD_INTERVAL_MS = 3_600_000;
export const MESSAGE_UNREAD_MAX_ACCOUNTS = 256;

const processState = globalThis as typeof globalThis & {
	__ellieMessageUnread?: TtlCache<number, number>;
};
const estimates =
	processState.__ellieMessageUnread ??
	createTtlCache<number, number>({
		expirationMs: MESSAGE_UNREAD_INTERVAL_MS,
		maxEntries: MESSAGE_UNREAD_MAX_ACCOUNTS,
		load: async () => {
			const jwt = await getWorkerJwt();
			if (!jwt) throw new ForumApiError(401, "NOT_AUTHENTICATED", "Not authenticated");
			const { data } = await forumApi.getAuth<{ count: number }>(
				"/api/v1/messages/unread-count",
				jwt,
			);
			if (!Number.isSafeInteger(data.count) || data.count < 0)
				throw new Error("Invalid unread estimate");
			return data.count;
		},
	});
processState.__ellieMessageUnread = estimates;

export async function readUnreadEstimate() {
	const user = await getCurrentForumUser();
	if (!user || !Number.isSafeInteger(user.userId) || user.userId <= 0) {
		throw new ForumApiError(401, "NOT_AUTHENTICATED", "Not authenticated");
	}
	return {
		data: { count: await estimates.get(user.userId) },
		meta: { timestamp: Date.now(), requestId: crypto.randomUUID() },
	};
}

export async function invalidateUnreadEstimate(receiverId?: number): Promise<void> {
	try {
		const user = await getCurrentForumUser();
		if (user && Number.isSafeInteger(user.userId) && user.userId > 0) estimates.clear(user.userId);
	} catch {
		console.warn("[messages] unread estimate invalidation unavailable");
	}
	if (receiverId !== undefined && Number.isSafeInteger(receiverId) && receiverId > 0)
		estimates.clear(receiverId);
}
