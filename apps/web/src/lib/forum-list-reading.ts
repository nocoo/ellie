import "server-only";

import {
	FORUM_LIST_CONTEXT_PATH,
	type ForumListContextData,
	type ForumListSnapshot,
	forumListCacheKey,
	type HomeStats,
	isReadingBucket,
	type ReadingBucket,
	UserRole,
} from "@ellie/types";
import { forumApi } from "./forum-api";
import { getCurrentForumUser, getWorkerJwt } from "./forum-auth";
import type { ForumListLocation } from "./forum-list-location";
import { threadCountKey } from "./forum-reading";
import { getMemoryRuntime, type MemoryRuntime } from "./memory-runtime";

type ListParams = ForumListLocation & { limit: number };

function validateContext(data: ForumListContextData, params: ListParams) {
	if (
		!data ||
		!isReadingBucket(data.bucket) ||
		data.page !== params.page ||
		data.limit !== params.limit ||
		(data.typeId !== null && data.typeId !== params.typeId) ||
		typeof data.hasNext !== "boolean" ||
		typeof data.revision !== "string" ||
		!/^[a-f0-9]{64}$/.test(data.revision)
	)
		throw new Error("Invalid forum list context");
}

function validateDisplay(
	display: ForumListSnapshot["display"] | undefined,
	forumId: number,
	limit: number,
): asserts display is ForumListSnapshot["display"] {
	if (
		!display ||
		!Array.isArray(display.forums) ||
		!display.forums.some((forum) => forum.id === forumId) ||
		!Array.isArray(display.threads) ||
		display.threads.length > limit ||
		!Array.isArray(display.recommended) ||
		display.recommended.length > 6 ||
		!display.threadTypes ||
		!Array.isArray(display.threadTypes.types)
	) {
		throw new Error("Incomplete forum list context");
	}
}

export function loadForumListContext(params: ListParams) {
	const runtime = getMemoryRuntime();
	return runtime.runLoad("forum-list", () => readContext(runtime, params));
}

function bucketHint(jwt: string | null, role: number | undefined): ReadingBucket {
	if (!jwt) return "anon";
	if (role === UserRole.Admin) return "admin";
	if (role === UserRole.Mod || role === UserRole.SuperMod) return "staff";
	return "member";
}

async function readContext(
	runtime: MemoryRuntime,
	params: ListParams,
	forceDisplay = false,
): Promise<
	ForumListContextData & {
		forumId: number;
		display: ForumListSnapshot["display"];
		total: number;
		stats: HomeStats | undefined;
	}
> {
	const [jwt, session] = await Promise.all([getWorkerJwt(), getCurrentForumUser()]);
	const hint = bucketHint(jwt, session?.role);
	const { forumId, page, limit, typeId } = params;
	const key = forumListCacheKey(hint, forumId, page, limit, typeId);
	const displayToken = runtime.capture("forum-list");
	const statsToken = runtime.capture("site-stats");
	const countToken = runtime.capture("thread-count");
	const cached = forceDisplay ? undefined : runtime.peek<ForumListSnapshot>("forum-list", key);
	const cachedStats = runtime.peek<HomeStats>("site-stats", "site:v1");
	const countKey = threadCountKey(forumId, typeId, hint);
	const cachedCount = runtime.peek<number>("thread-count", countKey);
	const { data } = await forumApi.postRead<ForumListContextData>(
		FORUM_LIST_CONTEXT_PATH,
		{
			...params,
			cachedBucket: hint,
			cachedRevision: cached?.revision ?? null,
			includeDisplay: !cached,
			includeStats: cachedStats === undefined,
			includeCount: cachedCount === undefined,
		},
		jwt ?? undefined,
	);
	validateContext(data, params);
	const sameKey = data.bucket === hint && data.typeId === typeId;
	const current =
		data.display || forceDisplay ? undefined : runtime.peek<ForumListSnapshot>("forum-list", key);
	const currentCount =
		data.count === undefined ? runtime.peek<number>("thread-count", countKey) : undefined;
	const reusable = sameKey && current?.revision === data.revision;
	const lostDisplay = !data.display && sameKey && cached?.revision === data.revision && !reusable;
	const lostCount =
		data.count === undefined && sameKey && cachedCount !== undefined && currentCount === undefined;
	if (!forceDisplay && (lostDisplay || lostCount)) return readContext(runtime, params, true);
	const display = data.display ?? (reusable ? current.display : undefined);
	validateDisplay(display, forumId, limit);
	const total = data.count ?? (sameKey ? currentCount : undefined);
	if (total === undefined || !Number.isSafeInteger(total) || total < 0) {
		throw new Error("Invalid forum list count");
	}
	if (data.display) {
		runtime.admit(
			forumListCacheKey(data.bucket, forumId, page, limit, data.typeId),
			{
				revision: data.revision,
				display,
			},
			displayToken,
		);
	}
	if (data.stats) runtime.admit("site:v1", data.stats, statsToken);
	if (data.count !== undefined)
		runtime.admit(threadCountKey(forumId, data.typeId, data.bucket), data.count, countToken);
	if (data.user) runtime.recordActivity(data.user.id);
	return {
		...data,
		forumId,
		display,
		total,
		stats: data.stats ?? runtime.peek<HomeStats>("site-stats", "site:v1"),
	};
}
