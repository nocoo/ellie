// User self-service content management handlers — Key A + JWT
// Endpoints: DELETE /api/v1/me/posts/:id, DELETE /api/v1/me/threads/:id,
//            PATCH /api/v1/me/posts/:id
// Users can delete/edit their own content without requiring moderator permissions.

import { invalidateForumSummaryV2 } from "../lib/cache/invalidate";
import {
	buildDeletePostChildStatements,
	buildDeleteThreadChildStatements,
} from "../lib/contentDelete";
import type { Env } from "../lib/env";
import { invalidateForumVolatile } from "../lib/forum-cache";
import { parseIdFromPath } from "../lib/parseId";
import { recalcForumMetadata, recalcThreadMetadata } from "../lib/recalcMetadata";
import { jsonResponse } from "../lib/response";
import {
	batchDecrementUserPosts,
	decrementUserPosts,
	decrementUserThreads,
} from "../lib/userCounters";
import { requireVerifiedEmail } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

// ─── DELETE /api/v1/me/posts/:id ─────────────────────────────────

export async function deleteMyPost(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await requireVerifiedEmail(request, env);
	if (authResult instanceof Response) return authResult;

	const { user } = authResult;
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

	// User can only delete their own posts
	if (post.author_id !== user.userId) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You can only delete your own posts" },
			origin,
		);
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

	// Delete post (purge attachments + post_comments first — both reference
	// posts(id) without ON DELETE CASCADE so the parent DELETE would 500),
	// decrement thread replies and forum post count.
	await env.DB.batch([
		...buildDeletePostChildStatements(env, [id]),
		env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(id),
		env.DB.prepare("UPDATE threads SET replies = replies - 1 WHERE id = ?").bind(post.thread_id),
		env.DB.prepare("UPDATE forums SET posts = posts - 1 WHERE id = ?").bind(post.forum_id),
	]);

	// Decrement user's post count
	await decrementUserPosts(env, user.userId);

	// Recalc thread metadata first (last_post_at / last_poster may have
	// pointed at the deleted post), then forum metadata which derives from
	// the per-thread aggregate.
	await recalcThreadMetadata(env, post.thread_id);
	await recalcForumMetadata(env, post.forum_id);
	await Promise.all([invalidateForumVolatile(env), invalidateForumSummaryV2(env)]);

	return jsonResponse({ deleted: true, id }, origin);
}

// ─── DELETE /api/v1/me/threads/:id ───────────────────────────────

export async function deleteMyThread(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await requireVerifiedEmail(request, env);
	if (authResult instanceof Response) return authResult;

	const { user } = authResult;
	const id = parseIdFromPath(request);
	if (id === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
	}

	const thread = await env.DB.prepare(
		"SELECT id, forum_id, author_id, replies FROM threads WHERE id = ?",
	)
		.bind(id)
		.first<{ id: number; forum_id: number; author_id: number; replies: number }>();

	if (!thread) {
		return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
	}

	// User can only delete their own threads
	if (thread.author_id !== user.userId) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You can only delete your own threads" },
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

	// Decrement user counters
	await decrementUserThreads(env, thread.author_id);
	await batchDecrementUserPosts(env, authorCounts);

	// Recalc forum metadata
	await recalcForumMetadata(env, thread.forum_id);
	await Promise.all([invalidateForumVolatile(env), invalidateForumSummaryV2(env)]);

	return jsonResponse({ deleted: true, id }, origin);
}

// ─── PATCH /api/v1/me/posts/:id ──────────────────────────────────

export async function editMyPost(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const authResult = await requireVerifiedEmail(request, env);
	if (authResult instanceof Response) return authResult;

	const { user } = authResult;
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

	const post = await env.DB.prepare("SELECT id, author_id FROM posts WHERE id = ?")
		.bind(id)
		.first<{ id: number; author_id: number }>();

	if (!post) {
		return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	}

	// User can only edit their own posts
	if (post.author_id !== user.userId) {
		return errorResponse("FORBIDDEN", 403, { message: "You can only edit your own posts" }, origin);
	}

	await env.DB.prepare("UPDATE posts SET content = ? WHERE id = ?").bind(content.trim(), id).run();

	return jsonResponse({ id, updated: true }, origin);
}
