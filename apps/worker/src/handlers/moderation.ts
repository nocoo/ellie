// Moderation handlers — Key A + JWT + role ∈ {Admin, SuperMod, Mod}
// Endpoints: PATCH sticky, PATCH digest, PATCH close, PATCH move, PATCH highlight,
//            DELETE post, DELETE thread, PATCH post (edit)
// These are forum-frontend operations used by moderators, NOT admin console operations.

import type { Env } from "../lib/env";
import { parseIdFromPath, parsePathSegment } from "../lib/parseId";
import { recalcForumMetadata } from "../lib/recalcMetadata";
import { jsonResponse } from "../lib/response";
import {
	batchDecrementUserPosts,
	decrementUserPosts,
	decrementUserThreads,
} from "../lib/userCounters";
import { moderationMiddleware } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

// ─── Helpers ──────────────────────────────────────────────────────

/** Extract thread ID from /api/v1/moderation/threads/:id/<action> */
function parseThreadIdFromModPath(request: Request): number | null {
	return parsePathSegment(request, 1);
}

const STICKY_MAP: Record<string, number> = {
	none: 0,
	forum: 1,
	global: 2,
};

// ─── PATCH /api/v1/moderation/threads/:id/sticky ─────────────────

export async function setSticky(request: Request, env: Env): Promise<Response> {
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

	const { level } = body;
	if (typeof level !== "string" || !(level in STICKY_MAP)) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: 'level must be "none", "forum", or "global"' },
			origin,
		);
	}

	const thread = await env.DB.prepare("SELECT id FROM threads WHERE id = ?").bind(id).first();
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const stickyValue = STICKY_MAP[level];
	await env.DB.prepare("UPDATE threads SET sticky = ? WHERE id = ?").bind(stickyValue, id).run();

	return jsonResponse({ id, sticky: stickyValue }, origin);
}

// ─── PATCH /api/v1/moderation/threads/:id/digest ─────────────────

export async function setDigest(request: Request, env: Env): Promise<Response> {
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

	const { level } = body;
	if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 3) {
		return errorResponse("INVALID_BODY", 400, { message: "level must be 0, 1, 2, or 3" }, origin);
	}

	const thread = await env.DB.prepare("SELECT id FROM threads WHERE id = ?").bind(id).first();
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	await env.DB.prepare("UPDATE threads SET digest = ? WHERE id = ?").bind(level, id).run();

	return jsonResponse({ id, digest: level }, origin);
}

// ─── PATCH /api/v1/moderation/threads/:id/close ──────────────────

export async function setClose(request: Request, env: Env): Promise<Response> {
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

	const { closed } = body;
	if (typeof closed !== "boolean") {
		return errorResponse("INVALID_BODY", 400, { message: "closed must be a boolean" }, origin);
	}

	const thread = await env.DB.prepare("SELECT id FROM threads WHERE id = ?").bind(id).first();
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	const closedValue = closed ? 1 : 0;
	await env.DB.prepare("UPDATE threads SET closed = ? WHERE id = ?").bind(closedValue, id).run();

	return jsonResponse({ id, closed: closedValue }, origin);
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

	// Move thread + posts, adjust forum counts
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
	]);

	// Recalc metadata for both forums
	await recalcForumMetadata(env, oldForumId);
	await recalcForumMetadata(env, targetForumId);

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

	// Delete post, decrement thread replies and forum post count
	await env.DB.batch([
		env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
		env.DB.prepare("UPDATE threads SET replies = replies - 1 WHERE id = ?").bind(post.thread_id),
		env.DB.prepare("UPDATE forums SET posts = posts - 1 WHERE id = ?").bind(post.forum_id),
	]);

	// Decrement post author's post count
	await decrementUserPosts(env, post.author_id);

	// Recalc forum metadata
	await recalcForumMetadata(env, post.forum_id);

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

	const thread = await env.DB.prepare("SELECT id FROM threads WHERE id = ?").bind(id).first();
	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
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

	const thread = await env.DB.prepare("SELECT id, forum_id, author_id, replies FROM threads WHERE id = ?")
		.bind(id)
		.first<{ id: number; forum_id: number; author_id: number; replies: number }>();

	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
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

	// Delete thread and all posts, update forum counts
	await env.DB.batch([
		env.DB.prepare("DELETE FROM attachments WHERE thread_id = ?").bind(id),
		env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(id),
		env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(id),
		env.DB.prepare("UPDATE forums SET threads = threads - 1, posts = posts - ? WHERE id = ?").bind(
			totalPosts,
			thread.forum_id,
		),
	]);

	// Decrement user counters
	await decrementUserThreads(env, thread.author_id);
	await batchDecrementUserPosts(env, authorCounts);

	// Recalc forum metadata
	await recalcForumMetadata(env, thread.forum_id);

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
		return errorResponse("INVALID_BODY", 400, { message: "content must be a non-empty string" }, origin);
	}

	const post = await env.DB.prepare("SELECT id FROM posts WHERE id = ?").bind(id).first();
	if (!post) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	await env.DB.prepare("UPDATE posts SET content = ? WHERE id = ?").bind(content.trim(), id).run();

	return jsonResponse({ id, updated: true }, origin);
}
