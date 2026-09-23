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
import { invalidateAdminEntityCache } from "../lib/cache/admin-entity-read";
import {
	bumpDigestGen,
	bumpPostAttachmentsGen,
	bumpPostEntityGen,
	bumpThreadListGenAll,
	bumpThreadMetaGen,
	invalidateForumVolatileV2,
	invalidateThreadListForForums,
	invalidateThreadReading,
	invalidateUserCaches,
} from "../lib/cache/invalidate";
import { buildDeletePostStatements, buildDeleteThreadChildStatements } from "../lib/contentDelete";
import { confirmedBatch, confirmedRun } from "../lib/d1-write";
import type { Env } from "../lib/env";
import { parseIdFromPath, parsePathSegment } from "../lib/parseId";
import {
	getForumForPermission,
	getPostForPermission,
	getThreadForPermission,
	getUserForPermission,
} from "../lib/permissionHelpers";
import { buildContentRecalcStatements, recalcForumMetadata } from "../lib/recalcMetadata";
import { jsonResponse } from "../lib/response";
import { deleteUserContent } from "../lib/userContentDelete";
import { buildUserCounterDecrementStatements } from "../lib/userCounters";
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
	if (typeof level !== "string" || !Object.hasOwn(STICKY_MAP, level)) {
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
	const prevRow = await env.DB.prepare("SELECT sticky, digest FROM threads WHERE id = ?")
		.bind(threadId)
		.first<{ sticky: number; digest: number }>();
	const prevSticky = prevRow?.sticky ?? STICKY_NONE;

	// Singleton enforcement: at most ONE thread can be sticky=global
	// site-wide. When promoting to global, demote any existing global
	// stickies down to forum-pinned (preserving the moderator intent that
	// the thread should remain visible at the top of its own forum).
	// We collect every forum_id touched by the demotion so we can fan-out
	// thread-list cache invalidation precisely.
	let demotedThreads: { id: number; forum_id: number }[] = [];
	const writes: D1PreparedStatement[] = [];
	if (stickyValue === STICKY_GLOBAL) {
		const existing = await env.DB.prepare(
			`SELECT id, forum_id FROM threads WHERE sticky = ${STICKY_GLOBAL} AND id != ?`,
		)
			.bind(threadId)
			.all<{ id: number; forum_id: number }>();
		if (!existing.success) throw new Error("Global thread query failed");
		const rows = existing.results;
		if (rows.length > 0) {
			demotedThreads = rows;
			writes.push(
				env.DB.prepare(
					`UPDATE threads SET sticky = ${STICKY_FORUM} WHERE sticky = ${STICKY_GLOBAL} AND id != ?`,
				).bind(threadId),
			);
		}
	}

	if (stickyValue === prevSticky && demotedThreads.length === 0) {
		return jsonResponse({ id: threadId, sticky: stickyValue }, origin);
	}
	const forumIds = [...new Set([thread.forumId, ...demotedThreads.map((row) => row.forum_id)])];
	const restored = prevSticky < 0;
	writes.push(
		env.DB.prepare("UPDATE threads SET sticky = ? WHERE id = ?").bind(stickyValue, threadId),
	);
	if (restored) writes.push(...buildContentRecalcStatements(env, [threadId], forumIds));
	await confirmedBatch(env, writes);

	// A restore also replaces child body/asset keys; demoted global rows
	// have their own stable entity keys and must change in the same pass.
	const invalidations: Promise<unknown>[] = [
		invalidateAdminEntityCache(env, "threads"),
		invalidateThreadReading(env, [threadId], { posts: restored }),
		invalidateThreadReading(
			env,
			demotedThreads.map((row) => row.id),
		),
		invalidateThreadListForForums(env, forumIds),
		...forumIds.map((forumId) => invalidateRecommendedCache(env, forumId)),
	];
	if (restored)
		invalidations.push(
			invalidateAdminEntityCache(env, "posts"),
			invalidateAdminEntityCache(env, "forums"),
		);
	if ((prevRow?.digest ?? 0) > 0 || demotedThreads.length > 0)
		invalidations.push(bumpDigestGen(env));
	const isGlobalTransition = stickyValue === STICKY_GLOBAL || prevSticky === STICKY_GLOBAL;
	if (isGlobalTransition) invalidations.push(bumpThreadListGenAll(env));
	await Promise.all(invalidations);

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

	const written = await confirmedRun(
		env.DB.prepare("UPDATE threads SET digest = ? WHERE id = ?").bind(level, threadId),
	);

	if (written.meta.changes > 0) {
		await Promise.all([
			bumpThreadMetaGen(env, threadId),
			bumpDigestGen(env),
			invalidateRecommendedCache(env, thread.forumId),
			invalidateAdminEntityCache(env, "threads"),
			invalidateAdminEntityCache(env, "users"),
		]);
	}

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
	const written = await confirmedRun(
		env.DB.prepare("UPDATE threads SET closed = ? WHERE id = ?").bind(closedValue, threadId),
	);

	if (written.meta.changes > 0) {
		await Promise.all([
			bumpThreadMetaGen(env, threadId),
			invalidateRecommendedCache(env, thread.forumId),
			invalidateAdminEntityCache(env, "threads"),
		]);
	}

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

	const thread = await env.DB.prepare(
		"SELECT id, forum_id, replies, sticky, digest FROM threads WHERE id = ?",
	)
		.bind(id)
		.first<{ id: number; forum_id: number; replies: number; sticky: number; digest: number }>();
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
	await confirmedBatch(env, [
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
	await Promise.all([
		recalcForumMetadata(env, oldForumId),
		recalcForumMetadata(env, targetForumId),
	]);
	const invalidations: Promise<unknown>[] = [
		...["threads", "posts", "forums"].map((resource) => invalidateAdminEntityCache(env, resource)),
		invalidateThreadReading(env, [id], { posts: true }),
		invalidateThreadListForForums(env, [oldForumId, targetForumId]),
		invalidateRecommendedCache(env, oldForumId),
		invalidateRecommendedCache(env, targetForumId),
	];
	if (thread.digest > 0) invalidations.push(bumpDigestGen(env));
	if (thread.sticky === STICKY_GLOBAL) invalidations.push(bumpThreadListGenAll(env));
	await Promise.all(invalidations);

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

	const thread = await env.DB.prepare("SELECT sticky, digest FROM threads WHERE id = ?")
		.bind(post.thread_id)
		.first<{ sticky: number; digest: number }>();
	await confirmedBatch(env, buildDeletePostStatements(env, [post]));
	const invalidations: Promise<unknown>[] = [
		...["posts", "threads", "forums", "users", "attachments"].map((resource) =>
			invalidateAdminEntityCache(env, resource),
		),
		bumpPostEntityGen(env, id),
		bumpPostAttachmentsGen(env, id),
		invalidateThreadReading(env, [post.thread_id], { posts: true }),
		invalidateForumVolatileV2(env, post.forum_id),
		invalidateRecommendedCache(env, post.forum_id),
	];
	if ((thread?.digest ?? 0) > 0) invalidations.push(bumpDigestGen(env));
	if (thread?.sticky === STICKY_GLOBAL) invalidations.push(bumpThreadListGenAll(env));
	await Promise.all(invalidations);

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

	const written = await confirmedRun(
		env.DB.prepare("UPDATE threads SET highlight = ? WHERE id = ?").bind(highlightValue, id),
	);

	if (written.meta.changes > 0) {
		await Promise.all([
			bumpThreadMetaGen(env, id),
			invalidateRecommendedCache(env, thread.forumId),
			invalidateAdminEntityCache(env, "threads"),
		]);
	}

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
		"SELECT id, forum_id, author_id, replies, digest, sticky FROM threads WHERE id = ?",
	)
		.bind(id)
		.first<{
			id: number;
			forum_id: number;
			author_id: number;
			replies: number;
			digest: number;
			sticky: number;
		}>();

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
	if (!posts.success) throw new Error("Thread deletion author query failed");

	const authorCounts = new Map<number, number>();
	for (const post of posts.results) {
		authorCounts.set(post.author_id, (authorCounts.get(post.author_id) ?? 0) + 1);
	}

	await confirmedBatch(env, [
		...buildDeleteThreadChildStatements(env, [id]),
		env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(id),
		env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(id),
		...buildContentRecalcStatements(env, [], [thread.forum_id]),
		...buildUserCounterDecrementStatements(env, authorCounts),
		...buildUserCounterDecrementStatements(env, new Map([[thread.author_id, 1]]), "threads"),
		...buildUserCounterDecrementStatements(
			env,
			thread.digest > 0 ? new Map([[thread.author_id, 1]]) : new Map(),
			"digest_posts",
		),
	]);

	const tail: Promise<unknown>[] = [
		...["threads", "posts", "forums", "users", "attachments"].map((resource) =>
			invalidateAdminEntityCache(env, resource),
		),
		invalidateThreadReading(env, [id], { posts: true }),
		invalidateForumVolatileV2(env, thread.forum_id),
		invalidateRecommendedCache(env, thread.forum_id),
	];
	if (thread.digest > 0) tail.push(bumpDigestGen(env));
	if (thread.sticky === STICKY_GLOBAL) tail.push(bumpThreadListGenAll(env));
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

	const written = await confirmedRun(
		env.DB.prepare("UPDATE posts SET content = ? WHERE id = ?").bind(content.trim(), id),
	);
	if (written.meta.changes > 0) {
		await Promise.all([bumpPostEntityGen(env, id), invalidateAdminEntityCache(env, "posts")]);
	}

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
	const written = await confirmedRun(
		env.DB.prepare("UPDATE users SET status = -2 WHERE id = ?").bind(userId),
	);
	if (written.meta.changes > 0) {
		await Promise.all([
			invalidateUserCaches(env, userId),
			invalidateAdminEntityCache(env, "users"),
		]);
	}

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
	const written = await confirmedRun(
		env.DB.prepare("UPDATE users SET status = 0 WHERE id = ?").bind(userId),
	);
	if (written.meta.changes > 0) {
		await Promise.all([
			invalidateUserCaches(env, userId),
			invalidateAdminEntityCache(env, "users"),
		]);
	}

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
	const written = await confirmedRun(
		env.DB.prepare("UPDATE users SET status = -1 WHERE id = ?").bind(userId),
	);
	if (written.meta.changes > 0) {
		await Promise.all([
			invalidateUserCaches(env, userId),
			invalidateAdminEntityCache(env, "users"),
		]);
	}

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
	const written = await confirmedRun(
		env.DB.prepare("UPDATE users SET status = 0 WHERE id = ?").bind(userId),
	);
	if (written.meta.changes > 0) {
		await Promise.all([
			invalidateUserCaches(env, userId),
			invalidateAdminEntityCache(env, "users"),
		]);
	}

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

	if (targetUser.status === -99) {
		return errorResponse("ALREADY_PURGED", 409, undefined, origin);
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
	const result = await deleteUserContent(env, userId, {
		resetCredits: true,
		deleteOwnAttachments: true,
	});

	// The account reset committed with deletion. Per-forum thread-list gens are bumped
	// for every forum touched by `deleteUserContent`; if any deleted thread
	// was a digest, also bump digest gen.
	const tail: Promise<unknown>[] = [
		invalidateAdminEntityCache(env, "users"),
		invalidateThreadReading(env, result.affectedThreadIds, { posts: true }),
		invalidateThreadListForForums(env, result.affectedForumIds),
		...result.affectedForumIds.map((forumId) => invalidateRecommendedCache(env, forumId)),
	];
	if (result.affectedThreadIds.length > 0) tail.push(invalidateAdminEntityCache(env, "threads"));
	if (result.affectedForumIds.length > 0) tail.push(invalidateAdminEntityCache(env, "forums"));
	if (result.postsDeleted > 0) tail.push(invalidateAdminEntityCache(env, "posts"));
	if (result.postsDeleted > 0 || result.attachmentsDeleted > 0)
		tail.push(invalidateAdminEntityCache(env, "attachments"));
	if (result.hadDigestThread) tail.push(bumpDigestGen(env));
	if (result.hadGlobalThread) tail.push(bumpThreadListGenAll(env));
	await Promise.all(tail);
	const affectedUsers = [...new Set([userId, ...result.collateralAuthorIds])];
	for (let start = 0; start < affectedUsers.length; start += 50) {
		await Promise.all(
			affectedUsers.slice(start, start + 50).map((id) => invalidateUserCaches(env, id)),
		);
	}
	for (let start = 0; start < result.attachmentPostIds.length; start += 50) {
		await Promise.all(
			result.attachmentPostIds
				.slice(start, start + 50)
				.map((postId) => bumpPostAttachmentsGen(env, postId)),
		);
	}

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
