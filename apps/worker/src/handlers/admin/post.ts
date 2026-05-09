// Admin post handlers — endpoints #31-#35
// Uses CRUD framework for list, getById, update, remove.
// Custom handler for batch-delete (skipped first-post IDs in response).

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import {
	bumpForumSummaryGen,
	invalidateForumVolatileV2,
	invalidateThreadListForForums,
} from "../../lib/cache/invalidate";
import { buildDeletePostChildStatements } from "../../lib/contentDelete";
import type { EntityConfig } from "../../lib/crud";
import {
	createGetByIdHandler,
	createListHandler,
	createRemoveHandler,
	createUpdateHandler,
} from "../../lib/crud";
import type { Env } from "../../lib/env";
import { toPost } from "../../lib/mappers";
import { parseIdFromPath } from "../../lib/parseId";
import { recalcForumMetadata, recalcThreadMetadata } from "../../lib/recalcMetadata";
import { jsonResponse } from "../../lib/response";
import { batchDecrementUserPosts, decrementUserPosts } from "../../lib/userCounters";
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
	allowedSorts: {
		position_asc: "position ASC",
	},
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
	beforeDelete: async (id, existing, env, origin) => {
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
		// Purge attachments/post_comments BEFORE the framework's
		// `DELETE FROM posts WHERE id = ?` runs in createRemoveHandler. Both
		// child tables REFERENCE posts(id) without ON DELETE CASCADE, so
		// skipping this prefix turns the next DELETE into a 500.
		const childStmts = buildDeletePostChildStatements(env, [id]);
		if (childStmts.length > 0) {
			await env.DB.batch(childStmts);
		}
		return undefined;
	},
	afterDelete: async (_id, existing, env) => {
		const row = existing as { thread_id: number; forum_id: number; author_id: number };
		await env.DB.batch([
			env.DB.prepare("UPDATE threads SET replies = replies - 1 WHERE id = ?").bind(row.thread_id),
			env.DB.prepare("UPDATE forums SET posts = posts - 1 WHERE id = ?").bind(row.forum_id),
		]);

		// Decrement post author's post count
		await decrementUserPosts(env, row.author_id);

		// Recalc thread and forum metadata after post deletion
		await recalcThreadMetadata(env, row.thread_id);
		await recalcForumMetadata(env, row.forum_id);
		await invalidateForumVolatileV2(env, row.forum_id);
	},
};

// ─── CRUD Handlers ───────────────────────────────────────────────

/** #31 GET /api/admin/posts — List posts with filters and offset pagination */
export const list = withEntityAuth(postConfig, createListHandler(postConfig));

/** #32 GET /api/admin/posts/:id — Get post by ID */
export const getById = withEntityAuth(postConfig, createGetByIdHandler(postConfig));

/** #33 PATCH /api/admin/posts/:id — Edit post content */
// F3-b: wrap framework handler so we can audit post.update on success only,
// recording length-only metadata (no raw content) and skipping no-ops.

const updateInner = createUpdateHandler(postConfig);

export const update = withEntityAuth(
	postConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const id = parseIdFromPath(request);

		let body: Record<string, unknown> = {};
		let bodyText = "";
		let existing: Record<string, unknown> | null = null;
		try {
			bodyText = await request.text();
			body = JSON.parse(bodyText) as Record<string, unknown>;
		} catch {
			// inner returns its own 400
		}
		if (id !== null) {
			try {
				existing = (await env.DB.prepare("SELECT * FROM posts WHERE id = ?")
					.bind(id)
					.first()) as Record<string, unknown> | null;
			} catch {
				// best-effort
			}
		}

		const innerReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: bodyText,
		});

		const res = await updateInner(innerReq, env);

		if (res.status >= 200 && res.status < 300 && id !== null && existing) {
			const incomingContent = typeof body.content === "string" ? body.content : null;
			const previousContent =
				typeof existing.content === "string" ? (existing.content as string) : "";
			const contentChanged = incomingContent !== null && incomingContent !== previousContent;

			// No-op skip: only "content" is updateable on posts; if it didn't
			// actually change value, don't emit an audit row.
			if (contentChanged) {
				await writeAdminLog(env, resolveActor(request), {
					action: "post.update",
					targetType: "post",
					targetId: id,
					details: {
						threadId: existing.thread_id ?? null,
						forumId: existing.forum_id ?? null,
						authorId: existing.author_id ?? null,
						contentLengthBefore: previousContent.length,
						contentLengthAfter: incomingContent.length,
						contentChanged: true,
						changedFields: ["content"],
					},
				});
			}
		}

		return res;
	},
);

/** #34 DELETE /api/admin/posts/:id — Delete post (refuses first post) */
// F3-b: wrap so we can audit post.delete only after the inner remove
// commits successfully (skips first-post 400 path).

const removeInner = createRemoveHandler(postConfig);

export const remove = withEntityAuth(
	postConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const id = parseIdFromPath(request);

		// Snapshot existing first so we still have the row's metadata after
		// the inner handler deletes it.
		let existing: Record<string, unknown> | null = null;
		if (id !== null) {
			try {
				existing = (await env.DB.prepare("SELECT * FROM posts WHERE id = ?")
					.bind(id)
					.first()) as Record<string, unknown> | null;
			} catch {
				// best-effort
			}
		}

		const res = await removeInner(request, env);

		if (res.status >= 200 && res.status < 300 && id !== null && existing) {
			await writeAdminLog(env, resolveActor(request), {
				action: "post.delete",
				targetType: "post",
				targetId: id,
				details: {
					threadId: existing.thread_id ?? null,
					forumId: existing.forum_id ?? null,
					authorId: existing.author_id ?? null,
					isFirst: existing.is_first === 1,
				},
			});
		}

		return res;
	},
);

// ─── Custom Batch Delete (#35) ───────────────────────────────────
// Cannot use createBatchDeleteHandler because the response must include
// a `skipped` array of first-post IDs that were silently skipped.

const MAX_BATCH_SIZE = 100;

/** #35 POST /api/admin/posts/batch-delete — Batch delete posts, skip first posts */
export const batchDelete = withEntityAuth(postConfig, async (request, env) => {
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
		`SELECT id, thread_id, forum_id, author_id, is_first FROM posts WHERE id IN (${placeholders})`,
	)
		.bind(...numericIds)
		.all();

	const postRows = result.results as {
		id: number;
		thread_id: number;
		forum_id: number;
		author_id: number;
		is_first: number;
	}[];

	// Partition into deletable and skipped (first posts)
	const deletable = postRows.filter((p) => p.is_first !== 1);
	const skipped = postRows.filter((p) => p.is_first === 1).map((p) => p.id);

	if (deletable.length === 0) {
		return jsonResponse({ deleted: true, count: 0, skipped }, origin);
	}

	// Aggregate count updates by thread, forum, and author
	const threadUpdates = new Map<number, number>();
	const forumUpdates = new Map<number, number>();
	const authorUpdates = new Map<number, number>();

	for (const p of deletable) {
		threadUpdates.set(p.thread_id, (threadUpdates.get(p.thread_id) ?? 0) + 1);
		forumUpdates.set(p.forum_id, (forumUpdates.get(p.forum_id) ?? 0) + 1);
		authorUpdates.set(p.author_id, (authorUpdates.get(p.author_id) ?? 0) + 1);
	}

	// Build batch statements
	const statements: D1PreparedStatement[] = [];

	// Purge child rows (attachments + post_comments) keyed on post_id BEFORE
	// the parent posts go away, otherwise the next DELETE trips FK 500.
	const deletableIds = deletable.map((p) => p.id);
	statements.push(...buildDeletePostChildStatements(env, deletableIds));

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

	// Recalc metadata for affected threads and forums in parallel — each call
	// is independent of the others. Reduces total D1 wait time on a batch
	// delete from O(N) round-trips to roughly O(1).
	await Promise.all([
		...Array.from(threadUpdates.keys(), (threadId) => recalcThreadMetadata(env, threadId)),
		...Array.from(forumUpdates.keys(), (forumId) => recalcForumMetadata(env, forumId)),
	]);

	// Final fan-out: per-author post-count decrements + KV cache
	// invalidation + audit-log write are all independent. Per-forum
	// thread-list bumps for every affected forum + a single summary bump.
	await Promise.all([
		batchDecrementUserPosts(env, authorUpdates),
		invalidateThreadListForForums(env, Array.from(forumUpdates.keys())),
		bumpForumSummaryGen(env),
		writeAdminLog(env, resolveActor(request), {
			action: "post.batch_delete",
			targetType: "post",
			targetId: null,
			details: {
				ids: deletable.map((p) => p.id),
				count: deletable.length,
				skippedFirstPostIds: skipped,
			},
		}),
	]);

	return jsonResponse({ deleted: true, count: deletable.length, skipped }, origin);
});
