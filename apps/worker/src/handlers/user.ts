import {
	decodeGenericCursor,
	type ForumVisibility,
	type Thread,
	type UserPostHistoryItem,
} from "@ellie/types";
import { computeViewerBucket } from "../lib/cache/bucket";
import {
	getPostRowsBatch,
	getThreadRows,
	loadThreadAccessBatch,
	type PostAccess,
	projectCurrentThread,
	type ThreadAccess,
	threadAccessStatus,
} from "../lib/cache/thread-loaders";
import {
	getAvatarPathCached,
	getPublicUsers,
	getUserHistory,
	getUserSearchCached,
	type HistoryMember,
	isHistoryCursor,
	type UserHistoryCursor,
	type UserHistoryFamily,
	userHistoryScope,
} from "../lib/cache/user-read";
import type { Env } from "../lib/env";
import {
	enrichThreadsWithUserCache,
	shouldUnmaskAnonymous,
	toThread,
	toUserPostHistoryItem,
	type ViewerContext,
} from "../lib/mappers";
import { clampLimit } from "../lib/pagination";
import { parseIdFromPath, parsePathSegment } from "../lib/parseId";
import { jsonResponse } from "../lib/response";
import { getUserProfiles } from "../lib/user-cache";
import { buildVisibilityContext, canViewForumVisibility } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

export function anonymousHistoryFilter(
	column: string,
	profileUserId: number,
	viewer: ViewerContext | null,
): string {
	return shouldUnmaskAnonymous(profileUserId, viewer) ? "1=1" : `${column} = 0`;
}
async function publicUserIds(env: Env, ids: number[]): Promise<Set<number>> {
	if (!ids.length) return new Set();
	const result = await env.DB.prepare(
		`SELECT id, status FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
	)
		.bind(...ids)
		.all<{ id: number; status: number }>();
	if (!result.success) throw new Error("Current user visibility could not be loaded");
	return new Set(result.results.filter((row) => row.status >= 0).map((row) => row.id));
}
export async function batchGet(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const raw = new URL(request.url).searchParams.get("ids");
	if (!raw)
		return errorResponse("INVALID_REQUEST", 400, { message: "ids parameter is required" }, origin);
	const ids = [
		...new Set(
			raw
				.split(",")
				.map((value) => Number.parseInt(value.trim(), 10))
				.filter((id) => Number.isSafeInteger(id) && id > 0),
		),
	];
	if (ids.length > 100)
		return errorResponse("INVALID_REQUEST", 400, { message: "Too many IDs (max 100)" }, origin);
	if (!ids.length) return jsonResponse([], origin);
	const [viewer, allowed] = await Promise.all([
		optionalAuthVerified(request, env),
		publicUserIds(env, ids),
	]);
	const users = await getPublicUsers(
		env,
		ctx,
		ids.filter((id) => allowed.has(id)),
		computeViewerBucket(buildVisibilityContext(viewer)),
	);
	return jsonResponse(
		ids.flatMap((id) => {
			const value = users.get(id);
			return value ? [value] : [];
		}),
		origin,
	);
}
export async function getById(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (!id || id < 1) return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	const [viewer, allowed] = await Promise.all([
		optionalAuthVerified(request, env),
		publicUserIds(env, [id]),
	]);
	if (!allowed.has(id)) return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	const user = (
		await getPublicUsers(env, ctx, [id], computeViewerBucket(buildVisibilityContext(viewer)))
	).get(id);
	return user
		? jsonResponse(user, origin)
		: errorResponse("USER_NOT_FOUND", 404, undefined, origin);
}
export async function getAvatarPath(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1);
	if (!id || id < 1)
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid userId" }, origin);
	const value = await getAvatarPathCached(env, ctx, id);
	return value
		? jsonResponse(value, origin)
		: errorResponse("USER_NOT_FOUND", 404, undefined, origin);
}
function canListThread(
	access: ThreadAccess | undefined,
	viewer: ViewerContext | null,
): access is ThreadAccess {
	return (
		!!access &&
		access.sticky >= 0 &&
		threadAccessStatus(access, viewer) === null &&
		canViewForumVisibility(access.visibility as ForumVisibility, buildVisibilityContext(viewer))
	);
}
async function composeThreads(
	env: Env,
	ctx: ExecutionContext | undefined,
	members: HistoryMember[],
	userId: number,
	viewer: ViewerContext | null,
	digest: boolean,
): Promise<Thread[]> {
	const access = await loadThreadAccessBatch(
		env,
		members.map((row) => row.id),
	);
	const ids = members
		.map((row) => row.id)
		.filter((id) => {
			const row = access.get(id);
			return (
				canListThread(row, viewer) &&
				row.author_id === userId &&
				(row.anonymous_author === 0 || shouldUnmaskAnonymous(userId, viewer))
			);
		});
	const entities = await getThreadRows(env, ctx, ids);
	const rows = ids.flatMap((id) => {
		const row = entities.get(id);
		const accessRow = access.get(id);
		return row && accessRow && (!digest || Number(row.digest) > 0)
			? [toThread(projectCurrentThread(row, accessRow), viewer)]
			: [];
	});
	const authors = [
		...new Set(rows.flatMap((row) => [row.authorId, row.lastPosterId]).filter((id) => id > 0)),
	];
	return enrichThreadsWithUserCache(rows, await getUserProfiles(env, ctx, authors));
}
async function composePosts(
	env: Env,
	ctx: ExecutionContext | undefined,
	members: HistoryMember[],
	userId: number,
	viewer: ViewerContext | null,
): Promise<UserPostHistoryItem[]> {
	const validMembers = members.filter(
		(row): row is HistoryMember & { threadId: number } =>
			typeof row.threadId === "number" && row.threadId > 0,
	);
	if (!validMembers.length) return [];
	const threadIds = [...new Set(validMembers.map((row) => row.threadId))];
	const [threadAccess, postResult] = await Promise.all([
		loadThreadAccessBatch(env, threadIds),
		env.DB.prepare(
			`SELECT id, thread_id, author_id, invisible, anonymous, is_first FROM posts WHERE id IN (${validMembers.map(() => "?").join(",")})`,
		)
			.bind(...validMembers.map((row) => row.id))
			.all<PostAccess>(),
	]);
	if (!postResult.success) throw new Error("Current post visibility could not be loaded");
	const postAccess = new Map(postResult.results.map((row) => [row.id, row]));
	const allowed = validMembers.filter((member) => {
		const row = postAccess.get(member.id);
		return (
			canListThread(threadAccess.get(member.threadId), viewer) &&
			row?.invisible === 0 &&
			row.is_first === 0 &&
			row.thread_id === member.threadId &&
			row.author_id === userId &&
			(row.anonymous === 0 || shouldUnmaskAnonymous(userId, viewer))
		);
	});
	const [threads, posts] = await Promise.all([
		getThreadRows(env, ctx, [...new Set(allowed.map((row) => row.threadId))]),
		getPostRowsBatch(
			env,
			ctx,
			allowed.map((row) => ({ postId: row.id, threadId: row.threadId })),
		),
	]);
	const items: UserPostHistoryItem[] = [];
	for (const member of allowed) {
		const rawThread = threads.get(member.threadId);
		const rawPost = posts.get(member.id);
		const accessRow = threadAccess.get(member.threadId);
		if (!rawThread || !rawPost || !accessRow) continue;
		const thread = projectCurrentThread(rawThread, accessRow);
		const post = { ...rawPost, ...postAccess.get(member.id) };
		items.push(
			toUserPostHistoryItem(
				{
					...post,
					thread_id_for_link: thread.id,
					thread_forum_id: thread.forum_id,
					thread_subject: thread.subject,
					thread_replies: thread.replies,
					thread_views: thread.views,
					thread_created_at: thread.created_at,
					thread_last_post_at: thread.last_post_at,
					thread_closed: thread.closed,
					thread_sticky: thread.sticky,
					thread_digest: thread.digest,
					thread_special: thread.special,
					thread_highlight: thread.highlight,
					thread_type_name: thread.type_name,
				},
				viewer,
			),
		);
	}
	const users = await getUserProfiles(env, ctx, [
		...new Set(items.map((item) => item.post.authorId).filter((id) => id > 0)),
	]);
	for (const item of items) {
		const author = users.get(item.post.authorId);
		if (author) item.post.authorName = author.username;
	}
	return items;
}
async function history(
	request: Request,
	env: Env,
	ctx: ExecutionContext | undefined,
	family: UserHistoryFamily,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const userId = parsePathSegment(request, 1);
	if (!userId || userId <= 0)
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid userId" }, origin);
	const query = new URL(request.url).searchParams;
	const viewer = await optionalAuthVerified(request, env);
	const limit = clampLimit(query.get("limit"), { defaultLimit: 20, maxLimit: 50 }) || 20;
	const raw = query.get("cursor");
	const cursor = raw ? decodeGenericCursor<UserHistoryCursor>(raw, isHistoryCursor) : null;
	const page = await getUserHistory(env, ctx, {
		family,
		params: { userId, limit, cursorTime: cursor?.createdAt ?? null, cursorId: cursor?.id ?? null },
		scope: userHistoryScope(viewer, userId),
	});
	const rows =
		family === "user:posts"
			? await composePosts(env, ctx, page.items, userId, viewer)
			: await composeThreads(env, ctx, page.items, userId, viewer, family === "user:digest");
	return jsonResponse(rows, origin, { nextCursor: page.nextCursor });
}
export function listThreads(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	return history(request, env, ctx, "user:threads");
}
export function listPosts(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	return history(request, env, ctx, "user:posts");
}
export function listDigest(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	return history(request, env, ctx, "user:digest");
}
export async function search(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const query = new URL(request.url).searchParams;
	const q = query.get("q")?.trim();
	if (!q || q.length < 2)
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "Search query must be at least 2 characters" },
			origin,
		);
	const limit = clampLimit(query.get("limit"), { defaultLimit: 10, maxLimit: 20 }) || 10;
	const results = await getUserSearchCached(env, ctx, q, limit);
	const allowed = await publicUserIds(
		env,
		results.map((row) => row.id),
	);
	return jsonResponse(
		results.filter((row) => allowed.has(row.id)),
		origin,
	);
}
