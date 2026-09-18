// Admin thread handlers — CRUD framework implementation
// Endpoints #25-#30: list, getById, update, delete, batch-delete, batch-move

import { withEntityAuth } from "../../lib/adminHelpers";
import { resolveActor, writeAdminLog } from "../../lib/adminLog";
import { invalidateAdminEntityCache } from "../../lib/cache/admin-entity-read";
import {
	bumpDigestGen,
	bumpForumSummaryGen,
	bumpPostListGen,
	bumpThreadListGenAll,
	bumpThreadMetaGen,
	invalidateForumVolatileV2,
	invalidateThreadListForForums,
	invalidateThreadReading,
} from "../../lib/cache/invalidate";
import { buildDeleteThreadChildStatements } from "../../lib/contentDelete";
import type { EntityConfig } from "../../lib/crud";
import { createGetByIdHandler, createListHandler, createUpdateHandler } from "../../lib/crud";
import { confirmedBatch, confirmedRun } from "../../lib/d1-write";
import type { Env } from "../../lib/env";
import { toThread } from "../../lib/mappers";
import { parseIdFromPath } from "../../lib/parseId";
import { buildContentRecalcStatements, recalcForumMetadata } from "../../lib/recalcMetadata";
import { jsonNoStoreResponse } from "../../lib/response";
import { buildUserCounterDecrementStatements } from "../../lib/userCounters";
import { STICKY_FORUM, STICKY_GLOBAL } from "../../lib/visibility";
import { errorResponse } from "../../middleware/error";
import { invalidateRecommendedCache } from "../recommended";

// ─── Entity config ───────────────────────────────────────────────

// Read maintained metadata without recounting replies for every displayed row.
// Explicit recalculation and mutation guards still read authoritative records.
const THREAD_COLUMNS = [
	"id",
	"forum_id",
	"author_id",
	"author_name",
	"subject",
	"created_at",
	"last_post_at",
	"last_poster",
	"last_poster_id",
	"replies",
	"views",
	"closed",
	"sticky",
	"digest",
	"special",
	"highlight",
	"recommends",
	"type_name",
].join(", ");

async function demoteOtherGlobalThreads(env: Env, id: number) {
	const others = await env.DB.prepare(
		`SELECT id, forum_id FROM threads WHERE sticky = ${STICKY_GLOBAL} AND id != ?`,
	)
		.bind(id)
		.all<{ id: number; forum_id: number }>();
	if (!others.success) throw new Error("Global thread query failed");
	if (others.results.length) {
		await confirmedRun(
			env.DB.prepare(
				`UPDATE threads SET sticky = ${STICKY_FORUM} WHERE sticky = ${STICKY_GLOBAL} AND id != ?`,
			).bind(id),
		);
	}
	return others.results;
}

function affectsDigest(previous: unknown, next: unknown, demotedCount: number): boolean {
	return (
		(next !== undefined && next !== previous) ||
		Number(previous) > 0 ||
		Number(next) > 0 ||
		demotedCount > 0
	);
}

const threadConfig: EntityConfig = {
	table: "threads",
	entityName: "THREAD",
	auth: "moderator",
	columns: THREAD_COLUMNS,
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
		{ param: "createdAt", column: "created_at", type: "range", rangeIndex: "idx_threads_created" },
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
		if (Object.keys(data).every((field) => data[field] === existing[field])) return;
		// Move side effects: update posts' forum_id and adjust forum counts
		const movedForum = data.forum_id !== undefined && data.forum_id !== existing.forum_id;
		if (movedForum) {
			const oldForumId = existing.forum_id as number;
			const newForumId = data.forum_id as number;
			const replies = existing.replies as number;
			const postCount = replies + 1;

			// Move thread + posts, adjust forum counts.
			// Also drop any forum_recommended_threads row — a recommendation is
			// per-forum and the thread is leaving the source forum.
			await confirmedBatch(env, [
				env.DB.prepare("UPDATE posts SET forum_id = ? WHERE thread_id = ?").bind(newForumId, id),
				env.DB.prepare(
					"UPDATE forums SET threads = threads - 1, posts = posts - ? WHERE id = ?",
				).bind(postCount, oldForumId),
				env.DB.prepare(
					"UPDATE forums SET threads = threads + 1, posts = posts + ? WHERE id = ?",
				).bind(postCount, newForumId),
				env.DB.prepare("DELETE FROM forum_recommended_threads WHERE thread_id = ?").bind(id),
			]);

			// Recalc metadata for both old and new forums (independent — parallel)
			await Promise.all([
				recalcForumMetadata(env, oldForumId),
				recalcForumMetadata(env, newForumId),
			]);
		}

		// Sticky singleton enforcement: at most ONE thread can be sticky=global
		// site-wide. When this update promotes a thread to global, demote any
		// other existing globals to forum-pinned. Mirrors the moderation
		// handler's behavior so both write paths converge on the same invariant.
		// `data.sticky` is already coerced to a number by validateAndCollectFields.
		const newSticky = data.sticky as number | undefined;
		const prevSticky = existing.sticky as number;
		const promotedToGlobal = newSticky === STICKY_GLOBAL && prevSticky !== STICKY_GLOBAL;
		const demotedFromGlobal =
			newSticky !== undefined && newSticky !== STICKY_GLOBAL && prevSticky === STICKY_GLOBAL;
		const demotedThreads = promotedToGlobal ? await demoteOtherGlobalThreads(env, id) : [];

		const currentForumId = (data.forum_id ?? existing.forum_id) as number;
		const forumIds = [
			...new Set([
				existing.forum_id as number,
				currentForumId,
				...demotedThreads.map((t) => t.forum_id),
			]),
		];
		const restored = newSticky !== undefined && prevSticky < 0 && newSticky >= 0;
		if (restored) {
			await confirmedBatch(env, buildContentRecalcStatements(env, [id], forumIds));
		}
		const membershipChanged = movedForum || (newSticky !== undefined && newSticky !== prevSticky);
		const digestChanged = data.digest !== undefined && data.digest !== (existing.digest as number);
		const subjectChanged =
			data.subject !== undefined && data.subject !== (existing.subject as string);
		if (subjectChanged && !movedForum && !restored) await recalcForumMetadata(env, currentForumId);
		const globalTransition =
			promotedToGlobal || demotedFromGlobal || (movedForum && prevSticky === STICKY_GLOBAL);

		// Membership contains IDs/order only. Stable field edits refresh the
		// shared entity; moves/restores also replace every child body/asset key.
		const ops: Promise<unknown>[] = [
			invalidateThreadReading(env, [id, ...demotedThreads.map((thread) => thread.id)]),
			...forumIds.map((forumId) => invalidateRecommendedCache(env, forumId)),
		];
		if (membershipChanged) ops.push(invalidateThreadListForForums(env, forumIds));
		if (movedForum || restored)
			ops.push(bumpPostListGen(env, id), invalidateAdminEntityCache(env, "posts"));
		if (movedForum || restored || subjectChanged)
			ops.push(bumpForumSummaryGen(env), invalidateAdminEntityCache(env, "forums"));
		if (digestChanged) ops.push(invalidateAdminEntityCache(env, "users"));
		if (globalTransition) ops.push(bumpThreadListGenAll(env));
		if (affectsDigest(existing.digest, data.digest, demotedThreads.length)) {
			ops.push(bumpDigestGen(env));
		}
		await Promise.all(ops);
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
			sticky: number;
		};

		// Query post authors before deletion for user counter updates. The total
		// post count for the thread is just the sum of these per-author counts,
		// so we can skip the separate `SELECT COUNT(*)` round-trip.
		const postAuthors = await env.DB.prepare(
			"SELECT author_id, COUNT(*) as cnt FROM posts WHERE thread_id = ? GROUP BY author_id",
		)
			.bind(id)
			.all();
		if (!postAuthors.success) throw new Error("Thread deletion author query failed");
		const authorCounts = new Map<number, number>();
		let postsDeleted = 0;
		for (const row of postAuthors.results as { author_id: number; cnt: number }[]) {
			authorCounts.set(row.author_id, row.cnt);
			postsDeleted += row.cnt;
		}

		await confirmedBatch(env, [
			...buildDeleteThreadChildStatements(env, [id]),
			env.DB.prepare("DELETE FROM posts WHERE thread_id = ?").bind(id),
			env.DB.prepare("DELETE FROM threads WHERE id = ?").bind(id),
			...buildContentRecalcStatements(env, [], [threadRow.forum_id]),
			...buildUserCounterDecrementStatements(env, authorCounts),
			...buildUserCounterDecrementStatements(env, new Map([[threadRow.author_id, 1]]), "threads"),
			...buildUserCounterDecrementStatements(
				env,
				threadRow.digest > 0 ? new Map([[threadRow.author_id, 1]]) : new Map(),
				"digest_posts",
			),
		]);
		const tail: Promise<unknown>[] = [
			...["threads", "posts", "forums", "users", "attachments"].map((resource) =>
				invalidateAdminEntityCache(env, resource),
			),
			bumpThreadMetaGen(env, id),
			bumpPostListGen(env, id),
			invalidateForumVolatileV2(env, threadRow.forum_id),
			invalidateRecommendedCache(env, threadRow.forum_id),
		];
		if (threadRow.digest > 0) tail.push(bumpDigestGen(env));
		if (threadRow.sticky === STICKY_GLOBAL) tail.push(bumpThreadListGenAll(env));
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

		return jsonNoStoreResponse({ deleted: true, id, postsDeleted }, origin);
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
		const threads = await env.DB.prepare(
			`SELECT id, forum_id, author_id, digest, sticky FROM threads WHERE id IN (${placeholders})`,
		)
			.bind(...numericIds)
			.all<{ id: number; forum_id: number; author_id: number; digest: number; sticky: number }>();
		if (!threads.success) throw new Error("Thread deletion snapshot failed");
		const threadRows = threads.results;

		if (threadRows.length === 0) {
			return jsonNoStoreResponse({ deleted: true, count: 0 }, origin);
		}

		const existingIds = threadRows.map((t) => t.id);
		const idsJson = JSON.stringify(existingIds);
		const postAuthors = await env.DB.prepare(
			"SELECT thread_id, author_id, COUNT(*) as cnt FROM posts WHERE thread_id IN (SELECT value FROM json_each(?)) GROUP BY thread_id, author_id",
		)
			.bind(idsJson)
			.all<{ thread_id: number; author_id: number; cnt: number }>();
		if (!postAuthors.success) throw new Error("Thread deletion author query failed");
		const authorCounts = new Map<number, number>();
		for (const row of postAuthors.results)
			authorCounts.set(row.author_id, (authorCounts.get(row.author_id) ?? 0) + row.cnt);
		const threadAuthorCounts = new Map<number, number>();
		const digestAuthorCounts = new Map<number, number>();
		for (const thread of threadRows) {
			threadAuthorCounts.set(thread.author_id, (threadAuthorCounts.get(thread.author_id) ?? 0) + 1);
			if (thread.digest > 0)
				digestAuthorCounts.set(
					thread.author_id,
					(digestAuthorCounts.get(thread.author_id) ?? 0) + 1,
				);
		}
		const affectedForumIds = [...new Set(threadRows.map((t) => t.forum_id))];
		await confirmedBatch(env, [
			...buildDeleteThreadChildStatements(env, existingIds),
			env.DB.prepare("DELETE FROM posts WHERE thread_id IN (SELECT value FROM json_each(?))").bind(
				idsJson,
			),
			env.DB.prepare("DELETE FROM threads WHERE id IN (SELECT value FROM json_each(?))").bind(
				idsJson,
			),
			...buildContentRecalcStatements(env, [], affectedForumIds),
			...buildUserCounterDecrementStatements(env, authorCounts),
			...buildUserCounterDecrementStatements(env, threadAuthorCounts, "threads"),
			...buildUserCounterDecrementStatements(env, digestAuthorCounts, "digest_posts"),
		]);

		const hadDigestBatch = threadRows.some((t) => t.digest > 0);
		const tailOps: Promise<unknown>[] = [
			...["threads", "posts", "forums", "users", "attachments"].map((resource) =>
				invalidateAdminEntityCache(env, resource),
			),
			invalidateThreadReading(env, existingIds, { posts: true }),
			invalidateThreadListForForums(env, affectedForumIds),
			bumpForumSummaryGen(env),
			...affectedForumIds.map((forumId) => invalidateRecommendedCache(env, forumId)),
			writeAdminLog(env, resolveActor(request, env), {
				action: "thread.batch_delete",
				targetType: "thread",
				targetId: null,
				details: { ids: existingIds, count: existingIds.length },
			}),
		];
		if (hadDigestBatch) tailOps.push(bumpDigestGen(env));
		if (threadRows.some((t) => t.sticky === STICKY_GLOBAL)) tailOps.push(bumpThreadListGenAll(env));
		await Promise.all(tailOps);

		return jsonNoStoreResponse({ deleted: true, count: existingIds.length }, origin);
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
			env.DB.prepare(
				`SELECT id, forum_id, replies, sticky, digest FROM threads WHERE id IN (${placeholders})`,
			)
				.bind(...ids)
				.all(),
		]);

		if (!targetForum) {
			return errorResponse("INVALID_BODY", 400, { message: "Target forum not found" }, origin);
		}

		if (!threads.success) throw new Error("Thread move snapshot failed");
		const threadRows = threads.results as {
			id: number;
			forum_id: number;
			replies: number;
			sticky: number;
			digest: number;
		}[];
		if (threadRows.length === 0) {
			return jsonNoStoreResponse({ moved: true, count: 0, forumId: targetForumId }, origin);
		}

		// Filter out threads already in the target forum
		const movable = threadRows.filter((t) => t.forum_id !== targetForumId);
		if (movable.length === 0) {
			return jsonNoStoreResponse({ moved: true, count: 0, forumId: targetForumId }, origin);
		}

		const sourceForumIds = [...new Set(movable.map((t) => t.forum_id))];
		const movedForumIds = [...sourceForumIds, targetForumId];
		const movedIdsJson = JSON.stringify(movable.map((t) => t.id));
		await confirmedBatch(env, [
			env.DB.prepare(
				"UPDATE threads SET forum_id = ? WHERE id IN (SELECT value FROM json_each(?))",
			).bind(targetForumId, movedIdsJson),
			env.DB.prepare(
				"UPDATE posts SET forum_id = ? WHERE thread_id IN (SELECT value FROM json_each(?))",
			).bind(targetForumId, movedIdsJson),
			env.DB.prepare(
				"DELETE FROM forum_recommended_threads WHERE thread_id IN (SELECT value FROM json_each(?))",
			).bind(movedIdsJson),
			...buildContentRecalcStatements(env, [], movedForumIds),
		]);

		const invalidations: Promise<unknown>[] = [
			...["threads", "posts", "forums"].map((resource) =>
				invalidateAdminEntityCache(env, resource),
			),
			invalidateThreadReading(
				env,
				movable.map((thread) => thread.id),
				{ posts: true },
			),
			invalidateThreadListForForums(env, movedForumIds),
			bumpForumSummaryGen(env),
			...movedForumIds.map((forumId) => invalidateRecommendedCache(env, forumId)),
		];
		if (movable.some((t) => t.digest > 0)) invalidations.push(bumpDigestGen(env));
		if (movable.some((t) => t.sticky === STICKY_GLOBAL))
			invalidations.push(bumpThreadListGenAll(env));
		await Promise.all(invalidations);

		// F3-b: audit one row for the entire successful batch. fromForumIds
		// is deduped (Map keys) so multi-source batches are searchable.
		const movedIds = movable.map((t) => t.id);
		const fromForumIds = sourceForumIds;
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

		return jsonNoStoreResponse(
			{ moved: true, count: movable.length, forumId: targetForumId },
			origin,
		);
	},
);
