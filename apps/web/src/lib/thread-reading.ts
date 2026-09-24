import "server-only";

import {
	decodeThreadDetailCursor,
	type HomeStats,
	THREAD_DETAIL_CONTEXT_PATH,
	type ThreadDetailContextData,
	type ThreadDetailContextRequest,
	type ThreadDetailSnapshot,
	threadDetailSelection,
} from "@ellie/types";
import { forumApi } from "./forum-api";
import { getWorkerJwt } from "./forum-auth";
import { getMemoryRuntime, type MemoryRuntime } from "./memory-runtime";

type ThreadParams = Pick<ThreadDetailContextRequest, "threadId" | "limit" | "cursor" | "last">;

function validateDisplay(
	display: ThreadDetailSnapshot["display"] | undefined,
	thread: ThreadDetailContextData["thread"],
	params: ThreadParams,
): asserts display is ThreadDetailSnapshot["display"] {
	if (
		!display ||
		(display.forum !== null && display.forum?.id !== thread.forumId) ||
		!Array.isArray(display.posts) ||
		display.posts.length > params.limit ||
		display.posts.some((post) => post.threadId !== params.threadId) ||
		!Array.isArray(display.authors) ||
		!Array.isArray(display.attachments) ||
		!Array.isArray(display.ancestors)
	)
		throw new Error("Incomplete thread context");
}

export function loadThreadContext(params: ThreadParams) {
	const runtime = getMemoryRuntime();
	return runtime.runLoad("thread-detail", () => readContext(runtime, params));
}

async function readContext(
	runtime: MemoryRuntime,
	params: ThreadParams,
	forceFresh = false,
): Promise<
	ThreadDetailContextData & {
		display: ThreadDetailSnapshot["display"];
		stats: HomeStats | undefined;
	}
> {
	const jwt = await getWorkerJwt();
	const key = `thread:${params.threadId}`;
	const position = params.cursor === null ? null : decodeThreadDetailCursor(params.cursor);
	if (params.cursor !== null && (position === null || params.last))
		throw new Error("Invalid thread cursor");
	const selection = threadDetailSelection(params.threadId, params.limit, position, params.last);
	const displayToken = runtime.capture("thread-detail");
	const statsToken = runtime.capture("site-stats");
	const stored = forceFresh ? undefined : runtime.peek<ThreadDetailSnapshot>("thread-detail", key);
	const cached = stored?.selection === selection ? stored : undefined;
	const cachedStats = runtime.peek<HomeStats>("site-stats", "site:v1");
	const request: ThreadDetailContextRequest = {
		...params,
		cachedRevision: cached?.revision ?? null,
		includeDisplay: !cached,
		includeStats: cachedStats === undefined,
	};
	const signal = AbortSignal.timeout(15_000);
	const { data } = jwt
		? await forumApi.postAuth<ThreadDetailContextData>(
				THREAD_DETAIL_CONTEXT_PATH,
				request,
				jwt,
				undefined,
				signal,
			)
		: await forumApi.post<ThreadDetailContextData>(THREAD_DETAIL_CONTEXT_PATH, request, signal);
	if (
		!data ||
		data.thread?.id !== params.threadId ||
		typeof data.cacheable !== "boolean" ||
		typeof data.revision !== "string" ||
		!/^[a-f0-9]{64}$/.test(data.revision) ||
		(data.nextCursor !== null && typeof data.nextCursor !== "string")
	)
		throw new Error("Invalid thread context");
	const current =
		data.display || forceFresh
			? undefined
			: runtime.peek<ThreadDetailSnapshot>("thread-detail", key);
	const reusable = current?.selection === selection && current.revision === data.revision;
	if (
		!data.display &&
		data.cacheable &&
		cached?.revision === data.revision &&
		!reusable &&
		!forceFresh
	) {
		return readContext(runtime, params, true);
	}
	const display = data.display ?? (data.cacheable && reusable ? current.display : undefined);
	validateDisplay(display, data.thread, params);
	if (data.cacheable && data.display) {
		runtime.admit(key, { selection, revision: data.revision, display }, displayToken);
	}
	if (data.stats) runtime.admit("site:v1", data.stats, statsToken);
	if (data.user) runtime.recordActivity(data.user.id);
	return {
		...data,
		display,
		stats: data.stats ?? runtime.peek<HomeStats>("site-stats", "site:v1"),
	};
}
