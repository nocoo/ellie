// Admin thread handlers — CRUD framework implementation
// Endpoints #25-#30: list, getById, update, delete, batch-delete, batch-move

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import {
	bumpDigestGen,
	bumpForumSummaryGen,
	bumpThreadListGen,
	invalidateForumVolatileV2,
	invalidateThreadListForForums,
} from "../../lib/cache/invalidate";
import { buildDeleteThreadChildStatements } from "../../lib/contentDelete";
import type { EntityConfig } from "../../lib/crud";
import { createGetByIdHandler, createListHandler, createUpdateHandler } from "../../lib/crud";
import type { Env } from "../../lib/env";
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
		// `highlight` is an encoded RGB+style bitmask (see encodeHighlight in
		// moderation.ts). Exact-match values are not useful in the UI, so the
		// admin list also exposes a `highlighted=0|1` boolean filter that
		// translates to `highlight = 0` / `highlight > 0`.
		{ param: "highlighted", column: "highlight", type: "positive" },
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
		const movedForum = data.forum_id !== undefined && data.forum_id !== existing.forum_id;
		if (movedForum) {
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
		}

		// Cache invalidation matrix per docs/19 §6 thread.update row:
		//   - forum_id change ⇒ source + target volatile bump
		//   - any list-affecting field change ⇒ per-forum thread-list bump
		//     for the forum the thread now lives in
		//   - subject change ⇒ ALSO bump forum:summary:gen, because
		//     `forum:summary:v2` carries `lastThreadSubject` (the visible-
		//     last-thread title). If the renamed thread happens to be the
		//     forum's current visible-last, the summary cache would
		//     otherwise serve the old title until TTL expiry. We do NOT
		//     extend this to sticky/closed/digest/highlight — those don't
		//     change `lastThreadSubject` and the summary refresh would be
		//     pure overhead.
		//   - digest change ⇒ also bump digest gen (filter visibility)
		const LIST_AFFECTING = new Set(["sticky", "digest", "closed", "highlight", "subject"]);
		const listAffected = Object.keys(data).some((c) => LIST_AFFECTING.has(c));
		const digestChanged = data.digest !== undefined && data.digest !== (existing.digest as number);
		const subjectChanged =
			data.subject !== undefined && data.subject !== (existing.subject as string);

		const ops: Promise<unknown>[] = [];
		if (movedForum) {
			const oldForumId = existing.forum_id as number;
			const newForumId = data.forum_id as number;
			ops.push(
				invalidateForumVolatileV2(env, oldForumId),
				invalidateForumVolatileV2(env, newForumId),
			);
		} else if (listAffected) {
			const currentForumId = existing.forum_id as number;
			ops.push(bumpThreadListGen(env, currentForumId));
			if (subjectChanged) ops.push(bumpForumSummaryGen(env));
		}
		if (digestChanged) ops.push(bumpDigestGen(env));
		if (ops.length > 0) await Promise.all(ops);
	},

	async afterDelete(id, existing, env) {
		const forumId = existing.forum_id as number;
		const authorId = existing.author_id as number;

		// Query post authors before deleting orphaned posts. The total post
		// count for the thread is the sum of these per-author counts, so we
		// avoid a separate SELECT COUNT(*) round-trip.
		const postAuthors = await env.DB.prepare(
			"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id = ? GROUP BY author_id",
		)
			.bind(id)
			.all();
		const authorCounts = new Map<number, number>();
		let postsInThread = 0;
		for (const row of postAuthors.results as { author_id: number; cnt: number }[]) {
			authorCounts.set(row.author_id, row.cnt);
			postsInThread += row.cnt;
		}

		// Note: this hook only fires from createRemoveHandler/createBatchDeleteHandler,
		// which run AFTER `DELETE FROM threads WHERE id = ?`. The thread row is
		// already gone here, so child rows on `posts.thread_id` /
		// `attachments.thread_id` / `post_comments.thread_id` are technically
		// orphaned at this point — but the thread teardown paths that use this
		// CRUD framework (none for threads as of this commit) MUST purge child
		// rows BEFORE the framework's parent DELETE. We keep the orphan cleanup
		// here as a safety net since the columns aren't ON DELETE CASCADE and
		// may pre-exist in the DB.
		await env.DB.batch([
			...buildDeleteThreadChildStatements(env, [id]),
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

		// Volatile cache: forum summary + per-forum thread-list bumped together.
		// If deleted thread was a digest, also bump digest gen.
		const tail: Promise<unknown>[] = [invalidateForumVolatileV2(env, forumId)];
		if ((existing.digest as number) > 0) tail.push(bumpDigestGen(env));
		await Promise.all(tail);
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
				await writeAdminLog(env, resolveActor(request, env), {
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

		const threadRow = thread as {
			forum_id: number;
			author_id: number;
			replies: number;
			digest: number;
		};

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

		// Delete attachments + post_comments first (FK ON DELETE not declared
		// CASCADE on attachments/post_comments → must purge before posts/threads
		// or D1 raises FOREIGN KEY constraint failed).
		// Then delete all posts, delete thread, decrement forum counts.
		await env.DB.batch([
			...buildDeleteThreadChildStatements(env, [id]),
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
		const tail: Promise<unknown>[] = [invalidateForumVolatileV2(env, threadRow.forum_id)];
		if (threadRow.digest > 0) tail.push(bumpDigestGen(env));
		await Promise.all(tail);

		// F3-b: audit only after the mutation has committed.
		await writeAdminLog(env, resolveActor(request, env), {
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
// Custom batch handler — cannot delegate to createBatchDeleteHandler because
// `attachments.thread_id` and `post_comments.thread_id` REFERENCE threads(id)
// without ON DELETE CASCADE. The framework's per-row pipeline runs
// `DELETE FROM threads WHERE id = ?` BEFORE its `afterDelete` hook fires,
// so child rows can never be cleaned ahead of the parent in that path. We
// build one consolidated batch with the explicit child-purge → posts →
// threads ordering and then fan out the perf-friendly tail (counters /
// recalc / cache / audit) like the post.batchDelete sibling.

const THREAD_BATCH_LIMIT = 100;

export const batchDelete = withEntityAuth(
	threadConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let body: Record<string, unknown>;
		try {
			body = (await request.json()) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}

		const { ids } = body;
		if (!Array.isArray(ids) || ids.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "ids must be a non-empty array" },
				origin,
			);
		}
		if (ids.length > THREAD_BATCH_LIMIT) {
			return errorResponse(
				"BATCH_LIMIT_EXCEEDED",
				400,
				{ message: `Maximum ${THREAD_BATCH_LIMIT} items per batch` },
				origin,
			);
		}

		// Dedupe + numeric coercion: prevents double-counter-decrement on the
		// same id and matches the framework's recently added dedupe behavior.
		const seen = new Set<number>();
		const numericIds: number[] = [];
		for (const raw of ids) {
			const n = Number(raw);
			if (Number.isNaN(n) || seen.has(n)) continue;
			seen.add(n);
			numericIds.push(n);
		}
		if (numericIds.length === 0) {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "ids must contain valid numbers" },
				origin,
			);
		}

		// Snapshot the actual existing threads (rows that aren't there shouldn't
		// land in the audit row or the forum-counter math).
		const placeholders = numericIds.map(() => "?").join(",");
		const threadRows = (
			await env.DB.prepare(
				`SELECT id, forum_id, author_id, digest FROM threads WHERE id IN (${placeholders})`,
			)
				.bind(...numericIds)
				.all<{ id: number; forum_id: number; author_id: number; digest: number }>()
		).results;

		if (threadRows.length === 0) {
			return jsonResponse({ deleted: true, count: 0 }, origin);
		}

		const existingIds = threadRows.map((t) => t.id);
		const existingPlaceholders = existingIds.map(() => "?").join(",");

		// Aggregate per-author post counts across all of these threads in one
		// round-trip; aggregate per-forum thread counts + total post counts in
		// the same pass. Used after the batch for counter decrements and forum
		// recalcs.
		const postAuthors = await env.DB.prepare(
			`SELECT thread_id, author_id, COUNT(*) as cnt FROM posts WHERE thread_id IN (${existingPlaceholders}) GROUP BY thread_id, author_id`,
		)
			.bind(...existingIds)
			.all<{ thread_id: number; author_id: number; cnt: number }>();

		const authorCounts = new Map<number, number>();
		const postsPerThread = new Map<number, number>();
		for (const row of postAuthors.results) {
			authorCounts.set(row.author_id, (authorCounts.get(row.author_id) ?? 0) + row.cnt);
			postsPerThread.set(row.thread_id, (postsPerThread.get(row.thread_id) ?? 0) + row.cnt);
		}

		const forumThreadCounts = new Map<number, number>();
		const forumPostCounts = new Map<number, number>();
		const threadAuthorCounts = new Map<number, number>();
		for (const t of threadRows) {
			forumThreadCounts.set(t.forum_id, (forumThreadCounts.get(t.forum_id) ?? 0) + 1);
			forumPostCounts.set(
				t.forum_id,
				(forumPostCounts.get(t.forum_id) ?? 0) + (postsPerThread.get(t.id) ?? 0),
			);
			threadAuthorCounts.set(t.author_id, (threadAuthorCounts.get(t.author_id) ?? 0) + 1);
		}

		// Build batch in strict child→posts→threads→forum order.
		const statements: D1PreparedStatement[] = [
			...buildDeleteThreadChildStatements(env, existingIds),
			env.DB.prepare(`DELETE FROM posts WHERE thread_id IN (${existingPlaceholders})`).bind(
				...existingIds,
			),
			env.DB.prepare(`DELETE FROM threads WHERE id IN (${existingPlaceholders})`).bind(
				...existingIds,
			),
		];
		for (const [forumId, threadCount] of forumThreadCounts) {
			const postCount = forumPostCounts.get(forumId) ?? 0;
			statements.push(
				env.DB.prepare(
					"UPDATE forums SET threads = threads - ?, posts = posts - ? WHERE id = ?",
				).bind(threadCount, postCount, forumId),
			);
		}

		await env.DB.batch(statements);

		// Tail fan-out — independent counter decrements + per-forum recalcs +
		// volatile cache invalidation + audit log. Per-forum thread-list bump
		// for every affected forum; one summary bump; digest bump if any
		// deleted thread had digest > 0.
		const hadDigestBatch = threadRows.some((t) => t.digest > 0);
		const affectedForumIds = Array.from(forumThreadCounts.keys());
		const tailOps: Promise<unknown>[] = [
			batchDecrementUserPosts(env, authorCounts),
			...Array.from(threadAuthorCounts, ([authorId, count]) =>
				decrementUserThreads(env, authorId, count),
			),
			...Array.from(forumThreadCounts.keys(), (forumId) => recalcForumMetadata(env, forumId)),
			invalidateThreadListForForums(env, affectedForumIds),
			bumpForumSummaryGen(env),
			writeAdminLog(env, resolveActor(request, env), {
				action: "thread.batch_delete",
				targetType: "thread",
				targetId: null,
				details: { ids: existingIds, count: existingIds.length },
			}),
		];
		if (hadDigestBatch) tailOps.push(bumpDigestGen(env));
		await Promise.all(tailOps);

		return jsonResponse({ deleted: true, count: existingIds.length }, origin);
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

		// Validate target forum + fetch source threads in parallel — they're
		// independent reads.
		const placeholders = ids.map(() => "?").join(",");
		const [targetForum, threads] = await Promise.all([
			env.DB.prepare("SELECT id FROM forums WHERE id = ?").bind(targetForumId).first(),
			env.DB.prepare(`SELECT id, forum_id, replies FROM threads WHERE id IN (${placeholders})`)
				.bind(...ids)
				.all(),
		]);

		if (!targetForum) {
			return errorResponse("INVALID_BODY", 400, { message: "Target forum not found" }, origin);
		}

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

		// Recalc metadata for all affected forums (old ones + target) in parallel.
		await Promise.all([
			...Array.from(forumAdjustments.keys(), (forumId) => recalcForumMetadata(env, forumId)),
			recalcForumMetadata(env, targetForumId),
		]);
		// Per-forum thread-list bumps for every source forum + the target,
		// plus a single summary bump.
		const movedForumIds = [...forumAdjustments.keys(), targetForumId];
		await Promise.all([
			invalidateThreadListForForums(env, movedForumIds),
			bumpForumSummaryGen(env),
		]);

		// F3-b: audit one row for the entire successful batch. fromForumIds
		// is deduped (Map keys) so multi-source batches are searchable.
		const movedIds = movable.map((t) => t.id);
		const fromForumIds = Array.from(forumAdjustments.keys());
		await writeAdminLog(env, resolveActor(request, env), {
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
