// Admin thread handlers — CRUD framework implementation
// Endpoints #25-#30: list, getById, update, delete, batch-delete, batch-move

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
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

			// Recalc metadata for both old and new forums (independent — parallel)
			await Promise.all([
				recalcForumMetadata(env, oldForumId),
				recalcForumMetadata(env, newForumId),
			]);
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

// ─── F3-b helpers ────────────────────────────────────────────────
// Map of body field name → existing-row column for diff detection. Mirrors
// threadConfig.updateFields. Subject is logged as length only (PII-light).

const UPDATE_FIELD_TO_COLUMN: Record<string, string> = {
	subject: "subject",
	sticky: "sticky",
	digest: "digest",
	closed: "closed",
	highlight: "highlight",
	forumId: "forum_id",
};

interface ThreadUpdateDiff {
	changedFields: string[];
	before: Record<string, unknown>;
	after: Record<string, unknown>;
	subjectLengthBefore?: number;
	subjectLengthAfter?: number;
}

function buildThreadUpdateDiff(
	body: Record<string, unknown>,
	existing: Record<string, unknown>,
): ThreadUpdateDiff {
	const changedFields: string[] = [];
	const before: Record<string, unknown> = {};
	const after: Record<string, unknown> = {};
	let subjectLengthBefore: number | undefined;
	let subjectLengthAfter: number | undefined;

	for (const [field, column] of Object.entries(UPDATE_FIELD_TO_COLUMN)) {
		if (!(field in body)) continue;
		const incoming = body[field];
		const current = existing[column];
		// Treat string/number identity as the only signal we care about; deep
		// compare not needed because all updateFields are scalars.
		if (incoming === current) continue;
		changedFields.push(field);
		if (field === "subject") {
			subjectLengthBefore = typeof current === "string" ? current.length : 0;
			subjectLengthAfter = typeof incoming === "string" ? incoming.length : 0;
		} else {
			before[field] = current ?? null;
			after[field] = incoming ?? null;
		}
	}

	return { changedFields, before, after, subjectLengthBefore, subjectLengthAfter };
}

// ─── #27 PATCH /api/admin/threads/:id — Unified update ───────────
// F3-b: wrap the framework handler so we can emit thread.update only on
// successful (2xx) mutations, with a no-op skip when no field actually
// changed value. The inner handler still runs the SQL — we only add an
// audit row, not new business behavior.

const updateInner = createUpdateHandler(threadConfig);

export const update = withEntityAuth(
	threadConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const id = parseIdFromPath(request);

		// Snapshot body + existing row before the inner handler consumes the
		// request stream. Failures here just skip audit — the inner handler
		// owns validation and will return its own 4xx.
		let body: Record<string, unknown> = {};
		let bodyText = "";
		let existing: Record<string, unknown> | null = null;
		try {
			bodyText = await request.text();
			body = JSON.parse(bodyText) as Record<string, unknown>;
		} catch {
			// fall through; inner handler will 400
		}
		if (id !== null) {
			try {
				existing = (await env.DB.prepare("SELECT * FROM threads WHERE id = ?")
					.bind(id)
					.first()) as Record<string, unknown> | null;
			} catch {
				// best-effort snapshot
			}
		}

		const innerReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bodyText,
		});

		const res = await updateInner(innerReq, env);

		if (res.status >= 200 && res.status < 300 && id !== null && existing) {
			const diff = buildThreadUpdateDiff(body, existing);
			// Skip audit on semantic no-op so admin_logs stays signal-rich.
			if (diff.changedFields.length > 0) {
				const details: Record<string, unknown> = {
					forumId: existing.forum_id ?? null,
					authorId: existing.author_id ?? null,
					changedFields: diff.changedFields,
				};
				if (diff.subjectLengthBefore !== undefined) {
					details.subjectLengthBefore = diff.subjectLengthBefore;
					details.subjectLengthAfter = diff.subjectLengthAfter;
				}
				if (Object.keys(diff.before).length > 0) {
					details.before = diff.before;
					details.after = diff.after;
				}
				await writeAdminLog(env, resolveActor(request), {
					action: "thread.update",
					targetType: "thread",
					targetId: id,
					details,
				});
			}
		}

		return res;
	},
);

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

		// Query post authors before deletion for user counter updates. The total
		// post count for the thread is just the sum of these per-author counts,
		// so we can skip the separate `SELECT COUNT(*)` round-trip.
		const postAuthors = await env.DB.prepare(
			"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id = ? GROUP BY author_id",
		)
			.bind(id)
			.all();
		const authorCounts = new Map<number, number>();
		let postsDeleted = 0;
		for (const row of postAuthors.results as { author_id: number; cnt: number }[]) {
			authorCounts.set(row.author_id, row.cnt);
			postsDeleted += row.cnt;
		}

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

		// F3-b: audit only after the mutation has committed.
		await writeAdminLog(env, resolveActor(request), {
			action: "thread.delete",
			targetType: "thread",
			targetId: id,
			details: {
				forumId: threadRow.forum_id,
				authorId: threadRow.author_id,
				postsDeleted,
			},
		});

		return jsonResponse({ deleted: true, id, postsDeleted }, origin);
	},
);

// ─── Batch delete (#29) ──────────────────────────────────────────
// Uses CRUD framework's batch delete with beforeDelete to count posts,
// plus afterDelete hook for forum count adjustments.
// Note: the CRUD batch delete handler calls beforeDelete/afterDelete per item,
// but the standard response is {deleted: true, count} which matches the spec.
//
// F3-b: wrap so we can snapshot the existing ids before the inner handler
// deletes them, then audit ONE row per successful batch (not per item).

const batchDeleteInner = createBatchDeleteHandler(threadConfig);

export const batchDelete = withEntityAuth(
	threadConfig,
	async (request: Request, env: Env): Promise<Response> => {
		// Mirror createBatchDeleteHandler's body parsing so we can snapshot
		// the real existing set, then re-build the request for the inner.
		let ids: unknown[] = [];
		let bodyText = "";
		try {
			bodyText = await request.text();
			const parsed = JSON.parse(bodyText) as { ids?: unknown[] };
			if (Array.isArray(parsed?.ids)) ids = parsed.ids;
		} catch {
			// inner returns its own 400
		}

		const numericIds = ids
			.map((id) => Number(id))
			.filter((id): id is number => !Number.isNaN(id))
			.slice(0, 100);

		let existingIds: number[] = [];
		if (numericIds.length > 0) {
			try {
				const placeholders = numericIds.map(() => "?").join(",");
				const rows = await env.DB.prepare(`SELECT id FROM threads WHERE id IN (${placeholders})`)
					.bind(...numericIds)
					.all<{ id: number }>();
				existingIds = (rows.results ?? []).map((r) => r.id);
			} catch {
				// fall through with []
			}
		}

		const innerReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bodyText,
		});

		const res = await batchDeleteInner(innerReq, env);

		if (res.status >= 200 && res.status < 300 && existingIds.length > 0) {
			// threadConfig has no beforeDelete skip path — snapshot equals
			// the deleted set, no need to re-parse the inner response.
			await writeAdminLog(env, resolveActor(request), {
				action: "thread.batch_delete",
				targetType: "thread",
				targetId: null,
				details: { ids: existingIds, count: existingIds.length },
			});
		}

		return res;
	},
);

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

		// F3-b: audit one row for the entire successful batch. fromForumIds
		// is deduped (Map keys) so multi-source batches are searchable.
		const movedIds = movable.map((t) => t.id);
		const fromForumIds = Array.from(forumAdjustments.keys());
		await writeAdminLog(env, resolveActor(request), {
			action: "thread.batch_move",
			targetType: "thread",
			targetId: null,
			details: {
				ids: movedIds,
				count: movable.length,
				fromForumIds,
				toForumId: targetForumId,
			},
		});

		return jsonResponse({ moved: true, count: movable.length, forumId: targetForumId }, origin);
	},
);
