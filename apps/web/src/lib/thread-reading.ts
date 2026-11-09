import "server-only";

import {
	decodeThreadDetailCursor,
	type HomeStats,
	type PostComment,
	THREAD_DETAIL_COMMENT_MAX_BYTES,
	THREAD_DETAIL_COMMENT_MAX_ROWS,
	THREAD_DETAIL_CONTEXT_PATH,
	type ThreadDetailContextData,
	type ThreadDetailContextRequest,
	type ThreadDetailSnapshot,
	threadDetailSelection,
} from "@ellie/types";
import { getDailyStatistics } from "./daily-statistics";
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

function validateComments(
	comments: ThreadDetailContextData["comments"] | undefined,
	commentError: ThreadDetailContextData["commentError"] | undefined,
	display: ThreadDetailSnapshot["display"],
	threadId: number,
): "load_failed" | "too_large" | null {
	if (comments === null) {
		return commentError === "load_failed" || commentError === "too_large"
			? commentError
			: "load_failed";
	}
	if (!Array.isArray(comments) || commentError !== undefined) return "load_failed";
	if (comments.length > THREAD_DETAIL_COMMENT_MAX_ROWS) return "too_large";
	const postIds = new Set(display.posts.map((post) => post.id));
	let bytes = 0;
	for (const comment of comments) {
		if (!comment || typeof comment !== "object") return "load_failed";
		const record = comment as PostComment;
		if (
			!Number.isSafeInteger(record.id) ||
			record.id <= 0 ||
			record.threadId !== threadId ||
			!postIds.has(record.postId) ||
			!Number.isSafeInteger(record.authorId) ||
			record.authorId < 0 ||
			typeof record.authorName !== "string" ||
			typeof record.authorAvatarPath !== "string" ||
			typeof record.content !== "string" ||
			!Number.isSafeInteger(record.score) ||
			!Number.isSafeInteger(record.replyPostId) ||
			record.replyPostId < 0 ||
			!Number.isSafeInteger(record.createdAt) ||
			record.createdAt < 0 ||
			Object.keys(record).some(
				(key) =>
					![
						"id",
						"threadId",
						"postId",
						"authorId",
						"authorName",
						"authorAvatarPath",
						"content",
						"score",
						"replyPostId",
						"createdAt",
					].includes(key),
			)
		)
			return "load_failed";
		bytes += new TextEncoder().encode(record.content).length;
		if (bytes > THREAD_DETAIL_COMMENT_MAX_BYTES) return "too_large";
	}
	return null;
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
	const stored = forceFresh ? undefined : runtime.peek<ThreadDetailSnapshot>("thread-detail", key);
	const cached = stored?.selection === selection ? stored : undefined;
	const daily = await getDailyStatistics().read();
	const request: ThreadDetailContextRequest = {
		...params,
		cachedRevision: cached?.revision ?? null,
		includeDisplay: !cached,
		includeStats: false,
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
		(data.nextCursor !== null && typeof data.nextCursor !== "string") ||
		(data.comments !== null && !Array.isArray(data.comments))
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
	const commentError = validateComments(data.comments, data.commentError, display, params.threadId);
	if (commentError) {
		data.comments = null;
		data.commentError = commentError;
	}
	if (data.cacheable && data.display) {
		runtime.admit(key, { selection, revision: data.revision, display }, displayToken);
	}
	if (data.user) runtime.recordActivity(data.user.id);
	return {
		...data,
		display,
		stats: daily?.stats,
	};
}
