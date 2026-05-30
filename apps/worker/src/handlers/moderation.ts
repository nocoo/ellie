// Moderation handlers — Key A + JWT + role ∈ {Admin, SuperMod, Mod}
// Endpoints: PATCH sticky, PATCH digest, PATCH close, PATCH move, PATCH highlight,
//            DELETE post, DELETE thread, PATCH post (edit)
// These are forum-frontend operations used by moderators, NOT admin console operations.
//
// Permission enforcement uses @ellie/types functions:
// - canModerate: for thread management (sticky, digest, close, highlight)
// - canMoveThread: for moving threads (Admin/SuperMod only)
// - canDeleteThread: for deleting threads (Author or Admin/SuperMod)
// - canDeletePost: for deleting posts (Author or Admin/SuperMod)
// - canEditPost: for editing posts (Author or Mod in scope)

import {
	canAccessAdmin,
	canDeletePost,
	canDeleteThread,
	canEditPost,
	canModerate,
	canMoveThread,
} from "@ellie/types";
import {
	bumpDigestGen,
	bumpForumSummaryGen,
	bumpThreadListGen,
	bumpThreadListGenAll,
	bumpThreadMetaGen,
	invalidateForumVolatileV2,
	invalidateThreadListForForums,
} from "../lib/cache/invalidate";
import {
	batchChunked,
	buildDeletePostChildStatements,
	buildDeleteThreadChildStatements,
} from "../lib/contentDelete";
import type { Env } from "../lib/env";
import { parseIdFromPath, parsePathSegment } from "../lib/parseId";
import {
	getForumForPermission,
	getPostForPermission,
	getThreadForPermission,
	getUserForPermission,
} from "../lib/permissionHelpers";
import { recalcForumMetadata, recalcThreadMetadata } from "../lib/recalcMetadata";
import { jsonResponse } from "../lib/response";
import {
	batchDecrementUserPosts,
	decrementUserPosts,
	decrementUserThreads,
} from "../lib/userCounters";
import { STICKY_FORUM, STICKY_GLOBAL, STICKY_NONE } from "../lib/visibility";
import { moderationMiddleware } from "../middleware/auth";
import { errorResponse } from "../middleware/error";
import { invalidateRecommendedCache } from "./recommended";

// ─── Helpers ──────────────────────────────────────────────────────

/** Extract thread ID from /api/v1/moderation/threads/:id/<action> */
function parseThreadIdFromModPath(request: Request): number | null {
	return parsePathSegment(request, 1);
}

const STICKY_MAP: Record<string, number> = {
	none: STICKY_NONE,
	forum: STICKY_FORUM,
	global: STICKY_GLOBAL,
};

// ─── PATCH /api/v1/moderation/threads/:id/sticky ─────────────────

export async function setSticky(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const threadId = parseThreadIdFromModPath(request);
	if (threadId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const { level } = body;
	if (typeof level !== "string" || !(level in STICKY_MAP)) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: 'level must be "none", "forum", or "global"' },
			origin,
		);
	}

	// Fetch thread to get forum_id
	const thread = await getThreadForPermission(env, threadId);
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	// Permission check: canModerate requires forum scope for Mods
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

	const stickyValue = STICKY_MAP[level];

	// Read the current sticky so we can tell whether this write affects the
	// site-wide global slot. Transitions in either direction (promote TO
	// global OR demote FROM global) must invalidate every forum's page1
	// cache, because a global pin appears at the top of every forum's
	// thread list.
	const prevRow = await env.DB.prepare("SELECT sticky FROM threads WHERE id = ?")
		.bind(threadId)
		.first<{ sticky: number }>();
	const prevSticky = prevRow?.sticky ?? STICKY_NONE;

	// Singleton enforcement: at most ONE thread can be sticky=global
	// site-wide. When promoting to global, demote any existing global
	// stickies down to forum-pinned (preserving the moderator intent that
	// the thread should remain visible at the top of its own forum).
	// We collect every forum_id touched by the demotion so we can fan-out
	// thread-list cache invalidation precisely.
	let demotedForumIds: number[] = [];
	if (stickyValue === STICKY_GLOBAL) {
		const existing = await env.DB.prepare(
			`SELECT id, forum_id FROM threads WHERE sticky = ${STICKY_GLOBAL} AND id != ?`,
		)
			.bind(threadId)
			.all<{ id: number; forum_id: number }>();
		const rows = existing.results ?? [];
		if (rows.length > 0) {
			demotedForumIds = rows.map((r) => r.forum_id);
			await env.DB.prepare(
				`UPDATE threads SET sticky = ${STICKY_FORUM} WHERE sticky = ${STICKY_GLOBAL} AND id != ?`,
			)
				.bind(threadId)
				.run();
		}
	}

	await env.DB.prepare("UPDATE threads SET sticky = ? WHERE id = ?")
		.bind(stickyValue, threadId)
		.run();

	// Invalidation matrix:
	//   - global transition (TO or FROM sticky=2):
	//       bump per-forum gen for the target thread's forum, every forum
	//       where an old global was demoted, AND the all-forum gen so
	//       every forum's page1 cache drops the now-stale global pin.
	//   - non-global update (forum/none ↔ forum/none):
	//       only bump per-forum gen. We must NOT bump all-gen here, or a
	//       routine per-forum sticky toggle would invalidate every other
	//       forum's page1 cache.
	const isGlobalTransition = stickyValue === STICKY_GLOBAL || prevSticky === STICKY_GLOBAL;
	if (isGlobalTransition) {
		const forumIds = new Set<number>([thread.forumId, ...demotedForumIds]);
		await Promise.all([
			invalidateThreadListForForums(env, Array.from(forumIds)),
			bumpThreadListGenAll(env),
		]);
	} else {
		await bumpThreadListGen(env, thread.forumId);
	}

	return jsonResponse({ id: threadId, sticky: stickyValue }, origin);
}

// ─── PATCH /api/v1/moderation/threads/:id/digest ─────────────────

export async function setDigest(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const threadId = parseThreadIdFromModPath(request);
	if (threadId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const { level } = body;
	if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 3) {
		return errorResponse("INVALID_BODY", 400, { message: "level must be 0, 1, 2, or 3" }, origin);
	}

	// Fetch thread to get forum_id
	const thread = await getThreadForPermission(env, threadId);
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	// Permission check: canModerate requires forum scope for Mods
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

	await env.DB.prepare("UPDATE threads SET digest = ? WHERE id = ?").bind(level, threadId).run();

	// Digest changes affect digest filter visibility AND thread row payload
	// in the page1 list → bump both.
	await Promise.all([bumpThreadListGen(env, thread.forumId), bumpDigestGen(env)]);

	return jsonResponse({ id: threadId, digest: level }, origin);
}

// ─── PATCH /api/v1/moderation/threads/:id/close ──────────────────

export async function setClose(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const threadId = parseThreadIdFromModPath(request);
	if (threadId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const { closed } = body;
	if (typeof closed !== "boolean") {
		return errorResponse("INVALID_BODY", 400, { message: "closed must be a boolean" }, origin);
	}

	// Fetch thread to get forum_id
	const thread = await getThreadForPermission(env, threadId);
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	// Permission check: canModerate requires forum scope for Mods
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

	const closedValue = closed ? 1 : 0;
	await env.DB.prepare("UPDATE threads SET closed = ? WHERE id = ?")
		.bind(closedValue, threadId)
		.run();

	// `closed` is part of the cached Thread row → bump per-forum gen.
	await bumpThreadListGen(env, thread.forumId);

	return jsonResponse({ id: threadId, closed: closedValue }, origin);
}

// ─── PATCH /api/v1/moderation/threads/:id/move ───────────────────

export async function moveThread(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const id = parseThreadIdFromModPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const { targetForumId } = body;
	if (typeof targetForumId !== "number" || !Number.isInteger(targetForumId) || targetForumId <= 0) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "targetForumId must be a positive integer" },
			origin,
		);
	}

	// Permission check: canMoveThread requires Admin/SuperMod (Mods cannot move threads)
	const user = await getUserForPermission(env, authResult.user.userId);
	if (!user) {
		return errorResponse("INTERNAL_ERROR", 500, { message: "Failed to fetch user data" }, origin);
	}

	if (!canMoveThread(user)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Only Admin or SuperMod can move threads" },
			origin,
		);
	}

	const thread = await env.DB.prepare("SELECT id, forum_id, replies FROM threads WHERE id = ?")
		.bind(id)
		.first<{ id: number; forum_id: number; replies: number }>();
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	if (thread.forum_id === targetForumId) {
		return jsonResponse({ id, forumId: targetForumId, moved: false }, origin);
	}

	// Validate target forum exists
	const targetForum = await env.DB.prepare("SELECT id FROM forums WHERE id = ?")
		.bind(targetForumId)
		.first();
	if (!targetForum) {
		return errorResponse("INVALID_BODY", 400, { message: "Target forum not found" }, origin);
	}

	const oldForumId = thread.forum_id;
	const postCount = thread.replies + 1;

	// Move thread + posts, adjust forum counts.
	//
	// Also drop any `forum_recommended_threads` row keyed to this
	// thread: a recommendation is per-forum and the thread is leaving
	// the source forum. Without this the GET list query would silently
	// drop the row (its `t.forum_id = r.forum_id` join wins), but the
	// orphaned row would still occupy the composite PK slot and prevent
	// a moderator from re-recommending the thread in the new forum
	// without an explicit DELETE. Use thread_id (not the composite key)
	// so a stray row in another forum from a prior bug would also be
	// cleaned up — recommendation is conceptually a single-forum binding.
	await env.DB.batch([
		env.DB.prepare("UPDATE threads SET forum_id = ? WHERE id = ?").bind(targetForumId, id),
		env.DB.prepare("UPDATE posts SET forum_id = ? WHERE thread_id = ?").bind(targetForumId, id),
		env.DB.prepare("UPDATE forums SET threads = threads - 1, posts = posts - ? WHERE id = ?").bind(
			postCount,
			oldForumId,
		),
		env.DB.prepare("UPDATE forums SET threads = threads + 1, posts = posts + ? WHERE id = ?").bind(
			postCount,
			targetForumId,
		),
		env.DB.prepare("DELETE FROM forum_recommended_threads WHERE thread_id = ?").bind(id),
	]);

	// Recalc metadata for both forums
	await recalcForumMetadata(env, oldForumId);
	await recalcForumMetadata(env, targetForumId);

	// Invalidate volatile cache for BOTH source and target forums (counts +
	// last-post + thread-list page1 all changed in each). Also bump the
	// thread meta gen — `isRecommended` flips from true→false when the
	// thread leaves the source forum (the recommendation row above is
	// dropped), so any cached thread-detail payload must miss.
	// The recommendation row was deleted above, so invalidate the source
	// forum's recommended cache as well.
	await Promise.all([
		invalidateForumVolatileV2(env, oldForumId),
		invalidateForumVolatileV2(env, targetForumId),
		bumpThreadMetaGen(env, id),
		invalidateRecommendedCache(env, oldForumId),
	]);

	return jsonResponse({ id, forumId: targetForumId, moved: true }, origin);
}

// ─── DELETE /api/v1/moderation/posts/:id ─────────────────────────

export async function deletePost(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid post ID" }, origin);
	}

	const post = await env.DB.prepare(
		"SELECT id, thread_id, forum_id, author_id, is_first FROM posts WHERE id = ?",
	)
		.bind(id)
		.first<{
			id: number;
			thread_id: number;
			forum_id: number;
			author_id: number;
			is_first: number;
		}>();

	if (!post) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	// Cannot delete the first post — must delete the thread instead
	if (post.is_first === 1) {
		return errorResponse(
			"CANNOT_DELETE_FIRST_POST",
			400,
			{ message: "Cannot delete the first post — delete the thread instead" },
			origin,
		);
	}

	// Permission check: canDeletePost - Author OR Admin/SuperMod only (Mod CANNOT delete others' posts)
	const [user, forum] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		getForumForPermission(env, post.forum_id),
	]);

	if (!user || !forum) {
		return errorResponse(
			"INTERNAL_ERROR",
			500,
			{ message: "Failed to fetch permission data" },
			origin,
		);
	}

	// Build post object for permission check
	const postForPermission = {
		id: post.id,
		authorId: post.author_id,
	};

	if (!canDeletePost(user, postForPermission, forum)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "No permission to delete this post" },
			origin,
		);
	}

	// Delete post (purge attachments + post_comments first — both reference
	// posts(id) without ON DELETE CASCADE so the parent DELETE would 500),
	// decrement thread replies and forum post count.
	await env.DB.batch([
		...buildDeletePostChildStatements(env, [id]),
		env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
		env.DB.prepare("UPDATE threads SET replies = replies - 1 WHERE id = ?").bind(post.thread_id),
		env.DB.prepare("UPDATE forums SET posts = posts - 1 WHERE id = ?").bind(post.forum_id),
	]);

	// Tail fan-out: user post-counter, thread→forum recalc chain, and
	// volatile cache invalidation are mutually independent. Recalc must
	// stay thread-then-forum (forum derives from thread aggregate), but the
	// other two can overlap with it.
	await Promise.all([
		decrementUserPosts(env, post.author_id),
		(async () => {
			await recalcThreadMetadata(env, post.thread_id);
			await recalcForumMetadata(env, post.forum_id);
		})(),
		invalidateForumVolatileV2(env, post.forum_id),
	]);

	return jsonResponse({ deleted: true, id }, origin);
}

// ─── PATCH /api/v1/moderation/threads/:id/highlight ──────────────

/**
 * Encode highlight value from color + style flags.
 * Format: bits 0-23 = RGB color, bit24 = bold, bit25 = italic, bit26 = underline
 */
function encodeHighlight(
	color: string | null,
	bold: boolean,
	italic: boolean,
	underline: boolean,
): number {
	if (!color) return 0;

	// Parse hex color (#RRGGBB or #RGB)
	const hex = color.replace(/^#/, "");
	let rgb: number;
	if (hex.length === 3) {
		rgb = Number.parseInt(hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2], 16);
	} else if (hex.length === 6) {
		rgb = Number.parseInt(hex, 16);
	} else {
		return 0;
	}

	let value = rgb & 0xffffff;
	if (bold) value |= 1 << 24;
	if (italic) value |= 1 << 25;
	if (underline) value |= 1 << 26;

	return value;
}

export async function setHighlight(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const id = parseThreadIdFromModPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const { color, bold = false, italic = false, underline = false } = body;

	// Validate color format if provided
	if (color !== null && color !== undefined) {
		if (typeof color !== "string" || !/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color)) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: 'color must be null or a hex color string (e.g. "#ff0000")' },
				origin,
			);
		}
	}

	// Fetch thread to get forum_id
	const thread = await getThreadForPermission(env, id);
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	// Permission check: canModerate requires forum scope for Mods
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

	const highlightValue = encodeHighlight(
		(color as string | null) ?? null,
		!!bold,
		!!italic,
		!!underline,
	);

	await env.DB.prepare("UPDATE threads SET highlight = ? WHERE id = ?")
		.bind(highlightValue, id)
		.run();

	// Highlight is part of the cached thread row → bump per-forum gen.
	await bumpThreadListGen(env, thread.forumId);

	return jsonResponse({ id, highlight: highlightValue }, origin);
}

// ─── DELETE /api/v1/moderation/threads/:id ───────────────────────

export async function deleteThread(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	const thread = await env.DB.prepare(
		"SELECT id, forum_id, author_id, replies, digest FROM threads WHERE id = ?",
	)
		.bind(id)
		.first<{ id: number; forum_id: number; author_id: number; replies: number; digest: number }>();

	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	// Permission check: canDeleteThread - Author OR Admin/SuperMod only (Mod CANNOT delete others' threads)
	const [user, forum] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		getForumForPermission(env, thread.forum_id),
	]);

	if (!user || !forum) {
		return errorResponse(
			"INTERNAL_ERROR",
			500,
			{ message: "Failed to fetch permission data" },
			origin,
		);
	}

	// Convert thread to the expected type for permission check
	const threadForPermission = {
		id: thread.id,
		authorId: thread.author_id,
	};

	if (!canDeleteThread(user, threadForPermission, forum)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "No permission to delete this thread" },
			origin,
		);
	}

	// Count posts per author for user counter updates
	const posts = await env.DB.prepare("SELECT author_id FROM posts WHERE thread_id = ?")
		.bind(id)
		.all<{ author_id: number }>();

	const authorCounts = new Map<number, number>();
	for (const post of posts.results) {
		authorCounts.set(post.author_id, (authorCounts.get(post.author_id) ?? 0) + 1);
	}

	const totalPosts = thread.replies + 1;

	// Delete thread and all posts, update forum counts. Purge child rows
	// (attachments + post_comments) keyed on thread_id BEFORE the parent
	// posts/threads go away — neither child column is ON DELETE CASCADE.
	await env.DB.batch([
		...buildDeleteThreadChildStatements(env, [id]),
		env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(id),
		env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(id),
		env.DB.prepare("UPDATE forums SET threads = threads - 1, posts = posts - ? WHERE id = ?").bind(
			totalPosts,
			thread.forum_id,
		),
	]);

	// Tail fan-out: user counter decrements + forum recalc + cache
	// invalidation are all independent. Parallelise to compress latency.
	// If the deleted thread carried a non-zero digest, also bump digest gen
	// so digest filter caches drop the row. Also invalidate recommended
	// cache since the thread may have been recommended.
	const tail: Promise<unknown>[] = [
		decrementUserThreads(env, thread.author_id),
		batchDecrementUserPosts(env, authorCounts),
		recalcForumMetadata(env, thread.forum_id),
		invalidateForumVolatileV2(env, thread.forum_id),
		invalidateRecommendedCache(env, thread.forum_id),
	];
	if (thread.digest > 0) tail.push(bumpDigestGen(env));
	await Promise.all(tail);

	return jsonResponse({ deleted: true, id }, origin);
}

// ─── PATCH /api/v1/moderation/posts/:id ──────────────────────────

export async function editPost(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid post ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const { content } = body;
	if (typeof content !== "string" || content.trim().length === 0) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "content must be a non-empty string" },
			origin,
		);
	}

	const post = await getPostForPermission(env, id);
	if (!post) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	// Permission check: canEditPost - Author OR Mod in scope
	const [user, forum] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		getForumForPermission(env, post.forumId),
	]);

	if (!user || !forum) {
		return errorResponse(
			"INTERNAL_ERROR",
			500,
			{ message: "Failed to fetch permission data" },
			origin,
		);
	}

	// Build post object for permission check
	const postForPermission = {
		id: post.id,
		authorId: post.authorId,
	};

	if (!canEditPost(user, postForPermission, forum)) {
		return errorResponse("FORBIDDEN", 403, { message: "No permission to edit this post" }, origin);
	}

	await env.DB.prepare("UPDATE posts SET content = ? WHERE id = ?").bind(content.trim(), id).run();

	return jsonResponse({ id, updated: true }, origin);
}

// ═══════════════════════════════════════════════════════════════════
// User Moderation (Admin/SuperMod only)
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/v1/moderation/users/:id/status ────────────────────────

/** Get user status for moderation (Admin/SuperMod only) */
export async function getUserStatus(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const userId = parsePathSegment(request, 1);
	if (userId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Permission lookup + target lookup are independent — fire in parallel.
	const [user, targetUser] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		env.DB.prepare("SELECT id, username, status FROM users WHERE id = ?")
			.bind(userId)
			.first<{ id: number; username: string; status: number }>(),
	]);

	if (!user) {
		return errorResponse("INTERNAL_ERROR", 500, { message: "Failed to fetch user data" }, origin);
	}

	if (!canAccessAdmin(user)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Only Admin or SuperMod can view user status" },
			origin,
		);
	}

	if (!targetUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse(
		{
			userId: targetUser.id,
			username: targetUser.username,
			status: targetUser.status,
		},
		origin,
	);
}

// ─── GET /api/v1/moderation/users/:id/ip-records ─────────────────

/**
 * Get user's IP records (Admin/SuperMod only).
 *
 * NOTE: The current database schema does not include IP columns in posts or users tables.
 * This endpoint returns an empty array until IP tracking is implemented.
 * Future implementation should add:
 * - posts.ip column for tracking post IP addresses
 * - users.reg_ip and users.last_ip columns for registration/last login IP
 */
export async function getUserIpRecords(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const userId = parsePathSegment(request, 1);
	if (userId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Permission lookup + target lookup are independent — fire in parallel.
	const [user, targetUser] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		env.DB.prepare("SELECT id, username FROM users WHERE id = ?")
			.bind(userId)
			.first<{ id: number; username: string }>(),
	]);

	if (!user) {
		return errorResponse("INTERNAL_ERROR", 500, { message: "Failed to fetch user data" }, origin);
	}

	if (!canAccessAdmin(user)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Only Admin or SuperMod can view IP records" },
			origin,
		);
	}

	if (!targetUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	// NOTE: Database schema does not currently include IP columns.
	// Return empty array with a message indicating the feature is not yet available.
	return jsonResponse(
		{
			userId: targetUser.id,
			username: targetUser.username,
			ipRecords: [],
			message: "IP tracking is not currently enabled in this installation.",
		},
		origin,
	);
}

// ─── POST /api/v1/moderation/users/:id/mute ──────────────────────

export async function muteUser(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const userId = parsePathSegment(request, 1);
	if (userId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Permission lookup + target lookup are independent — fire in parallel.
	const [user, targetUser] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		env.DB.prepare("SELECT id, username, status, role FROM users WHERE id = ?")
			.bind(userId)
			.first<{ id: number; username: string; status: number; role: number }>(),
	]);

	if (!user) {
		return errorResponse("INTERNAL_ERROR", 500, { message: "Failed to fetch user data" }, origin);
	}

	if (!canAccessAdmin(user)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Only Admin or SuperMod can mute users" },
			origin,
		);
	}

	if (!targetUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	// Cannot mute admins or supermods
	if (targetUser.role === 1 || targetUser.role === 2) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Cannot mute Admin or SuperMod users" },
			origin,
		);
	}

	// Parse optional body for duration
	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		// No body is fine
	}

	// Mute = set status to -2 (Archived/Muted)
	// Note: duration is informational only - actual unmute would be a separate action
	await env.DB.prepare("UPDATE users SET status = -2 WHERE id = ?").bind(userId).run();

	return jsonResponse(
		{
			muted: true,
			userId: targetUser.id,
			username: targetUser.username,
			duration: body.duration ?? null,
		},
		origin,
	);
}

// ─── POST /api/v1/moderation/users/:id/unmute ────────────────────

export async function unmuteUser(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const userId = parsePathSegment(request, 1);
	if (userId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Permission lookup + target lookup are independent — fire in parallel.
	const [user, targetUser] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		env.DB.prepare("SELECT id, username, status FROM users WHERE id = ?")
			.bind(userId)
			.first<{ id: number; username: string; status: number }>(),
	]);

	if (!user) {
		return errorResponse("INTERNAL_ERROR", 500, { message: "Failed to fetch user data" }, origin);
	}

	if (!canAccessAdmin(user)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Only Admin or SuperMod can unmute users" },
			origin,
		);
	}

	if (!targetUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	// Only unmute if currently muted (-2)
	if (targetUser.status !== -2) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "User is not currently muted" },
			origin,
		);
	}

	// Unmute = set status back to 0 (Active)
	await env.DB.prepare("UPDATE users SET status = 0 WHERE id = ?").bind(userId).run();

	return jsonResponse(
		{
			unmuted: true,
			userId: targetUser.id,
			username: targetUser.username,
		},
		origin,
	);
}

// ─── POST /api/v1/moderation/users/:id/ban ───────────────────────

export async function banUser(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const userId = parsePathSegment(request, 1);
	if (userId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Permission lookup + target lookup are independent — fire in parallel.
	const [user, targetUser] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		env.DB.prepare("SELECT id, username, status, role FROM users WHERE id = ?")
			.bind(userId)
			.first<{ id: number; username: string; status: number; role: number }>(),
	]);

	if (!user) {
		return errorResponse("INTERNAL_ERROR", 500, { message: "Failed to fetch user data" }, origin);
	}

	if (!canAccessAdmin(user)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Only Admin or SuperMod can ban users" },
			origin,
		);
	}

	if (!targetUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	// Cannot ban admins or supermods
	if (targetUser.role === 1 || targetUser.role === 2) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Cannot ban Admin or SuperMod users" },
			origin,
		);
	}

	// Ban = set status to -1
	await env.DB.prepare("UPDATE users SET status = -1 WHERE id = ?").bind(userId).run();

	return jsonResponse(
		{
			banned: true,
			userId: targetUser.id,
			username: targetUser.username,
		},
		origin,
	);
}

// ─── POST /api/v1/moderation/users/:id/unban ─────────────────────

export async function unbanUser(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const userId = parsePathSegment(request, 1);
	if (userId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Permission lookup + target lookup are independent — fire in parallel.
	const [user, targetUser] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		env.DB.prepare("SELECT id, username, status FROM users WHERE id = ?")
			.bind(userId)
			.first<{ id: number; username: string; status: number }>(),
	]);

	if (!user) {
		return errorResponse("INTERNAL_ERROR", 500, { message: "Failed to fetch user data" }, origin);
	}

	if (!canAccessAdmin(user)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Only Admin or SuperMod can unban users" },
			origin,
		);
	}

	if (!targetUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	// Only unban if currently banned (-1)
	if (targetUser.status !== -1) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "User is not currently banned" },
			origin,
		);
	}

	// Unban = set status back to 0 (Active)
	await env.DB.prepare("UPDATE users SET status = 0 WHERE id = ?").bind(userId).run();

	return jsonResponse(
		{
			unbanned: true,
			userId: targetUser.id,
			username: targetUser.username,
		},
		origin,
	);
}

// ─── POST /api/v1/moderation/users/:id/nuke ──────────────────────

export async function nukeUser(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const userId = parsePathSegment(request, 1);
	if (userId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid user ID" }, origin);
	}

	// Permission lookup + target lookup are independent — fire in parallel.
	const [user, targetUser] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		env.DB.prepare("SELECT id, username, status, role FROM users WHERE id = ?")
			.bind(userId)
			.first<{ id: number; username: string; status: number; role: number }>(),
	]);

	if (!user) {
		return errorResponse("INTERNAL_ERROR", 500, { message: "Failed to fetch user data" }, origin);
	}

	if (!canAccessAdmin(user)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Only Admin or SuperMod can nuke users" },
			origin,
		);
	}

	if (!targetUser) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	// Cannot nuke admins or supermods
	if (targetUser.role === 1 || targetUser.role === 2) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "Cannot nuke Admin or SuperMod users" },
			origin,
		);
	}

	// Delete all user content (same logic as admin nuke)
	const result = await deleteUserContent(env, userId);

	// Update user (ban + zero counters/credits) and invalidate caches in
	// parallel — they're independent. Per-forum thread-list gens are bumped
	// for every forum touched by `deleteUserContent`; if any deleted thread
	// was a digest, also bump digest gen.
	const tail: Promise<unknown>[] = [
		env.DB.prepare(
			"UPDATE users SET status = -1, threads = 0, posts = 0, credits = 0, coins = 0 WHERE id = ?",
		)
			.bind(userId)
			.run(),
		invalidateThreadListForForums(env, result.affectedForumIds),
		bumpForumSummaryGen(env),
	];
	if (result.hadDigestThread) tail.push(bumpDigestGen(env));
	await Promise.all(tail);

	return jsonResponse(
		{
			nuked: true,
			userId: targetUser.id,
			username: targetUser.username,
			threadsDeleted: result.threadsDeleted,
			postsDeleted: result.postsDeleted,
			attachmentsDeleted: result.attachmentsDeleted,
		},
		origin,
	);
}

// ─── Content deletion helper (from admin/user.ts) ────────────────

interface ContentDeletionResult {
	threadsDeleted: number;
	postsDeleted: number;
	attachmentsDeleted: number;
	affectedForumIds: number[];
	hadDigestThread: boolean;
}

async function deleteUserContent(env: Env, userId: number): Promise<ContentDeletionResult> {
	// Each step is wrapped so the top-level catch reports exactly which
	// phase failed, making production debugging possible without wrangler tail.
	function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
		return fn().catch((err) => {
			throw new Error(`[nuke:${name}] ${err instanceof Error ? err.message : String(err)}`);
		});
	}

	// 0. Delete all attachments by the user first
	// This includes attachments in their own threads and in other users' threads
	const attachmentCount = await step("count-attachments", () =>
		env.DB.prepare("SELECT COUNT(*) as cnt FROM attachments WHERE author_id = ?")
			.bind(userId)
			.first<{ cnt: number }>(),
	);
	const attachmentsDeleted = attachmentCount?.cnt ?? 0;

	// Delete attachments
	await step("delete-user-attachments", () =>
		env.DB.prepare("DELETE FROM attachments WHERE author_id = ?").bind(userId).run(),
	);

	// 1. Get user's threads to calculate forum impact
	const threads = await step("fetch-threads", () =>
		env.DB.prepare("SELECT id, forum_id, replies, digest FROM threads WHERE author_id = ?")
			.bind(userId)
			.all(),
	);
	const threadRows = threads.results as {
		id: number;
		forum_id: number;
		replies: number;
		digest: number;
	}[];

	// 2. Group forum impact from user's threads (thread count + all posts in those threads)
	const forumThreadCounts = new Map<number, number>();
	const forumPostCounts = new Map<number, number>();
	for (const t of threadRows) {
		forumThreadCounts.set(t.forum_id, (forumThreadCounts.get(t.forum_id) ?? 0) + 1);
		forumPostCounts.set(t.forum_id, (forumPostCounts.get(t.forum_id) ?? 0) + t.replies + 1);
	}

	// 3. Count standalone posts (replies in other users' threads) grouped by forum
	const standalonePosts = await step("fetch-standalone-posts", () =>
		env.DB.prepare(
			"SELECT forum_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY forum_id",
		)
			.bind(userId, userId)
			.all(),
	);
	const standaloneRows = standalonePosts.results as { forum_id: number; cnt: number }[];

	// 4. Standalone post counts grouped by thread (for reply counter updates)
	const standaloneThreadUpdates = await step("fetch-standalone-thread-updates", () =>
		env.DB.prepare(
			"SELECT thread_id, COUNT(*) as cnt FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?) GROUP BY thread_id",
		)
			.bind(userId, userId)
			.all(),
	);
	const standaloneThreadRows = standaloneThreadUpdates.results as {
		thread_id: number;
		cnt: number;
	}[];

	// 5. Collateral damage: other users' posts in the user's threads.
	// Uses subquery to avoid expanding thousands of thread IDs into IN(...).
	const collateralAuthorCounts = new Map<number, number>();
	if (threadRows.length > 0) {
		const collateralPosts = await step("fetch-collateral", () =>
			env.DB.prepare(
				"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id IN (SELECT id FROM threads WHERE author_id = ?) AND author_id != ? GROUP BY author_id",
			)
				.bind(userId, userId)
				.all(),
		);
		for (const row of collateralPosts.results as { author_id: number; cnt: number }[]) {
			collateralAuthorCounts.set(row.author_id, row.cnt);
		}
	}

	// ── Deletion phase ──────────────────────────────────────────────
	// Uses subquery-based DELETEs to avoid expanding large ID arrays
	// into IN(...) placeholders. All 7 statements run in a single
	// bounded batch so a partial failure rolls back atomically.
	// D1 executes batch statements sequentially: FK children are
	// purged before parent rows, and threads are deleted last.

	await step("batch-delete", () =>
		env.DB.batch([
			// 1-2. FK children of user's own threads (other users' attachments/comments)
			env.DB.prepare(
				"DELETE FROM attachments WHERE thread_id IN (SELECT id FROM threads WHERE author_id = ?)",
			).bind(userId),
			env.DB.prepare(
				"DELETE FROM post_comments WHERE thread_id IN (SELECT id FROM threads WHERE author_id = ?)",
			).bind(userId),
			// 3-4. FK children of user's standalone posts
			env.DB.prepare(
				"DELETE FROM attachments WHERE post_id IN (SELECT id FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?))",
			).bind(userId, userId),
			env.DB.prepare(
				"DELETE FROM post_comments WHERE post_id IN (SELECT id FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?))",
			).bind(userId, userId),
			// 5. All posts in user's threads (any author — cascade)
			env.DB.prepare(
				"DELETE FROM posts WHERE thread_id IN (SELECT id FROM threads WHERE author_id = ?)",
			).bind(userId),
			// 6. User's standalone posts (replies in other users' threads)
			env.DB.prepare(
				"DELETE FROM posts WHERE author_id = ? AND thread_id NOT IN (SELECT id FROM threads WHERE author_id = ?)",
			).bind(userId, userId),
			// 7. Delete the user's threads themselves
			env.DB.prepare("DELETE FROM threads WHERE author_id = ?").bind(userId),
		]),
	);

	// Batch C: Update counters — thread reply counts + forum stats.
	// These scale with the number of affected threads/forums (bounded),
	// but chunked for safety.
	const counterStatements: D1PreparedStatement[] = [];

	// Thread reply counter adjustments
	for (const row of standaloneThreadRows) {
		counterStatements.push(
			env.DB.prepare("UPDATE threads SET replies = MAX(0, replies - ?) WHERE id = ?").bind(
				row.cnt,
				row.thread_id,
			),
		);
	}

	// Forum counter adjustments for deleted threads
	for (const [forumId, threadCount] of forumThreadCounts) {
		const postCount = forumPostCounts.get(forumId) ?? 0;
		counterStatements.push(
			env.DB.prepare(
				"UPDATE forums SET threads = MAX(0, threads - ?), posts = MAX(0, posts - ?) WHERE id = ?",
			).bind(threadCount, postCount, forumId),
		);
	}

	// Forum counter adjustments for standalone posts
	for (const row of standaloneRows) {
		counterStatements.push(
			env.DB.prepare("UPDATE forums SET posts = MAX(0, posts - ?) WHERE id = ?").bind(
				row.cnt,
				row.forum_id,
			),
		);
	}

	await step("batch-counters", () => batchChunked(env.DB, counterStatements));

	// Recalc metadata for all affected forums and threads
	const allAffectedForumIds = new Set<number>();
	for (const forumId of forumThreadCounts.keys()) {
		allAffectedForumIds.add(forumId);
	}
	for (const row of standaloneRows) {
		allAffectedForumIds.add(row.forum_id);
	}
	for (const forumId of allAffectedForumIds) {
		await step(`recalc-forum-${forumId}`, () => recalcForumMetadata(env, forumId));
	}

	// Recalc thread metadata for threads that had posts deleted
	for (const row of standaloneThreadRows) {
		await step(`recalc-thread-${row.thread_id}`, () => recalcThreadMetadata(env, row.thread_id));
	}

	// Decrement collateral authors' post counts (chunked)
	await step("decrement-collateral", () => batchDecrementUserPosts(env, collateralAuthorCounts));

	const totalPostsDeleted =
		threadRows.reduce((sum, t) => sum + t.replies + 1, 0) +
		standaloneRows.reduce((sum, r) => sum + r.cnt, 0);

	return {
		threadsDeleted: threadRows.length,
		postsDeleted: totalPostsDeleted,
		attachmentsDeleted,
		affectedForumIds: Array.from(allAffectedForumIds),
		hadDigestThread: threadRows.some((t) => t.digest > 0),
	};
}
