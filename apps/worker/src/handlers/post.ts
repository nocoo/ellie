// Post handlers for Cloudflare Worker

import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { canViewForumVisibility, decodeGenericCursor } from "@ellie/types";
import {
	bumpPostListGen,
	bumpThreadMetaGen,
	invalidateForumVolatileV2,
} from "../lib/cache/invalidate";
import { applyCensorFilter } from "../lib/censor";
import type { Env } from "../lib/env";
import { toPost } from "../lib/mappers";
import { buildNextCursor, clampLimit } from "../lib/pagination";
import { parseIdFromPath } from "../lib/parseId";
import { checkPostingPermission } from "../lib/postingPermission";
import { jsonResponse } from "../lib/response";
import { withVerifiedEmail } from "../lib/routeHelpers";
import { incrementStatsOnPostCreate } from "../lib/stats-counter";
import {
	buildVisibilityContext,
	canReadThreadContent,
	canViewModeratedThread,
	isForumActive,
	POST_VISIBLE,
	STICKY_MODERATED,
} from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";
import {
	EMPTY_RATING_AGGREGATE,
	loadAggregateForPost,
	loadAggregatesForPosts,
} from "./post-rating";

/** Post cursor payload for keyset pagination */
interface PostCursorPayload {
	position: number;
}

/** Validate post cursor payload shape */
function isPostCursor(p: Partial<PostCursorPayload>): boolean {
	return typeof p.position === "number";
}

/** GET /api/v1/posts - List posts with position-based pagination */
export async function list(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const threadId = url.searchParams.get("threadId");
	const cursorStr = url.searchParams.get("cursor");

	if (!threadId) {
		return errorResponse("INVALID_REQUEST", 400, { message: "threadId is required" }, origin);
	}

	const threadIdNum = Number.parseInt(threadId, 10);
	if (Number.isNaN(threadIdNum)) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid threadId" }, origin);
	}

	// Kick off the (verified) auth lookup eagerly. We don't need the result
	// until the visibility check, so it can run in parallel with the
	// thread→forum JOIN query — saves one D1 round-trip on the hot path when
	// the caller is authenticated.
	const userPromise = optionalAuthVerified(request, env);

	// Single JOIN query: thread → forum (replaces 2 serial queries)
	const row = await env.DB.prepare(
		`SELECT t.forum_id, t.sticky, t.author_id, f.status, f.visibility, f.moderator_ids
		 FROM threads t
		 JOIN forums f ON f.id = t.forum_id
		 WHERE t.id = ?`,
	)
		.bind(threadIdNum)
		.first<{
			forum_id: number;
			sticky: number;
			author_id: number;
			status: number;
			visibility: string;
			moderator_ids: string;
		}>();

	const user = await userPromise;
	const visCtx = buildVisibilityContext(user);

	if (!row || (row.sticky < 0 && row.sticky !== STICKY_MODERATED)) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	if (!isForumActive(row)) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	if (row.sticky === STICKY_MODERATED) {
		if (
			!canViewModeratedThread({
				authorId: row.author_id,
				forumModeratorIds: row.moderator_ids ?? "",
				user,
			})
		) {
			return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
		}
	} else if (
		!canReadThreadContent({
			sticky: row.sticky,
			forumVisibility: row.visibility as ForumVisibility,
			visCtx,
		})
	) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this content" },
			origin,
		);
	}

	// Clamp limit to [1, 100], defaulting to 100
	const clampedLimit = clampLimit(url.searchParams.get("limit"), {
		defaultLimit: 100,
		maxLimit: 100,
	});

	const cursor = cursorStr ? decodeGenericCursor<PostCursorPayload>(cursorStr, isPostCursor) : null;
	const lastPage = url.searchParams.get("last") === "1";

	let result: D1Result;
	if (lastPage) {
		const stmt = env.DB.prepare(
			`SELECT * FROM posts WHERE thread_id = ? AND ${POST_VISIBLE} ORDER BY position DESC LIMIT ?`,
		);
		result = await stmt.bind(threadIdNum, clampedLimit).all();
		result.results.reverse();
	} else if (cursor) {
		// Position-based pagination: WHERE thread_id = ? AND position > ? ORDER BY position
		// Only return visible posts (invisible = 0)
		const stmt = env.DB.prepare(
			`SELECT * FROM posts WHERE thread_id = ? AND ${POST_VISIBLE} AND position > ? ORDER BY position LIMIT ?`,
		);
		result = await stmt.bind(threadIdNum, cursor.position, clampedLimit).all();
	} else {
		// First page - only return visible posts (invisible = 0)
		const stmt = env.DB.prepare(
			`SELECT * FROM posts WHERE thread_id = ? AND ${POST_VISIBLE} ORDER BY position LIMIT ?`,
		);
		result = await stmt.bind(threadIdNum, clampedLimit).all();
	}

	// Map D1 snake_case rows to camelCase Post type. Per-post rating aggregate
	// is fetched in a single GROUP BY (docs/22 §6.3) so we avoid N+1.
	const postIds = result.results.map((row) => (row as { id: number }).id);
	const aggregates = await loadAggregatesForPosts(env, postIds);
	const viewer = user ? { userId: user.userId, role: user.role } : null;
	const posts = result.results.map((row) => {
		const r = row as Record<string, unknown>;
		const agg = aggregates.get(r.id as number) ?? EMPTY_RATING_AGGREGATE;
		return toPost(r, agg, viewer);
	});

	// Generate next cursor from raw D1 row (position is same in both)
	const nextCursor = lastPage
		? null
		: buildNextCursor<(typeof posts)[number], PostCursorPayload>(posts, clampedLimit, (last) => ({
				position: last.position,
			}));

	return jsonResponse(posts, origin, { nextCursor });
}

/** GET /api/v1/posts/:id - Get post by ID */
export async function getById(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request) ?? Number.NaN;

	// Auth is independent of the post/thread chain — fire it eagerly so it
	// overlaps with the post and visibility queries.
	const userPromise = optionalAuthVerified(request, env);

	// Only return visible posts (invisible = 0)
	const stmt = env.DB.prepare(`SELECT * FROM posts WHERE id = ? AND ${POST_VISIBLE}`);
	const result = await stmt.bind(id).first();

	if (!result) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	const postRow = result as Record<string, unknown>;
	const threadId = postRow.thread_id as number;

	// Visibility check JOIN runs in parallel with auth resolution.
	const [user, visRow] = await Promise.all([
		userPromise,
		env.DB.prepare(
			`SELECT t.forum_id, t.sticky, t.author_id, f.status, f.visibility, f.moderator_ids
			 FROM threads t
			 JOIN forums f ON f.id = t.forum_id
			 WHERE t.id = ?`,
		)
			.bind(threadId)
			.first<{
				forum_id: number;
				sticky: number;
				author_id: number;
				status: number;
				visibility: string;
				moderator_ids: string;
			}>(),
	]);
	const visCtx = buildVisibilityContext(user);

	if (!visRow || (visRow.sticky < 0 && visRow.sticky !== STICKY_MODERATED)) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	if (visRow.sticky === STICKY_MODERATED) {
		if (
			!canViewModeratedThread({
				authorId: visRow.author_id,
				forumModeratorIds: visRow.moderator_ids ?? "",
				user,
			})
		) {
			return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
		}
	}

	if (!isForumActive(visRow)) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	if (visRow.sticky !== STICKY_MODERATED) {
		if (
			!canReadThreadContent({
				sticky: visRow.sticky,
				forumVisibility: visRow.visibility as ForumVisibility,
				visCtx,
			})
		) {
			return errorResponse(
				"FORBIDDEN",
				403,
				{ message: "You don't have access to this content" },
				origin,
			);
		}
	}

	const aggregate = await loadAggregateForPost(env, id);
	const viewer = user ? { userId: user.userId, role: user.role } : null;
	return jsonResponse(toPost(postRow, aggregate, viewer), origin);
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

	const postId = postResult.meta.last_row_id;

	// Run the counters batch and the createdPost fetch concurrently — the
	// posts row was already committed by the prior INSERT, so the SELECT
	// doesn't depend on the batch.
	const [, createdPost] = await Promise.all([
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

	// Cache invalidation (docs/19 §6 row "POST /api/v1/posts"):
	// - Bump `forum:summary:gen` + `thread:list:gen:<forumId>` so the forum
	//   summary reflects the new reply and threads list re-orders.
	// - Bump thread:meta / post:list gens for completeness; consumers land in
	//   Phase 3/4.
	await Promise.all([
		invalidateForumVolatileV2(env, thread.forum_id),
		bumpThreadMetaGen(env, threadId),
		bumpPostListGen(env, threadId),
		// Increment pre-computed stats counters (fire-and-forget on error)
		incrementStatsOnPostCreate(env).catch((e) =>
			console.warn("[post:create] stats counter increment failed", e),
		),
	]);

	return jsonResponse(
		toPost(createdPost as Record<string, unknown>, EMPTY_RATING_AGGREGATE, {
			userId: user.userId,
			role: user.role,
		}),
		origin,
		undefined,
		201,
	);
});
