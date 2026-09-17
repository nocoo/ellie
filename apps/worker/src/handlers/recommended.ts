// recommended.ts — "推荐主题" handlers
//
// Three endpoints driven by `forum_recommended_threads` (migration 0045):
//
//   GET    /api/v1/forums/:id/recommended-threads
//          Public list, capped at 6 newest threads (by `thread_id DESC`).
//          Cached in KV for 24h, keyed by forumId.
//
//   POST   /api/v1/moderation/threads/:id/recommend
//          Moderator action — INSERT OR IGNORE. Idempotent. No cap.
//
//   DELETE /api/v1/moderation/threads/:id/recommend
//          Moderator action — DELETE the (forum_id, thread_id) row.
//          Idempotent 200 (also when row already gone). Only 404s when
//          the thread itself is missing.
//
// # Display vs. data layer (reviewer pin msg ba15ea9f / a629d81c)
//
// The data layer is uncapped: a moderator can recommend an unlimited
// number of threads. The display layer caps at 6, ordered by
// `thread_id DESC`. POST never auto-evicts an older row — older rows
// just stop appearing in the top-6 window once 6+ newer recommendations
// exist. This avoids the torn "POST returned recommended:true but the
// row was immediately deleted" state of an in-write cap.
//
// # Visibility gate
//
// Public GET walks the same path as `/api/v1/forums/:id` for forum
// visibility (404 on missing/inactive/private-without-role). The JOIN
// onto `threads` adds `t.forum_id = r.forum_id AND ${THREAD_VISIBLE}`
// so a recommendation that points at a thread that was moved away from
// the forum or hidden (`sticky < 0`) is silently dropped.

import type { ForumVisibility } from "@ellie/types";
import { canModerate } from "@ellie/types";
import { currentCatalogThreads, getCatalogPage } from "../lib/cache/catalog-read";
import { bumpRecommendedGen, bumpThreadMetaGen } from "../lib/cache/invalidate";
import type { Env } from "../lib/env";
import { ANONYMOUS_AUTHOR_NAME } from "../lib/mappers";
import { parsePathSegment } from "../lib/parseId";
import {
	getForumForPermission,
	getThreadForPermission,
	getUserForPermission,
} from "../lib/permissionHelpers";
import { jsonResponse } from "../lib/response";
import { buildVisibilityContext, canViewForumVisibility, isForumActive } from "../lib/visibility";
import { moderationMiddleware, optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecommendedThreadRow {
	id: number;
	subject: string;
	authorId: number;
	authorName: string;
	replies: number;
	lastPostAt: number;
	recommendedAt: number;
}

export interface RecommendedThreadsResponse {
	forumId: number;
	threads: RecommendedThreadRow[];
}

/** Per-forum epoch also fences an old concurrent membership fill. */
export async function invalidateRecommendedCache(env: Env, forumId: number): Promise<void> {
	await bumpRecommendedGen(env, forumId);
}

// ---------------------------------------------------------------------------
// GET /api/v1/forums/:id/recommended-threads
// ---------------------------------------------------------------------------

export async function listRecommendedThreads(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const forumId = parsePathSegment(request, 1);
	if (forumId === null || forumId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	// Forum visibility gate: identical to `/api/v1/forums/:id`. Resolve
	// the auth bucket and the forum row in parallel so the cold-path
	// cost is one D1 batch.
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumRow = await env.DB.prepare("SELECT status, visibility FROM forums WHERE id = ?")
		.bind(forumId)
		.first<{ status: number; visibility: string }>();

	if (!forumRow || !isForumActive(forumRow)) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}
	if (!canViewForumVisibility(forumRow.visibility as ForumVisibility, visCtx)) {
		// Match the bare-forum read path: hide private-forum existence
		// by 404 rather than 403, so an unauthenticated probe can't
		// enumerate staff/admin forums.
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	const page = await getCatalogPage(env, ctx, {
		family: "recommended:threads",
		params: { forumId },
		scope: "internal",
	});
	// Cards retain the established public anonymous-author projection for every viewer.
	const rows = await currentCatalogThreads(
		env,
		ctx,
		page.items.map((item) => item.id),
		user,
		forumId,
	);
	const recommendedAt = new Map(page.items.map((item) => [item.id, item.recommendedAt ?? 0]));
	const threads: RecommendedThreadRow[] = rows.map((row) => ({
		id: row.id,
		subject: row.subject,
		authorId: row.anonymousAuthor ? 0 : row.authorId,
		authorName: row.anonymousAuthor ? ANONYMOUS_AUTHOR_NAME : row.authorName,
		replies: row.replies,
		lastPostAt: row.lastPostAt,
		recommendedAt: recommendedAt.get(row.id) ?? 0,
	}));
	return jsonResponse({ forumId, threads } satisfies RecommendedThreadsResponse, origin);
}

// ---------------------------------------------------------------------------
// POST /api/v1/moderation/threads/:id/recommend
// ---------------------------------------------------------------------------

export async function addRecommend(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const threadId = parsePathSegment(request, 1);
	if (threadId === null || threadId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	const thread = await getThreadForPermission(env, threadId);
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const [user, forum] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		getForumForPermission(env, thread.forumId),
	]);
	if (!user || !forum) {
		return errorResponse(
			"INTERNAL_ERROR",
			500,
			{ message: "Failed to fetch permission data" },
			origin,
		);
	}
	if (!canModerate(user, forum)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "No permission to moderate this forum" },
			origin,
		);
	}

	// INSERT OR IGNORE → idempotent. `recommended_at` and
	// `recommended_by` are only set on the first row; we accept the
	// drift on repeat clicks as "first writer wins" which is consistent
	// with the legacy semantics. The display ordering is `thread_id DESC`
	// so the timestamp does not affect visibility either way.
	const nowSec = Math.floor(Date.now() / 1000);
	await env.DB.prepare(
		`INSERT OR IGNORE INTO forum_recommended_threads
		 (forum_id, thread_id, recommended_at, recommended_by)
		 VALUES (?, ?, ?, ?)`,
	)
		.bind(thread.forumId, threadId, nowSec, authResult.user.userId)
		.run();

	// Invalidate ONLY thread meta gen — recommend/unrecommend flips the
	// `isRecommended` flag carried inside the thread-detail payload and
	// nothing else. Per D0 freeze (reviewer msg d9c01f23): the recommend
	// list endpoint is now cached in KV (recommended:threads:<forumId>),
	// so we invalidate that cache here. Forum summary / forum:meta:v2 /
	// page-1 thread-list payloads are untouched, so calling
	// `invalidateForumVolatileV2` here would pointlessly bump
	// forum_summary + thread:list caches that this action does not change.
	await Promise.all([
		bumpThreadMetaGen(env, threadId),
		invalidateRecommendedCache(env, thread.forumId),
	]);

	return jsonResponse({ forumId: thread.forumId, threadId, recommended: true }, origin);
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/moderation/threads/:id/recommend
// ---------------------------------------------------------------------------

export async function removeRecommend(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const threadId = parsePathSegment(request, 1);
	if (threadId === null || threadId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	const thread = await getThreadForPermission(env, threadId);
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const [user, forum] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		getForumForPermission(env, thread.forumId),
	]);
	if (!user || !forum) {
		return errorResponse(
			"INTERNAL_ERROR",
			500,
			{ message: "Failed to fetch permission data" },
			origin,
		);
	}
	if (!canModerate(user, forum)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "No permission to moderate this forum" },
			origin,
		);
	}

	// Idempotent 200: a DELETE on a row that no longer exists is still
	// a success. Per reviewer contract (msg a629d81c), this avoids the
	// 404 race that would otherwise surface when a moderator
	// double-clicks the "取消推荐" button.
	await env.DB.prepare("DELETE FROM forum_recommended_threads WHERE forum_id = ? AND thread_id = ?")
		.bind(thread.forumId, threadId)
		.run();

	// Same scope as the POST path: only `isRecommended` in the thread
	// payload flips. Invalidate KV cache for the recommended list.
	await Promise.all([
		bumpThreadMetaGen(env, threadId),
		invalidateRecommendedCache(env, thread.forumId),
	]);

	return jsonResponse({ forumId: thread.forumId, threadId, recommended: false }, origin);
}
