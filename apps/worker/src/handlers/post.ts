// Post handlers for Cloudflare Worker

import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { canViewForumVisibility, decodeGenericCursor, EMPTY_RATING_AGGREGATE } from "@ellie/types";
import {
	getPostPage,
	getPostRows,
	getRatingAggregates,
	loadPostAccess,
	loadPostAccessBatch,
	loadPostPage,
	loadThreadAccess,
	threadAccessStatus,
	validReadingId,
} from "../lib/cache/thread-loaders";
import { applyCensorFilter } from "../lib/censor";
import type { Env } from "../lib/env";
import { toPost } from "../lib/mappers";
import { buildNextCursor, clampLimit } from "../lib/pagination";
import { parseIdFromPath } from "../lib/parseId";
import { checkPostingPermission } from "../lib/postingPermission";
import { jsonResponse } from "../lib/response";
import { withVerifiedEmail } from "../lib/routeHelpers";
import { incrementStatsOnPostCreate } from "../lib/stats-counter";
import { getUserProfiles } from "../lib/user-cache";
import { isForumActive } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

/** Post cursor payload for keyset pagination */
interface PostCursorPayload {
	position: number;
}

/** Validate post cursor payload shape */
function isPostCursor(p: Partial<PostCursorPayload>): boolean {
	return Number.isSafeInteger(p.position) && (p.position as number) >= 0;
}

/** GET /api/v1/posts - Position pages and last-page membership are SHORT. */
export async function list(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const threadIdParam = url.searchParams.get("threadId");
	if (!threadIdParam)
		return errorResponse("INVALID_REQUEST", 400, { message: "threadId is required" }, origin);
	const threadId = Number.parseInt(threadIdParam, 10);
	if (!validReadingId(threadId))
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid threadId" }, origin);
	const limit = clampLimit(url.searchParams.get("limit"), { defaultLimit: 100, maxLimit: 100 });
	if (!Number.isSafeInteger(limit))
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid limit" }, origin);
	const [user, access] = await Promise.all([
		optionalAuthVerified(request, env),
		loadThreadAccess(env, threadId),
	]);
	const status = threadAccessStatus(access, user);
	if (status === 404 || !access) return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	if (status === 403)
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this content" },
			origin,
		);
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr ? decodeGenericCursor<PostCursorPayload>(cursorStr, isPostCursor) : null;
	const last = url.searchParams.get("last") === "1";
	const query = { threadId, limit, cursorPosition: last ? null : (cursor?.position ?? null), last };
	let membership = await getPostPage(env, ctx, query);
	let current = await loadPostAccessBatch(
		env,
		membership.map((item) => item.id),
		threadId,
	);
	if (membership.some((item) => !current.has(item.id))) {
		membership = await loadPostPage(env, query);
		current = await loadPostAccessBatch(
			env,
			membership.map((item) => item.id),
			threadId,
		);
	}
	const ids = membership.filter((item) => current.has(item.id)).map((item) => item.id);
	const [rows, ratings] = await Promise.all([
		getPostRows(env, ctx, ids, threadId),
		getRatingAggregates(env, ctx, ids),
	]);
	let posts = ids.flatMap((id) => {
		const row = rows.get(id);
		const gate = current.get(id);
		return row && gate
			? [
					toPost(
						{ ...row, ...gate, forum_id: access.forum_id },
						ratings.get(id) ?? EMPTY_RATING_AGGREGATE,
						user,
					),
				]
			: [];
	});
	const profiles = await getUserProfiles(
		env,
		ctx,
		posts.map((post) => post.authorId).filter(validReadingId),
	);
	posts = posts.map((post) => ({
		...post,
		authorName: profiles.get(post.authorId)?.username ?? post.authorName,
	}));
	const nextCursor = last
		? null
		: buildNextCursor(membership, limit, (item) => ({ position: item.position }));
	return jsonResponse(posts, origin, { nextCursor });
}

/** GET /api/v1/posts/:id - Current access checks precede cached body exposure. */
export async function getById(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (!validReadingId(id)) return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	const [user, current] = await Promise.all([
		optionalAuthVerified(request, env),
		loadPostAccess(env, id),
	]);
	if (current?.invisible !== 0) return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	const access = await loadThreadAccess(env, current.thread_id);
	const status = threadAccessStatus(access, user);
	if (status === 404 || !access) return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	if (status === 403)
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this content" },
			origin,
		);
	const [rows, ratings] = await Promise.all([
		getPostRows(env, ctx, [id], current.thread_id),
		getRatingAggregates(env, ctx, [id]),
	]);
	const row = rows.get(id);
	if (!row) return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	const post = toPost(
		{ ...row, ...current, forum_id: access.forum_id },
		ratings.get(id) ?? EMPTY_RATING_AGGREGATE,
		user,
	);
	const profiles = await getUserProfiles(env, ctx, post.authorId > 0 ? [post.authorId] : []);
	post.authorName = profiles.get(post.authorId)?.username ?? post.authorName;
	return jsonResponse(post, origin);
}

/** POST /api/v1/posts - Reply to a thread (requires auth) */
export const create = withVerifiedEmail(async (request, env, user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	// Check posting permission (banned, muted, registration days, avatar, content switch)
	const permissionResult = await checkPostingPermission(env, user, origin, "reply");
	if (!permissionResult.allowed) {
		return permissionResult.error;
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, undefined, origin);
	}

	const threadId = typeof body.threadId === "number" ? body.threadId : undefined;
	let content = typeof body.content === "string" ? body.content : undefined;

	if (typeof threadId !== "number" || Number.isNaN(threadId)) {
		return errorResponse("INVALID_BODY", 400, { message: "threadId is required (number)" }, origin);
	}
	if (!content || content.trim().length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "content is required" }, origin);
	}

	// Censor word check
	const censorResult = await applyCensorFilter(content.trim(), env);
	if (censorResult.banned) {
		return errorResponse("CONTENT_BANNED", 403, undefined, origin);
	}
	content = censorResult.content;

	// Run the three independent reads (visibility JOIN, next-position lookup,
	// author name) in parallel — saves 2 D1 round-trips on the post.create
	// hot path.
	const [thread, posResult, authorRow] = await Promise.all([
		env.DB.prepare(
			`SELECT t.id, t.forum_id, t.closed, t.sticky, f.status, f.visibility
			 FROM threads t
			 JOIN forums f ON f.id = t.forum_id
			 WHERE t.id = ?`,
		)
			.bind(threadId)
			.first<{
				id: number;
				forum_id: number;
				closed: number;
				sticky: number;
				status: number;
				visibility: string;
			}>(),
		env.DB.prepare("SELECT MAX(position) as maxPos FROM posts WHERE thread_id = ?")
			.bind(threadId)
			.first<{ maxPos: number | null }>(),
		env.DB.prepare("SELECT username FROM users WHERE id = ?")
			.bind(user.userId)
			.first<{ username: string }>(),
	]);

	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}
	if (thread.sticky < 0) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}
	if (thread.closed === 1) {
		return errorResponse("THREAD_CLOSED", 403, undefined, origin);
	}

	// Check forum visibility - user must have access to post in this forum
	if (!isForumActive(thread)) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const visCtx: VisibilityContext = {
		isLoggedIn: true,
		role: user.role,
	};
	if (!canViewForumVisibility(thread.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to reply in this thread" },
			origin,
		);
	}

	const nextPosition = (posResult?.maxPos ?? 0) + 1;
	const authorName = authorRow?.username ?? `user_${user.userId}`;

	const now = Math.floor(Date.now() / 1000);

	// Insert post
	const postResult = await env.DB.prepare(
		"INSERT INTO posts (thread_id, forum_id, author_id, author_name, content, created_at, is_first, position) VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
	)
		.bind(threadId, thread.forum_id, user.userId, authorName, content, now, nextPosition)
		.run();

	if (!postResult.success) throw new Error("Post creation was not confirmed");
	const postId = postResult.meta.last_row_id;

	// Run the counters batch and the createdPost fetch concurrently — the
	// posts row was already committed by the prior INSERT, so the SELECT
	// doesn't depend on the batch.
	const [written, createdPost] = await Promise.all([
		env.DB.batch([
			env.DB.prepare(
				"UPDATE threads SET replies = replies + 1, last_post_at = ?, last_poster = ?, last_poster_id = ?, anonymous_last_poster = 0 WHERE id = ?",
			).bind(now, authorName, user.userId, threadId),
			env.DB.prepare(
				"UPDATE forums SET posts = posts + 1, last_post_at = ?, last_poster = ?, last_poster_id = ? WHERE id = ?",
			).bind(now, authorName, user.userId, thread.forum_id),
			env.DB.prepare("UPDATE users SET posts = posts + 1 WHERE id = ?").bind(user.userId),
		]),
		env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(postId).first(),
	]);
	if (written.length !== 3 || written.some((result) => !result.success))
		throw new Error("Post counters were not confirmed");

	// Replies do not clear the current 60-second page/list/stat snapshots.
	// The response below is the committed post for the writer's own view.
	await incrementStatsOnPostCreate(env, thread.forum_id).catch((error) =>
		console.warn("[post:create] stats counter increment failed", error),
	);

	return jsonResponse(
		toPost(createdPost as Record<string, unknown>, EMPTY_RATING_AGGREGATE, {
			userId: user.userId,
			role: user.role,
		}),
		origin,
		{ threadSticky: thread.sticky },
		201,
	);
});
