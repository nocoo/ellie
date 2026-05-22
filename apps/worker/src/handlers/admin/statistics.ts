// Admin statistics handlers — recalculate denormalized counters
// Provides endpoints to fix stale data from migrations or deletions.

import { withEntityAuth } from "../../lib/adminHelpers";
import {
	bumpForumSummaryGen,
	bumpThreadListGen,
	bumpThreadListGenAll,
	invalidateUserCaches,
} from "../../lib/cache/invalidate";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonNoStoreResponse } from "../../lib/response";
import {
	STATS_JOB_KINDS,
	type StatsJobKind,
	type StatsJobPayload,
	type StatsJobTicker,
	type TickResult,
	makeInitialPayload,
	readJob,
	tickJob,
} from "../../lib/stats-job";
import { invalidateUserCache } from "../../lib/user-cache";
import { errorResponse } from "../../middleware/error";

// Dummy config for auth — statistics endpoints require admin role
const statsConfig: EntityConfig = {
	table: "forums",
	entityName: "STATISTICS",
	auth: "admin",
	columns: "id",
	mapper: (row) => row,
	notFoundCode: "NOT_FOUND",
};

// D1 has a hard limit of 999 bound parameters per prepared statement.
// IN_CHUNK keeps every per-batch aggregate query comfortably under that
// limit even when `batchSize` is bumped to 1000+ in a later iteration.
// 500 lets us run the per-batch aggregate as at most 2 SQL calls when
// batchSize is at the default 1000.
const IN_CHUNK = 500;
const BATCH_SIZE = 500;

// ─── Shared utility — parse JSON body & route TickResult ─────────────────────

/**
 * Parse the request body once for every POST that drives a job. We accept
 * empty bodies (no `Content-Type`, no payload) so the admin UI's "start"
 * button can fire a body-less POST. Invalid JSON yields `null` so the
 * caller can return 400.
 */
async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
	const text = await request.text();
	if (!text) return {};
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		// JSON primitives / arrays aren't a valid body shape here.
		return null;
	} catch {
		return null;
	}
}

/**
 * Translate a `TickResult` into an HTTP response.
 *
 * Code → status:
 *   - `ok`       → 200, body = payload (full snapshot)
 *   - `locked`   → 409 `CONCURRENT_TICK` — another in-flight advance.
 *   - `running`  → 409 `RUNNING_JOB_EXISTS` — `reset:true` refused on a
 *                  live job.
 *   - `error`    → 500 `RECALC_FAILED` — `advance` threw; payload contains
 *                  the failed state and `error` carries the message.
 *
 * The full payload travels in `details` for the two 409s so the admin UI
 * can keep the card in sync without re-polling.
 */
function tickResultToResponse(result: TickResult, origin: string | undefined): Response {
	switch (result.code) {
		case "ok":
			return jsonNoStoreResponse(result.payload, origin);
		case "locked":
			return errorResponse(
				"CONCURRENT_TICK",
				409,
				{ payload: result.payload as unknown as Record<string, unknown> },
				origin,
			);
		case "running":
			return errorResponse(
				"RUNNING_JOB_EXISTS",
				409,
				{ payload: result.payload as unknown as Record<string, unknown> },
				origin,
			);
		case "error":
			return errorResponse(
				"RECALC_FAILED",
				500,
				{
					error: result.error,
					payload: result.payload as unknown as Record<string, unknown>,
				},
				origin,
			);
	}
}

// ─── POST /api/admin/statistics/recalc-forums ────────────────────────────────
// Job-mode driver — one POST advances ONE batch of forums (cursor =
// forums.id ORDER BY id LIMIT batchSize). Replaces the legacy "one-shot
// {updated}" handler (msg=b7eda60a). The framework in lib/stats-job.ts
// owns lease/reset/done semantics; this file only supplies the ticker
// (initialize + advance + finalize) that knows the SQL shape.
//
// Per-tick SQL plan (mirrors Phase B threads, but batch-scoped to
// forums.id rather than threads.id):
//   1. Page through forums by id — `WHERE id > ? ORDER BY id LIMIT
//      batchSize` so each batch lands a fresh slab; cursor advances
//      monotonically.
//   2. Thread counts (batch-scoped) — `WHERE forum_id IN (...)
//      GROUP BY forum_id` in IN_CHUNK chunks; no global GROUP BY scan.
//   3. Post counts (batch-scoped)   — same shape against posts.
//   4. Last thread per forum (batch-scoped) — `WHERE forum_id IN (...)`
//      then `ROW_NUMBER() OVER (PARTITION BY forum_id ORDER BY
//      last_post_at DESC, id DESC)` and keep `rn=1`. Window scope = the
//      batch only; no global self-join.
//   5. Batched UPDATE — one D1 batch per chunk of BATCH_SIZE.
//
// `done` transition handles cache invalidation in `finalize` (runs
// outside the lease so a slow KV bump can't strand the lease). Cache
// bump is gated on `updated > 0` so initialize-only / empty-table runs
// don't churn the summary cache.

interface ForumBatchRow {
	id: number;
}

interface ForumCountRow {
	forum_id: number;
	cnt: number;
}

interface ForumLastThreadRow {
	forum_id: number;
	id: number;
	subject: string;
	last_post_at: number;
	last_poster: string;
	last_poster_id: number;
}

async function fetchForumCounts(
	env: Env,
	forumIds: number[],
	sqlForChunk: (placeholders: string) => string,
): Promise<Map<number, number>> {
	const map = new Map<number, number>();
	for (const chunk of chunkIds(forumIds)) {
		if (chunk.length === 0) continue;
		const placeholders = chunk.map(() => "?").join(",");
		const result = await env.DB.prepare(sqlForChunk(placeholders))
			.bind(...chunk)
			.all();
		for (const row of result.results as unknown as ForumCountRow[]) {
			map.set(row.forum_id, row.cnt);
		}
	}
	return map;
}

async function fetchForumLastThreads(
	env: Env,
	forumIds: number[],
): Promise<Map<number, ForumLastThreadRow>> {
	const map = new Map<number, ForumLastThreadRow>();
	for (const chunk of chunkIds(forumIds)) {
		if (chunk.length === 0) continue;
		const placeholders = chunk.map(() => "?").join(",");
		// Window function scoped to the IN (...) batch only. Tiebreak on
		// `id DESC` so the result is deterministic when two threads share
		// the same `last_post_at` (legacy seed rows).
		const sql = `
			SELECT forum_id, id, subject, last_post_at, last_poster, last_poster_id FROM (
				SELECT
					forum_id,
					id,
					subject,
					last_post_at,
					last_poster,
					last_poster_id,
					ROW_NUMBER() OVER (
						PARTITION BY forum_id
						ORDER BY last_post_at DESC, id DESC
					) AS rn
				FROM threads
				WHERE forum_id IN (${placeholders})
			)
			WHERE rn = 1
		`;
		const result = await env.DB.prepare(sql)
			.bind(...chunk)
			.all();
		for (const row of result.results as unknown as ForumLastThreadRow[]) {
			map.set(row.forum_id, row);
		}
	}
	return map;
}

export const forumsTicker: StatsJobTicker = {
	kind: "forums",
	initialize: async (env) => {
		const row = await env.DB.prepare("SELECT COUNT(*) as cnt FROM forums").first<{
			cnt: number;
		}>();
		const total = row?.cnt ?? 0;
		return makeInitialPayload({ kind: "forums", total, params: {} });
	},

	advance: async (env, prev) => {
		const batchSize = prev.batchSize;
		const now = Date.now();

		// (1) Pull the next slab of forums by `id > cursor`.
		const forumsResult = await env.DB.prepare(
			"SELECT id FROM forums WHERE id > ? ORDER BY id LIMIT ?",
		)
			.bind(prev.cursor, batchSize)
			.all();
		const batch = forumsResult.results as unknown as ForumBatchRow[];

		// Empty batch = nothing left to do; mark done. Phase C.1 contract:
		// `processed` stays at the real walked count, `total` renormalises
		// to processed so the UI denominator equals the numerator.
		if (batch.length === 0) {
			return {
				...prev,
				status: "done",
				total: prev.processed,
				lastBatchUpdated: 0,
				finishedAt: now,
				lastTickAt: now,
			};
		}

		const forumIds = batch.map((f) => f.id);

		// (2) + (3) + (4) Batch-scoped aggregates via IN (...) chunks.
		const [threadMap, postMap, lastThreadMap] = await Promise.all([
			fetchForumCounts(
				env,
				forumIds,
				(placeholders) =>
					`SELECT forum_id, COUNT(*) as cnt FROM threads WHERE forum_id IN (${placeholders}) GROUP BY forum_id`,
			),
			fetchForumCounts(
				env,
				forumIds,
				(placeholders) =>
					`SELECT forum_id, COUNT(*) as cnt FROM posts WHERE forum_id IN (${placeholders}) GROUP BY forum_id`,
			),
			fetchForumLastThreads(env, forumIds),
		]);

		// (5) Batched UPDATE — chunk into D1 batches of 500 statements
		// to stay within the runtime's batch-statement ceiling.
		const statements = batch.map((forum) => {
			const lastThread = lastThreadMap.get(forum.id);
			return env.DB.prepare(
				`UPDATE forums SET
					threads = ?,
					posts = ?,
					last_thread_id = ?,
					last_post_at = ?,
					last_poster = ?,
					last_poster_id = ?,
					last_thread_subject = ?
				WHERE id = ?`,
			).bind(
				threadMap.get(forum.id) ?? 0,
				postMap.get(forum.id) ?? 0,
				lastThread?.id ?? 0,
				lastThread?.last_post_at ?? 0,
				lastThread?.last_poster ?? "",
				lastThread?.last_poster_id ?? 0,
				lastThread?.subject ?? "",
				forum.id,
			);
		});
		for (let i = 0; i < statements.length; i += BATCH_SIZE) {
			await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
		}

		const nextCursor = batch[batch.length - 1]?.id ?? prev.cursor;
		const newProcessed = prev.processed + batch.length;
		const isFinal = batch.length < batchSize;

		return {
			...prev,
			cursor: nextCursor,
			processed: newProcessed,
			total: isFinal ? newProcessed : prev.total,
			updated: prev.updated + batch.length,
			lastBatchUpdated: batch.length,
			status: isFinal ? "done" : "running",
			finishedAt: isFinal ? now : null,
			lastTickAt: now,
		};
	},

	finalize: async (env, payload) => {
		// Cache invalidation (docs/19 §6 row "admin statistics
		// recalc-forums"): bump forum:summary:gen only when the sweep
		// actually rewrote at least one forum row. A no-op sweep (empty
		// forums table) has no side effects.
		if (payload.updated > 0) {
			await bumpForumSummaryGen(env);
		}
	},
};

export const recalcForums = withEntityAuth(
	statsConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const body = await readJsonBody(request);
		if (body === null) {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}
		const result = await tickJob(env, forumsTicker, body);
		return tickResultToResponse(result, origin);
	},
);

// ─── POST /api/admin/statistics/recalc-threads ───────────────────────────────
// Job-mode driver — one POST advances ONE batch of `DEFAULT_BATCH_SIZE`
// threads (cursor = threads.id). The framework in lib/stats-job.ts owns
// lease/reset/done semantics; this file only supplies the ticker
// (initialize + advance + finalize) that knows the SQL shape.
//
// Per-tick SQL plan (Phase B, reviewer-approved msg=f316ea10):
//   1. Page through threads by id   — `WHERE [forum_id=?] AND id > ?
//                                      ORDER BY id LIMIT batchSize`
//      so each batch lands a fresh slab of rows; cursor advances
//      monotonically; nothing depends on a full table scan.
//   2. Reply counts (batch-scoped)  — `WHERE thread_id IN (...)` in
//      chunks of IN_CHUNK so we never breach D1's 999-param ceiling.
//   3. Last post (batch-scoped)     — same `IN (...)` filter, then
//      `ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at
//      DESC, id DESC)` and keep `rn=1`. Window scope = the batch only;
//      no global self-join on `posts`.
//   4. Batched UPDATE              — one D1 batch per chunk of 500.
//
// `done` transition handles cache invalidation in `finalize` (runs
// outside the lease so a slow KV bump can't strand the lease).

interface RecalcThreadsParams {
	forumId: number | null;
}

function parseRecalcThreadsParams(body: Record<string, unknown>): RecalcThreadsParams {
	const raw = body.forumId;
	if (typeof raw === "number" && Number.isFinite(raw) && raw > 0 && Number.isInteger(raw)) {
		return { forumId: raw };
	}
	return { forumId: null };
}

function readRecalcThreadsParams(payload: StatsJobPayload): RecalcThreadsParams {
	const raw = (payload.params as { forumId?: unknown }).forumId;
	return typeof raw === "number" && raw > 0 ? { forumId: raw } : { forumId: null };
}

/**
 * Chunk an array of ids into IN-list batches that stay under the D1
 * 999-parameter ceiling. Returns the chunks unchanged when ≤ IN_CHUNK.
 */
function chunkIds<T>(ids: T[], size: number = IN_CHUNK): T[][] {
	if (ids.length <= size) return [ids];
	const out: T[][] = [];
	for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
	return out;
}

interface ThreadBatchRow {
	id: number;
	created_at: number;
	author_name: string;
	author_id: number;
}

interface ReplyCountRow {
	thread_id: number;
	cnt: number;
}

interface LastPostRow {
	thread_id: number;
	created_at: number;
	author_name: string;
	author_id: number;
}

async function fetchReplyCounts(env: Env, threadIds: number[]): Promise<Map<number, number>> {
	const map = new Map<number, number>();
	for (const chunk of chunkIds(threadIds)) {
		if (chunk.length === 0) continue;
		const placeholders = chunk.map(() => "?").join(",");
		const sql = `SELECT thread_id, COUNT(*) - 1 as cnt FROM posts WHERE thread_id IN (${placeholders}) GROUP BY thread_id`;
		const result = await env.DB.prepare(sql)
			.bind(...chunk)
			.all();
		for (const row of result.results as unknown as ReplyCountRow[]) {
			map.set(row.thread_id, Math.max(0, row.cnt));
		}
	}
	return map;
}

async function fetchLastPosts(env: Env, threadIds: number[]): Promise<Map<number, LastPostRow>> {
	const map = new Map<number, LastPostRow>();
	for (const chunk of chunkIds(threadIds)) {
		if (chunk.length === 0) continue;
		const placeholders = chunk.map(() => "?").join(",");
		// Window function scoped to the IN (...) batch only. Tiebreak on
		// `id DESC` for posts with identical `created_at` (legacy seed
		// rows) so the result is deterministic.
		const sql = `
			SELECT thread_id, created_at, author_name, author_id FROM (
				SELECT
					thread_id,
					created_at,
					author_name,
					author_id,
					ROW_NUMBER() OVER (
						PARTITION BY thread_id
						ORDER BY created_at DESC, id DESC
					) AS rn
				FROM posts
				WHERE thread_id IN (${placeholders})
			)
			WHERE rn = 1
		`;
		const result = await env.DB.prepare(sql)
			.bind(...chunk)
			.all();
		for (const row of result.results as unknown as LastPostRow[]) {
			map.set(row.thread_id, row);
		}
	}
	return map;
}

export const threadsTicker: StatsJobTicker = {
	kind: "threads",
	initialize: async (env, body) => {
		const params = parseRecalcThreadsParams(body);
		// total is best-effort — a single COUNT(*) is O(rows-in-scope)
		// in SQLite but runs once per job (not per tick).
		let total: number;
		if (params.forumId !== null) {
			const row = await env.DB.prepare("SELECT COUNT(*) as cnt FROM threads WHERE forum_id = ?")
				.bind(params.forumId)
				.first<{ cnt: number }>();
			total = row?.cnt ?? 0;
		} else {
			const row = await env.DB.prepare("SELECT COUNT(*) as cnt FROM threads").first<{
				cnt: number;
			}>();
			total = row?.cnt ?? 0;
		}
		return makeInitialPayload({
			kind: "threads",
			total,
			params: { forumId: params.forumId },
		});
	},

	advance: async (env, prev) => {
		const params = readRecalcThreadsParams(prev);
		const batchSize = prev.batchSize;
		const now = Date.now();

		// (1) Pull the next slab of threads by `id > cursor`.
		let threadsResult: D1Result;
		if (params.forumId !== null) {
			threadsResult = await env.DB.prepare(
				"SELECT id, created_at, author_name, author_id FROM threads WHERE forum_id = ? AND id > ? ORDER BY id LIMIT ?",
			)
				.bind(params.forumId, prev.cursor, batchSize)
				.all();
		} else {
			threadsResult = await env.DB.prepare(
				"SELECT id, created_at, author_name, author_id FROM threads WHERE id > ? ORDER BY id LIMIT ?",
			)
				.bind(prev.cursor, batchSize)
				.all();
		}
		const batch = threadsResult.results as ThreadBatchRow[];

		// Empty batch = nothing left to do; mark done. `processed` is the
		// real count of rows we walked past during this job — neither
		// `total` (best-effort estimate captured at initialize, may drift
		// either way) nor anything else should mutate it on the terminal
		// transition. On done we renormalize `total = processed` so the
		// UI denominator equals the numerator (100% without overshoot).
		// See reviewer note msg=b43a2bc9 (Phase C.1).
		if (batch.length === 0) {
			return {
				...prev,
				status: "done",
				total: prev.processed,
				lastBatchUpdated: 0,
				finishedAt: now,
				lastTickAt: now,
			};
		}

		const threadIds = batch.map((t) => t.id);

		// (2) + (3) Batch-scoped aggregates via IN (...) chunks.
		const [replyMap, lastPostMap] = await Promise.all([
			fetchReplyCounts(env, threadIds),
			fetchLastPosts(env, threadIds),
		]);

		// (4) Batched UPDATE — chunk into D1 batches of 500 statements
		// to stay within the runtime's batch-statement ceiling.
		const statements = batch.map((thread) => {
			const lastPost = lastPostMap.get(thread.id);
			const lastPostAt = lastPost?.created_at ?? thread.created_at;
			const lastPoster = lastPost?.author_name ?? thread.author_name;
			const lastPosterId = lastPost?.author_id ?? thread.author_id;
			return env.DB.prepare(
				"UPDATE threads SET replies = ?, last_post_at = ?, last_poster = ?, last_poster_id = ? WHERE id = ?",
			).bind(replyMap.get(thread.id) ?? 0, lastPostAt, lastPoster, lastPosterId, thread.id);
		});
		for (let i = 0; i < statements.length; i += BATCH_SIZE) {
			await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
		}

		const nextCursor = batch[batch.length - 1]?.id ?? prev.cursor;
		const newProcessed = prev.processed + batch.length;
		const isFinal = batch.length < batchSize;
		// Phase C.1: on the terminal short batch, `processed` is the real
		// walked count (newProcessed). `total` is renormalized to
		// newProcessed so the UI denominator equals the numerator. Mid-run
		// ticks (non-terminal) keep `total` as the initialize estimate so
		// the card can still render a percentage while running.

		return {
			...prev,
			cursor: nextCursor,
			processed: newProcessed,
			total: isFinal ? newProcessed : prev.total,
			updated: prev.updated + batch.length,
			lastBatchUpdated: batch.length,
			status: isFinal ? "done" : "running",
			finishedAt: isFinal ? now : null,
			lastTickAt: now,
		};
	},

	finalize: async (env, payload) => {
		// Cache invalidation (docs/19 §6 row "admin statistics
		// recalc-threads"): bump forum:summary:gen (last-post / counts
		// may have shifted as a side-effect of recalculating thread
		// last-post). For thread:list:v2, bump per-forum gen when
		// scoped to a single forum, else fall back to the global
		// `thread:list:gen:all`.
		const params = readRecalcThreadsParams(payload);
		await Promise.all([
			bumpForumSummaryGen(env),
			params.forumId !== null ? bumpThreadListGen(env, params.forumId) : bumpThreadListGenAll(env),
		]);
	},
};

export const recalcThreads = withEntityAuth(
	statsConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const body = await readJsonBody(request);
		if (body === null) {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}
		const result = await tickJob(env, threadsTicker, body);
		return tickResultToResponse(result, origin);
	},
);

// ─── POST /api/admin/statistics/recalc-users ─────────────────────────────────
// Job-mode driver — one POST advances ONE batch of active users (cursor =
// users.id ORDER BY id LIMIT batchSize). Per reviewer msg=8ad628d5:
//   - No `body.ids` scope. Phase C only supports full active sweep so we
//     never have to persist an unbounded id list in KV. Small-range manual
//     fixes can use single-user admin endpoints.
//   - Cache invalidation runs INSIDE each successful advance (after the D1
//     UPDATE), chunked at KV_CHUNK=50 — finalize cannot know which user
//     ids each batch touched without round-tripping them through KV.
//   - Per-batch aggregates use `author_id IN (...) GROUP BY author_id` in
//     IN_CHUNK=500 chunks to stay under D1's 999-param ceiling. No
//     per-user N+1 queries; no full-table GROUP BY scans.
//   - If KV invalidate throws, let it bubble — tickJob marks the job as
//     `error` and cursor does not advance; the next POST retries the
//     same batch with the same checkpointed cursor (idempotent UPDATE).

const KV_CHUNK = 50;

interface UserBatchRow {
	id: number;
}

interface UserCountRow {
	author_id: number;
	cnt: number;
}

async function fetchUserCounts(
	env: Env,
	userIds: number[],
	sqlForChunk: (placeholders: string) => string,
): Promise<Map<number, number>> {
	const map = new Map<number, number>();
	for (const chunk of chunkIds(userIds)) {
		if (chunk.length === 0) continue;
		const placeholders = chunk.map(() => "?").join(",");
		const result = await env.DB.prepare(sqlForChunk(placeholders))
			.bind(...chunk)
			.all();
		for (const row of result.results as unknown as UserCountRow[]) {
			map.set(row.author_id, row.cnt);
		}
	}
	return map;
}

async function invalidateUsersChunked(env: Env, userIds: number[]): Promise<void> {
	for (let i = 0; i < userIds.length; i += KV_CHUNK) {
		const chunk = userIds.slice(i, i + KV_CHUNK);
		await Promise.all(
			chunk.flatMap((uid) => [invalidateUserCache(env, uid), invalidateUserCaches(env, uid)]),
		);
	}
}

export const usersTicker: StatsJobTicker = {
	kind: "users",
	initialize: async (env) => {
		// Active users only — status>=0 mirrors the legacy handler's scope.
		const row = await env.DB.prepare("SELECT COUNT(*) as cnt FROM users WHERE status >= 0").first<{
			cnt: number;
		}>();
		const total = row?.cnt ?? 0;
		return makeInitialPayload({ kind: "users", total, params: {} });
	},

	advance: async (env, prev) => {
		const batchSize = prev.batchSize;
		const now = Date.now();

		// (1) Page through active users by id > cursor ORDER BY id.
		const usersResult = await env.DB.prepare(
			"SELECT id FROM users WHERE status >= 0 AND id > ? ORDER BY id LIMIT ?",
		)
			.bind(prev.cursor, batchSize)
			.all();
		const batch = usersResult.results as unknown as UserBatchRow[];

		// Empty batch = terminal. `processed` is the real walked count.
		// `total` is renormalized to processed on done so the UI
		// denominator equals the numerator. See Phase C.1 (reviewer
		// msg=b43a2bc9).
		if (batch.length === 0) {
			return {
				...prev,
				status: "done",
				total: prev.processed,
				lastBatchUpdated: 0,
				finishedAt: now,
				lastTickAt: now,
			};
		}

		const userIds = batch.map((u) => u.id);

		// (2) Batch-scoped author aggregates via IN (...) chunks.
		const [threadMap, postMap, digestMap] = await Promise.all([
			fetchUserCounts(
				env,
				userIds,
				(ph) =>
					`SELECT author_id, COUNT(*) as cnt FROM threads WHERE author_id IN (${ph}) GROUP BY author_id`,
			),
			fetchUserCounts(
				env,
				userIds,
				(ph) =>
					`SELECT author_id, COUNT(*) as cnt FROM posts WHERE author_id IN (${ph}) GROUP BY author_id`,
			),
			fetchUserCounts(
				env,
				userIds,
				(ph) =>
					`SELECT author_id, COUNT(*) as cnt FROM threads WHERE digest > 0 AND author_id IN (${ph}) GROUP BY author_id`,
			),
		]);

		// (3) Batched UPDATE.
		const statements = userIds.map((uid) =>
			env.DB.prepare("UPDATE users SET threads = ?, posts = ?, digest_posts = ? WHERE id = ?").bind(
				threadMap.get(uid) ?? 0,
				postMap.get(uid) ?? 0,
				digestMap.get(uid) ?? 0,
				uid,
			),
		);
		for (let i = 0; i < statements.length; i += BATCH_SIZE) {
			await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
		}

		// (4) Per-batch cache invalidation (docs/19 §6 row "admin
		// statistics recalc-users"): drop user:mini (v1) + user:mini:v2 +
		// both viewer-bucket variants of user:public:v2 for every user we
		// just touched. Per helper contracts: the v1 `invalidateUserCache`
		// call propagates KV errors — if it throws, advance throws and
		// tickJob marks the job `error` with cursor unchanged so the next
		// POST retries the same batch (idempotent UPDATE). The v2
		// `invalidateUserCaches` call is best-effort and swallows KV
		// failures internally per cache/invalidate.ts contract; a v2 KV
		// outage will NOT fail the tick but does log via console.warn.
		await invalidateUsersChunked(env, userIds);

		const nextCursor = batch[batch.length - 1]?.id ?? prev.cursor;
		const newProcessed = prev.processed + batch.length;
		const isFinal = batch.length < batchSize;

		return {
			...prev,
			cursor: nextCursor,
			processed: newProcessed,
			total: isFinal ? newProcessed : prev.total,
			updated: prev.updated + batch.length,
			lastBatchUpdated: batch.length,
			status: isFinal ? "done" : "running",
			finishedAt: isFinal ? now : null,
			lastTickAt: now,
		};
	},

	// No `finalize` for users — cache invalidation is per-batch (we lose
	// the user-id set the moment we leave `advance`). Finalize would have
	// no useful work to do; omitting it keeps the framework's
	// running->done path clean.
};

export const recalcUsers = withEntityAuth(
	statsConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const body = await readJsonBody(request);
		if (body === null) {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}
		const result = await tickJob(env, usersTicker, body);
		return tickResultToResponse(result, origin);
	},
);

// ─── POST /api/admin/statistics/recalc-post-forums ──────────────────────────
// Sync posts.forum_id to match their thread's current forum_id. Job-mode
// driver — one POST advances ONE batch of posts (cursor = posts.id ORDER
// BY id LIMIT batchSize). Per reviewer msg=376c0bee (Phase D):
//   - No more `POST_FORUM_MAX_ROWS=50000` hard cap; full sweep is driven
//     by repeated POSTs until cursor reaches the last post.
//   - No `WHERE p.forum_id != t.forum_id` JOIN inside the batch SELECT.
//     Per tick we pull `(id, thread_id, forum_id)` for the next slab of
//     posts, look up `threads.forum_id` for those threadIds via `IN (...)`
//     in IN_CHUNK chunks, then compare in JS. Only mismatched posts are
//     UPDATE-ed; cursor still advances by every post we SCANNED so the
//     job terminates predictably.
//   - No per-tick `remaining` COUNT join — the old handler ran an
//     expensive `JOIN threads ON ...` at the end of every request. The
//     job snapshot already carries `processed` (scanned) and `updated`
//     (mismatched), which are what the card needs.
//   - `processed` diverges from `updated`: `processed = posts scanned`
//     (real walked count, matches cursor); `updated = mismatched posts
//     actually written`. The card must surface both.
//   - finalize bumps `forum:summary:gen` only when `updated > 0`. If the
//     full sweep found no mismatches, no cache invalidation is needed.

interface PostBatchRow {
	id: number;
	thread_id: number;
	forum_id: number;
}

interface ThreadForumRow {
	id: number;
	forum_id: number;
}

async function fetchThreadForums(env: Env, threadIds: number[]): Promise<Map<number, number>> {
	const map = new Map<number, number>();
	for (const chunk of chunkIds(threadIds)) {
		if (chunk.length === 0) continue;
		const placeholders = chunk.map(() => "?").join(",");
		const sql = `SELECT id, forum_id FROM threads WHERE id IN (${placeholders})`;
		const result = await env.DB.prepare(sql)
			.bind(...chunk)
			.all();
		for (const row of result.results as unknown as ThreadForumRow[]) {
			map.set(row.id, row.forum_id);
		}
	}
	return map;
}

export const postForumsTicker: StatsJobTicker = {
	kind: "post-forums",
	initialize: async (env) => {
		// total = best-effort denominator for the progress bar. We use the
		// full posts.COUNT(*) (every post the cursor will eventually
		// walk), not the mismatched count — the new sweep advances
		// `processed` per scanned post, not per mismatched post.
		const row = await env.DB.prepare("SELECT COUNT(*) as cnt FROM posts").first<{
			cnt: number;
		}>();
		const total = row?.cnt ?? 0;
		return makeInitialPayload({ kind: "post-forums", total, params: {} });
	},

	advance: async (env, prev) => {
		const batchSize = prev.batchSize;
		const now = Date.now();

		// (1) Page through posts by `id > cursor` — pull (id, thread_id,
		//     forum_id) so we can decide mismatch in JS without a
		//     batch-level JOIN.
		const postsResult = await env.DB.prepare(
			"SELECT id, thread_id, forum_id FROM posts WHERE id > ? ORDER BY id LIMIT ?",
		)
			.bind(prev.cursor, batchSize)
			.all();
		const batch = postsResult.results as unknown as PostBatchRow[];

		// Empty batch = terminal. `processed` is the real scanned count,
		// `total` renormalizes to processed on done (Phase C.1 contract).
		if (batch.length === 0) {
			return {
				...prev,
				status: "done",
				total: prev.processed,
				lastBatchUpdated: 0,
				finishedAt: now,
				lastTickAt: now,
			};
		}

		// (2) Look up canonical forum_id per thread for this batch only.
		const threadIds = Array.from(new Set(batch.map((p) => p.thread_id)));
		const threadForumMap = await fetchThreadForums(env, threadIds);

		// (3) Compute mismatches in JS — posts whose thread is missing
		//     (orphaned) are skipped (no canonical forum to copy).
		const mismatched: { id: number; forum_id: number }[] = [];
		for (const post of batch) {
			const canonical = threadForumMap.get(post.thread_id);
			if (canonical === undefined) continue;
			if (post.forum_id !== canonical) {
				mismatched.push({ id: post.id, forum_id: canonical });
			}
		}

		// (4) Batched UPDATE only for mismatched posts.
		if (mismatched.length > 0) {
			const statements = mismatched.map((row) =>
				env.DB.prepare("UPDATE posts SET forum_id = ? WHERE id = ?").bind(row.forum_id, row.id),
			);
			for (let i = 0; i < statements.length; i += BATCH_SIZE) {
				await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
			}
		}

		const nextCursor = batch[batch.length - 1]?.id ?? prev.cursor;
		const newProcessed = prev.processed + batch.length;
		const newUpdated = prev.updated + mismatched.length;
		const isFinal = batch.length < batchSize;

		return {
			...prev,
			cursor: nextCursor,
			processed: newProcessed,
			total: isFinal ? newProcessed : prev.total,
			updated: newUpdated,
			lastBatchUpdated: mismatched.length,
			status: isFinal ? "done" : "running",
			finishedAt: isFinal ? now : null,
			lastTickAt: now,
		};
	},

	finalize: async (env, payload) => {
		// Cache invalidation (docs/19 §6 row "admin statistics
		// recalc-post-forums"): bump forum:summary:gen ONLY when the
		// sweep actually corrected at least one post. A full sweep that
		// found nothing wrong has no side effects — skip the bump so
		// healthy systems don't churn the summary cache every nightly run.
		if (payload.updated > 0) {
			await bumpForumSummaryGen(env);
		}
	},
};

export const recalcPostForumIds = withEntityAuth(
	statsConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const body = await readJsonBody(request);
		if (body === null) {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}
		const result = await tickJob(env, postForumsTicker, body);
		return tickResultToResponse(result, origin);
	},
);

// ─── GET /api/admin/statistics/job/:kind ─────────────────────────────────────
// Read-only snapshot of the per-kind recalc job (see lib/stats-job.ts).
// This is the polling surface the admin UI uses to render the progress
// card without advancing the job. POST drives advancement; GET never
// writes to KV. Returns `null` data when no job has ever started (or its
// 24h TTL expired).

function parseStatsJobKind(value: string): StatsJobKind | null {
	return (STATS_JOB_KINDS as readonly string[]).includes(value) ? (value as StatsJobKind) : null;
}

export const getStatsJob = withEntityAuth(
	statsConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;
		const url = new URL(request.url);
		// Path shape: /api/admin/statistics/job/<kind>
		const segments = url.pathname.split("/").filter(Boolean);
		const rawKind = segments[segments.length - 1] ?? "";
		const kind = parseStatsJobKind(rawKind);
		if (!kind) {
			return errorResponse("INVALID_KIND", 400, { kind: rawKind }, origin);
		}
		const payload = await readJob(env, kind);
		return jsonNoStoreResponse(payload, origin);
	},
);
