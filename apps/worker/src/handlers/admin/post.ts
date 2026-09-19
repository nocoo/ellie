// Admin post handlers — endpoints #31-#35
// Uses CRUD framework for reads/edits and atomic batches for deletions.
// Custom handler for batch-delete (skipped first-post IDs in response).

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import { invalidateAdminEntityCache } from "../../lib/cache/admin-entity-read";
import {
	bumpDigestGen,
	bumpForumSummaryGen,
	bumpPostAttachmentsGen,
	bumpPostEntityGen,
	bumpPostListGen,
	bumpThreadListGenAll,
	bumpThreadMetaGen,
	invalidateForumVolatileV2,
	invalidateThreadListForForums,
	invalidateThreadReading,
} from "../../lib/cache/invalidate";
import { buildDeletePostStatements } from "../../lib/contentDelete";
import type { EntityConfig } from "../../lib/crud";
import { createGetByIdHandler, createListHandler, createUpdateHandler } from "../../lib/crud";
import { confirmedBatch } from "../../lib/d1-write";
import type { Env } from "../../lib/env";
import { toPost } from "../../lib/mappers";
import { parseIdFromPath } from "../../lib/parseId";
import { jsonNoStoreResponse } from "../../lib/response";
import { STICKY_GLOBAL } from "../../lib/visibility";
import { errorResponse } from "../../middleware/error";
import { invalidateRecommendedCache } from "../recommended";

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
		{ param: "authorName", column: "author_id", type: "username" },
		{
			param: "content",
			column: "content",
			type: "like",
			scopeParams: ["threadId", "authorId", "authorName"],
		},
		{ param: "isFirst", column: "is_first", type: "exact", parse: "int" },
		{ param: "createdAt", column: "created_at", type: "range", rangeIndex: "idx_posts_created" },
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
	async afterUpdate(id, data, existing, env) {
		if (data.content !== existing.content) await bumpPostEntityGen(env, id);
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
				await writeAdminLog(env, resolveActor(request, env), {
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
export const remove = withEntityAuth(postConfig, async (request, env) => {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request);
	if (id === null)
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid post ID" }, origin);
	const existing = await env.DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first<{
		id: number;
		thread_id: number;
		forum_id: number;
		author_id: number;
		is_first: number;
	}>();
	if (!existing) return errorResponse("POST_NOT_FOUND", 404, undefined, origin);
	if (existing.is_first === 1)
		return errorResponse(
			"CANNOT_DELETE_FIRST_POST",
			400,
			{
				message: "Cannot delete the first post — delete the thread instead",
			},
			origin,
		);

	const thread = await env.DB.prepare("SELECT sticky, digest FROM threads WHERE id = ?")
		.bind(existing.thread_id)
		.first<{ sticky: number; digest: number }>();
	await confirmedBatch(env, buildDeletePostStatements(env, [existing]));
	const invalidations: Promise<unknown>[] = [
		...["posts", "threads", "forums", "users", "attachments"].map((resource) =>
			invalidateAdminEntityCache(env, resource),
		),
		bumpPostEntityGen(env, id),
		bumpPostAttachmentsGen(env, id),
		bumpPostListGen(env, existing.thread_id),
		bumpThreadMetaGen(env, existing.thread_id),
		invalidateForumVolatileV2(env, existing.forum_id),
		invalidateRecommendedCache(env, existing.forum_id),
	];
	if (thread?.digest && thread.digest > 0) invalidations.push(bumpDigestGen(env));
	if (thread?.sticky === STICKY_GLOBAL) invalidations.push(bumpThreadListGenAll(env));
	await Promise.all(invalidations);
	await writeAdminLog(env, resolveActor(request, env), {
		action: "post.delete",
		targetType: "post",
		targetId: id,
		details: {
			threadId: existing.thread_id,
			forumId: existing.forum_id,
			authorId: existing.author_id,
			isFirst: false,
		},
	});
	return jsonNoStoreResponse({ deleted: true, id }, origin);
});

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
	if (!result.success) throw new Error("Post deletion snapshot failed");

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
		return jsonNoStoreResponse({ deleted: true, count: 0, skipped }, origin);
	}

	const affectedForumIds = [...new Set(deletable.map((p) => p.forum_id))];
	const threadIds = [...new Set(deletable.map((p) => p.thread_id))];
	const threads = await env.DB.prepare(
		`SELECT id, sticky, digest FROM threads WHERE id IN (${threadIds.map(() => "?").join(",")})`,
	)
		.bind(...threadIds)
		.all<{ id: number; sticky: number; digest: number }>();
	if (!threads.success) throw new Error("Post deletion thread query failed");
	await confirmedBatch(env, buildDeletePostStatements(env, deletable));

	// Invalidate the affected lists and record the committed deletion.
	const invalidations: Promise<unknown>[] = [
		...["posts", "threads", "forums", "users", "attachments"].map((resource) =>
			invalidateAdminEntityCache(env, resource),
		),
		...deletable.flatMap((p) => [bumpPostEntityGen(env, p.id), bumpPostAttachmentsGen(env, p.id)]),
		invalidateThreadReading(env, threadIds, { posts: true }),
		invalidateThreadListForForums(env, affectedForumIds),
		bumpForumSummaryGen(env),
		...affectedForumIds.map((forumId) => invalidateRecommendedCache(env, forumId)),
		writeAdminLog(env, resolveActor(request, env), {
			action: "post.batch_delete",
			targetType: "post",
			targetId: null,
			details: {
				ids: deletable.map((p) => p.id),
				count: deletable.length,
				skippedFirstPostIds: skipped,
			},
		}),
	];
	if (threads.results.some((t) => t.digest > 0)) invalidations.push(bumpDigestGen(env));
	if (threads.results.some((t) => t.sticky === STICKY_GLOBAL))
		invalidations.push(bumpThreadListGenAll(env));
	await Promise.all(invalidations);

	return jsonNoStoreResponse({ deleted: true, count: deletable.length, skipped }, origin);
});
