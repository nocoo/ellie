// Admin thread handlers — CRUD framework implementation
// Endpoints #25-#30: list, getById, update, delete, batch-delete, batch-move

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import {
	createBatchDeleteHandler,
	createGetByIdHandler,
	createListHandler,
	createUpdateHandler,
} from "../../lib/crud";
import type { Env } from "../../lib/env";
import { invalidateForumVolatile } from "../../lib/forum-cache";
import { toThread } from "../../lib/mappers";
import { parseIdFromPath } from "../../lib/parseId";
import { recalcForumMetadata } from "../../lib/recalcMetadata";
import { jsonResponse } from "../../lib/response";
import { batchDecrementUserPosts, decrementUserThreads } from "../../lib/userCounters";

import { errorResponse } from "../../middleware/error";

// ─── Entity config ───────────────────────────────────────────────

const threadConfig: EntityConfig = {
	table: "threads",
	entityName: "THREAD",
	auth: "moderator",
	columns: "*",
	mapper: toThread,
	notFoundCode: "THREAD_NOT_FOUND",
	filters: [
		{ param: "forumId", column: "forum_id", type: "exact", parse: "int" },
		{ param: "authorId", column: "author_id", type: "exact", parse: "int" },
		{ param: "authorName", column: "author_name", type: "like" },
		{ param: "subject", column: "subject", type: "like" },
		{ param: "sticky", column: "sticky", type: "exact", parse: "int" },
		{ param: "closed", column: "closed", type: "exact", parse: "int" },
		{ param: "digest", column: "digest", type: "exact", parse: "int" },
		{ param: "highlight", column: "highlight", type: "exact", parse: "int" },
	],
	listSort: "id DESC",
	updateFields: [
		{
			name: "subject",
			column: "subject",
			validate: (v) => {
				if (typeof v !== "string") return "subject must be a string";
				if (v.trim().length === 0) return "subject cannot be empty";
				if (v.length > 200) return "subject must be at most 200 characters";
				return null;
			},
		},
		{
			name: "sticky",
			column: "sticky",
			validate: (v) => {
				if (typeof v !== "number" || !Number.isInteger(v)) return "sticky must be an integer";
				if (v < 0 || v > 3) return "sticky must be 0-3";
				return null;
			},
		},
		{
			name: "digest",
			column: "digest",
			validate: (v) => {
				if (typeof v !== "number" || !Number.isInteger(v)) return "digest must be an integer";
				if (v < 0 || v > 3) return "digest must be 0-3";
				return null;
			},
		},
		{
			name: "closed",
			column: "closed",
			validate: (v) => {
				if (typeof v !== "number" || !Number.isInteger(v)) return "closed must be an integer";
				if (v !== 0 && v !== 1) return "closed must be 0 or 1";
				return null;
			},
		},
		{
			name: "highlight",
			column: "highlight",
			validate: (v) => {
				if (typeof v !== "number" || !Number.isInteger(v)) return "highlight must be an integer";
				if (v < 0) return "highlight must be >= 0";
				return null;
			},
		},
		{
			name: "forumId",
			column: "forum_id",
			validate: (v) => {
				if (typeof v !== "number" || !Number.isInteger(v)) return "forumId must be an integer";
				if (v <= 0) return "forumId must be a positive integer";
				return null;
			},
		},
	],
	canDelete: true,
	batchDelete: true,
	batchLimit: 100,

	// ─── Lifecycle hooks ─────────────────────────────────────────

	async beforeUpdate(_id, data, _existing, env, origin) {
		// Validate target forum exists when moving
		if (data.forum_id !== undefined) {
			const targetForum = await env.DB.prepare("SELECT id FROM forums WHERE id = ?")
				.bind(data.forum_id)
				.first();
			if (!targetForum) {
				return errorResponse("INVALID_BODY", 400, { message: "Target forum not found" }, origin);
			}
		}
		return undefined;
	},

	async afterUpdate(id, data, existing, env) {
		// Move side effects: update posts' forum_id and adjust forum counts
		if (data.forum_id !== undefined && data.forum_id !== existing.forum_id) {
			const oldForumId = existing.forum_id as number;
			const newForumId = data.forum_id as number;
			const replies = existing.replies as number;
			const postCount = replies + 1;

			await env.DB.batch([
				env.DB.prepare("UPDATE posts SET forum_id = ? WHERE thread_id = ?").bind(newForumId, id),
				env.DB.prepare(
					"UPDATE forums SET threads = threads - 1, posts = posts - ? WHERE id = ?",
				).bind(postCount, oldForumId),
				env.DB.prepare(
					"UPDATE forums SET threads = threads + 1, posts = posts + ? WHERE id = ?",
				).bind(postCount, newForumId),
			]);

			// Recalc metadata for both old and new forums
			await recalcForumMetadata(env, oldForumId);
			await recalcForumMetadata(env, newForumId);
			await invalidateForumVolatile(env);
		}
	},

	async afterDelete(id, existing, env) {
		const forumId = existing.forum_id as number;
		const authorId = existing.author_id as number;

		// Query post authors before deleting orphaned posts
		const postAuthors = await env.DB.prepare(
			"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id = ? GROUP BY author_id",
		)
			.bind(id)
			.all();
		const authorCounts = new Map<number, number>();
		for (const row of postAuthors.results as { author_id: number; cnt: number }[]) {
			authorCounts.set(row.author_id, row.cnt);
		}

		// Count posts for forum counter adjustment
		const countResult = await env.DB.prepare(
			"SELECT COUNT(*) as cnt FROM posts WHERE thread_id = ?",
		)
			.bind(id)
			.first<{ cnt: number }>();
		const postsInThread = countResult?.cnt ?? 0;

		// Delete orphaned posts + decrement forum counts
		await env.DB.batch([
			env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(id),
			env.DB.prepare(
				"UPDATE forums SET threads = threads - 1, posts = posts - ? WHERE id = ?",
			).bind(postsInThread, forumId),
		]);

		// Decrement thread author's thread count
		await decrementUserThreads(env, authorId);

		// Decrement post authors' post counts
		await batchDecrementUserPosts(env, authorCounts);

		// Recalc forum metadata after thread deletion
		await recalcForumMetadata(env, forumId);
		await invalidateForumVolatile(env);
	},
};

// ─── CRUD handlers ───────────────────────────────────────────────

/** #25 GET /api/admin/threads — List threads with filters */
export const list = withEntityAuth(threadConfig, createListHandler(threadConfig));

/** #26 GET /api/admin/threads/:id — Get thread by ID */
export const getById = withEntityAuth(threadConfig, createGetByIdHandler(threadConfig));

/** #27 PATCH /api/admin/threads/:id — Unified update (subject, sticky, digest, closed, highlight, forumId) */
export const update = withEntityAuth(threadConfig, createUpdateHandler(threadConfig));

// ─── Custom delete handler (#28) ─────────────────────────────────
// Custom because response includes postsDeleted (not supported by createRemoveHandler)

export const remove = withEntityAuth(
	threadConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const id = parseIdFromPath(request);
		if (id === null) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid thread ID" }, origin);
		}

		const thread = await env.DB.prepare("SELECT * FROM threads WHERE id = ?").bind(id).first();
		if (!thread) {
			return errorResponse("THREAD_NOT_FOUND", 404, undefined, origin);
		}

		const threadRow = thread as { forum_id: number; author_id: number; replies: number };

		// Query post authors before deletion for user counter updates
		const postAuthors = await env.DB.prepare(
			"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id = ? GROUP BY author_id",
		)
			.bind(id)
			.all();
		const authorCounts = new Map<number, number>();
		for (const row of postAuthors.results as { author_id: number; cnt: number }[]) {
			authorCounts.set(row.author_id, row.cnt);
		}

		// Count all posts belonging to this thread
		const countResult = await env.DB.prepare(
			"SELECT COUNT(*) as cnt FROM posts WHERE thread_id = ?",
		)
			.bind(id)
			.first<{ cnt: number }>();
		const postsDeleted = countResult?.cnt ?? 0;

		// Delete all posts, delete thread, decrement forum counts
		await env.DB.batch([
			env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(id),
			env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(id),
			env.DB.prepare(
				"UPDATE forums SET threads = threads - 1, posts = posts - ? WHERE id = ?",
			).bind(postsDeleted, threadRow.forum_id),
		]);

		// Decrement thread author's thread count
		await decrementUserThreads(env, threadRow.author_id);

		// Decrement post authors' post counts
		await batchDecrementUserPosts(env, authorCounts);

		// Recalc forum metadata after thread deletion
		await recalcForumMetadata(env, threadRow.forum_id);
		await invalidateForumVolatile(env);

		return jsonResponse({ deleted: true, id, postsDeleted }, origin);
	},
);

// ─── Batch delete (#29) ──────────────────────────────────────────
// Uses CRUD framework's batch delete with beforeDelete to count posts,
// plus afterDelete hook for forum count adjustments.
// Note: the CRUD batch delete handler calls beforeDelete/afterDelete per item,
// but the standard response is {deleted: true, count} which matches the spec.

export const batchDelete = withEntityAuth(threadConfig, createBatchDeleteHandler(threadConfig));

// ─── Batch move (#30) ────────────────────────────────────────────

const MAX_BATCH_SIZE = 100;

export const batchMove = withEntityAuth(
	threadConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
		}

		// Validate ids
		if (!Array.isArray(body.ids) || body.ids.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "ids must be a non-empty array" },
				origin,
			);
		}
		if (body.ids.length > MAX_BATCH_SIZE) {
			return errorResponse(
				"BATCH_LIMIT_EXCEEDED",
				400,
				{ message: `Maximum ${MAX_BATCH_SIZE} threads per batch` },
				origin,
			);
		}

		const ids = body.ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
		if (ids.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "ids must contain valid numbers" },
				origin,
			);
		}

		// Validate forumId
		if (typeof body.forumId !== "number" || !Number.isInteger(body.forumId) || body.forumId <= 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "forumId must be a positive integer" },
				origin,
			);
		}
		const targetForumId = body.forumId;

		// Validate target forum exists
		const targetForum = await env.DB.prepare("SELECT id FROM forums WHERE id = ?")
			.bind(targetForumId)
			.first();
		if (!targetForum) {
			return errorResponse("INVALID_BODY", 400, { message: "Target forum not found" }, origin);
		}

		// Fetch all threads
		const placeholders = ids.map(() => "?").join(",");
		const threads = await env.DB.prepare(
			`SELECT id, forum_id, replies FROM threads WHERE id IN (${placeholders})`,
		)
			.bind(...ids)
			.all();

		const threadRows = threads.results as { id: number; forum_id: number; replies: number }[];
		if (threadRows.length === 0) {
			return jsonResponse({ moved: true, count: 0, forumId: targetForumId }, origin);
		}

		// Filter out threads already in the target forum
		const movable = threadRows.filter((t) => t.forum_id !== targetForumId);
		if (movable.length === 0) {
			return jsonResponse({ moved: true, count: 0, forumId: targetForumId }, origin);
		}

		// Group by old forum for count adjustments
		const forumAdjustments = new Map<number, { threads: number; posts: number }>();
		for (const t of movable) {
			const existing = forumAdjustments.get(t.forum_id) ?? { threads: 0, posts: 0 };
			existing.threads += 1;
			existing.posts += t.replies + 1;
			forumAdjustments.set(t.forum_id, existing);
		}

		// Total posts moving to the new forum
		let totalPostsMoving = 0;
		for (const t of movable) {
			totalPostsMoving += t.replies + 1;
		}

		// Build batch statements
		const statements: D1PreparedStatement[] = [];

		// Update each thread's forum_id
		for (const t of movable) {
			statements.push(
				env.DB.prepare("UPDATE threads SET forum_id = ? WHERE id = ?").bind(targetForumId, t.id),
			);
			statements.push(
				env.DB.prepare("UPDATE posts SET forum_id = ? WHERE thread_id = ?").bind(
					targetForumId,
					t.id,
				),
			);
		}

		// Decrement old forum counts
		for (const [forumId, adj] of forumAdjustments) {
			statements.push(
				env.DB.prepare(
					"UPDATE forums SET threads = threads - ?, posts = posts - ? WHERE id = ?",
				).bind(adj.threads, adj.posts, forumId),
			);
		}

		// Increment new forum counts
		statements.push(
			env.DB.prepare(
				"UPDATE forums SET threads = threads + ?, posts = posts + ? WHERE id = ?",
			).bind(movable.length, totalPostsMoving, targetForumId),
		);

		await env.DB.batch(statements);

		// Recalc metadata for all affected forums (old ones + target)
		for (const forumId of forumAdjustments.keys()) {
			await recalcForumMetadata(env, forumId);
		}
		await recalcForumMetadata(env, targetForumId);
		await invalidateForumVolatile(env);

		return jsonResponse({ moved: true, count: movable.length, forumId: targetForumId }, origin);
	},
);
