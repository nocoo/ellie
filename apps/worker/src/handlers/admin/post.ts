// Admin post handlers — endpoints #31-#35
// Uses CRUD framework for list, getById, update, remove.
// Custom handler for batch-delete (skipped first-post IDs in response).

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import {
	createGetByIdHandler,
	createListHandler,
	createRemoveHandler,
	createUpdateHandler,
} from "../../lib/crud";
import { toPost } from "../../lib/mappers";
import { recalcForumMetadata, recalcThreadMetadata } from "../../lib/recalcMetadata";
import { jsonResponse } from "../../lib/response";
import { errorResponse } from "../../middleware/error";

// ─── Entity Config ───────────────────────────────────────────────

const postConfig: EntityConfig = {
	table: "posts",
	entityName: "POST",
	auth: "moderator",
	columns: "*",
	mapper: toPost,
	notFoundCode: "POST_NOT_FOUND",
	filters: [
		{ param: "threadId", column: "thread_id", type: "exact", parse: "int" },
		{ param: "authorId", column: "author_id", type: "exact", parse: "int" },
		{ param: "authorName", column: "author_name", type: "like" },
		{ param: "content", column: "content", type: "like" },
	],
	updateFields: [
		{
			name: "content",
			column: "content",
			validate: (v) =>
				typeof v !== "string" || v.trim().length === 0
					? "content must be a non-empty string"
					: null,
		},
	],
	canDelete: true,
	beforeDelete: async (_id, existing, _user, _env, origin) => {
		if ((existing as { is_first: number }).is_first === 1) {
			return errorResponse(
				"CANNOT_DELETE_FIRST_POST",
				400,
				{
					message: "Cannot delete the first post — delete the thread instead",
				},
				origin,
			);
		}
		return undefined;
	},
	afterDelete: async (_id, existing, _user, env) => {
		const row = existing as { thread_id: number; forum_id: number };
		await env.DB.batch([
			env.DB.prepare("UPDATE threads SET replies = replies - 1 WHERE id = ?").bind(row.thread_id),
			env.DB.prepare("UPDATE forums SET posts = posts - 1 WHERE id = ?").bind(row.forum_id),
		]);

		// Recalc thread and forum metadata after post deletion
		await recalcThreadMetadata(env, row.thread_id);
		await recalcForumMetadata(env, row.forum_id);
	},
};

// ─── CRUD Handlers ───────────────────────────────────────────────

/** #31 GET /api/admin/posts — List posts with filters and offset pagination */
export const list = withEntityAuth(postConfig, createListHandler(postConfig));

/** #32 GET /api/admin/posts/:id — Get post by ID */
export const getById = withEntityAuth(postConfig, createGetByIdHandler(postConfig));

/** #33 PATCH /api/admin/posts/:id — Edit post content */
export const update = withEntityAuth(postConfig, createUpdateHandler(postConfig));

/** #34 DELETE /api/admin/posts/:id — Delete post (refuses first post) */
export const remove = withEntityAuth(postConfig, createRemoveHandler(postConfig));

// ─── Custom Batch Delete (#35) ───────────────────────────────────
// Cannot use createBatchDeleteHandler because the response must include
// a `skipped` array of first-post IDs that were silently skipped.

const MAX_BATCH_SIZE = 100;

/** #35 POST /api/admin/posts/batch-delete — Batch delete posts, skip first posts */
export const batchDelete = withEntityAuth(postConfig, async (request, env, _user) => {
	const origin = request.headers.get("Origin") ?? undefined;

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const { ids } = body;
	if (!Array.isArray(ids) || ids.length === 0) {
		return errorResponse("INVALID_BODY", 400, { message: "ids must be a non-empty array" }, origin);
	}
	if (ids.length > MAX_BATCH_SIZE) {
		return errorResponse(
			"BATCH_LIMIT_EXCEEDED",
			400,
			{ message: `Maximum ${MAX_BATCH_SIZE} items per batch` },
			origin,
		);
	}

	const numericIds = ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
	if (numericIds.length === 0) {
		return errorResponse(
			"INVALID_BODY",
			400,
			{ message: "ids must contain valid numbers" },
			origin,
		);
	}

	// Fetch all posts to determine which are first posts
	const placeholders = numericIds.map(() => "?").join(",");
	const result = await env.DB.prepare(
		`SELECT id, thread_id, forum_id, is_first FROM posts WHERE id IN (${placeholders})`,
	)
		.bind(...numericIds)
		.all();

	const postRows = result.results as {
		id: number;
		thread_id: number;
		forum_id: number;
		is_first: number;
	}[];

	// Partition into deletable and skipped (first posts)
	const deletable = postRows.filter((p) => p.is_first !== 1);
	const skipped = postRows.filter((p) => p.is_first === 1).map((p) => p.id);

	if (deletable.length === 0) {
		return jsonResponse({ deleted: true, count: 0, skipped }, origin);
	}

	// Aggregate count updates by thread and forum
	const threadUpdates = new Map<number, number>();
	const forumUpdates = new Map<number, number>();

	for (const p of deletable) {
		threadUpdates.set(p.thread_id, (threadUpdates.get(p.thread_id) ?? 0) + 1);
		forumUpdates.set(p.forum_id, (forumUpdates.get(p.forum_id) ?? 0) + 1);
	}

	// Build batch statements
	const statements: D1PreparedStatement[] = [];

	for (const p of deletable) {
		statements.push(env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(p.id));
	}
	for (const [threadId, count] of threadUpdates) {
		statements.push(
			env.DB.prepare("UPDATE threads SET replies = replies - ? WHERE id = ?").bind(count, threadId),
		);
	}
	for (const [forumId, count] of forumUpdates) {
		statements.push(
			env.DB.prepare("UPDATE forums SET posts = posts - ? WHERE id = ?").bind(count, forumId),
		);
	}

	await env.DB.batch(statements);

	// Recalc metadata for affected threads and forums
	for (const threadId of threadUpdates.keys()) {
		await recalcThreadMetadata(env, threadId);
	}
	for (const forumId of forumUpdates.keys()) {
		await recalcForumMetadata(env, forumId);
	}

	return jsonResponse({ deleted: true, count: deletable.length, skipped }, origin);
});
