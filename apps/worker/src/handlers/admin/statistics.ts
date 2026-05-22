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
const POST_FORUM_FETCH_LIMIT = 5000;
const POST_FORUM_MAX_ROWS = 50000;

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
// Recalculate all forum counters: threads, posts, last_thread_id, etc.

export const recalcForums = withEntityAuth(
	statsConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		// Get all forums
		const forums = await env.DB.prepare("SELECT id FROM forums").all();
		const forumIds = forums.results.map((r) => (r as { id: number }).id);

		if (forumIds.length === 0) {
			return jsonNoStoreResponse({ updated: 0 }, origin);
		}

		// Calculate thread counts per forum
		const threadCounts = await env.DB.prepare(
			"SELECT forum_id, COUNT(*) as cnt FROM threads GROUP BY forum_id",
		).all();
		const threadMap = new Map(
			threadCounts.results.map((r) => [
				(r as { forum_id: number }).forum_id,
				(r as { cnt: number }).cnt,
			]),
		);

		// Calculate post counts per forum
		const postCounts = await env.DB.prepare(
			"SELECT forum_id, COUNT(*) as cnt FROM posts GROUP BY forum_id",
		).all();
		const postMap = new Map(
			postCounts.results.map((r) => [
				(r as { forum_id: number }).forum_id,
				(r as { cnt: number }).cnt,
			]),
		);

		// Get last thread info per forum (most recent by last_post_at)
		const lastThreads = await env.DB.prepare(`
			SELECT t1.forum_id, t1.id, t1.subject, t1.last_post_at, t1.last_poster, t1.last_poster_id
			FROM threads t1
			INNER JOIN (
				SELECT forum_id, MAX(last_post_at) as max_last_post_at
				FROM threads
				GROUP BY forum_id
			) t2 ON t1.forum_id = t2.forum_id AND t1.last_post_at = t2.max_last_post_at
		`).all();
		const lastThreadMap = new Map(
			lastThreads.results.map((r) => [
				(r as { forum_id: number }).forum_id,
				r as {
					id: number;
					subject: string;
					last_post_at: number;
					last_poster: string;
					last_poster_id: number;
				},
			]),
		);

		// Batch update all forums
		const statements = forumIds.map((fid) => {
			const lastThread = lastThreadMap.get(fid);
			return env.DB.prepare(`
				UPDATE forums SET
					threads = ?,
					posts = ?,
					last_thread_id = ?,
					last_post_at = ?,
					last_poster = ?,
					last_poster_id = ?,
					last_thread_subject = ?
				WHERE id = ?
			`).bind(
				threadMap.get(fid) ?? 0,
				postMap.get(fid) ?? 0,
				lastThread?.id ?? 0,
				lastThread?.last_post_at ?? 0,
				lastThread?.last_poster ?? "",
				lastThread?.last_poster_id ?? 0,
				lastThread?.subject ?? "",
				fid,
			);
		});

		await env.DB.batch(statements);

		// Cache invalidation (docs/19 §6 row "admin statistics recalc-forums"):
		// recalcForums rewrites aggregate fields (threads/posts/last-post)
		// consumed by the summary layer; the tree layer is not touched
		// because structure / visibility / description / moderators did
		// not change.
		await bumpForumSummaryGen(env);

		return jsonNoStoreResponse({ updated: forumIds.length }, origin);
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

		// Empty batch = nothing left to do; mark done. Total counts can
		// drift between initialize and the final tick (inserts/deletes);
		// `processed` is the monotonic count of rows we actually walked
		// past, so never let a stale denominator pull it down. If `total`
		// turned out to be a low estimate, bump it up to `processed` so
		// the UI card lands at 100% without a >100% overshoot.
		if (batch.length === 0) {
			const processed = Math.max(prev.processed, prev.total ?? prev.processed);
			return {
				...prev,
				status: "done",
				processed,
				total: Math.max(prev.total ?? 0, processed),
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
		// On the terminal short batch keep `processed` monotonic — the
		// real number of rows we walked past — and bump `total` up if it
		// was an underestimate. Mirror the empty-batch branch so the UI
		// can read either snapshot consistently.
		const terminalProcessed = isFinal ? Math.max(newProcessed, prev.total ?? 0) : newProcessed;
		const terminalTotal = isFinal ? Math.max(prev.total ?? 0, terminalProcessed) : prev.total;

		return {
			...prev,
			cursor: nextCursor,
			processed: terminalProcessed,
			total: terminalTotal,
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
// Recalculate all user counters: threads, posts, digest_posts.

export const recalcUsers = withEntityAuth(
	statsConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let body: Record<string, unknown> = {};
		try {
			const text = await request.text();
			if (text) body = JSON.parse(text) as Record<string, unknown>;
		} catch {
			// Empty body is fine
		}

		// Get user IDs to update
		let userIds: number[];
		if (Array.isArray(body.ids) && body.ids.length > 0) {
			userIds = body.ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id));
		} else {
			// Get all active users
			const result = await env.DB.prepare("SELECT id FROM users WHERE status >= 0").all();
			userIds = result.results.map((r) => (r as { id: number }).id);
		}

		if (userIds.length === 0) {
			return jsonNoStoreResponse({ updated: 0 }, origin);
		}

		// Build maps using full table scans (avoids WHERE IN parameter limits)
		// Get thread counts per user
		const threadCounts = await env.DB.prepare(
			"SELECT author_id, COUNT(*) as cnt FROM threads GROUP BY author_id",
		).all();
		const threadMap = new Map(
			threadCounts.results.map((r) => [
				(r as { author_id: number }).author_id,
				(r as { cnt: number }).cnt,
			]),
		);

		// Get post counts per user
		const postCounts = await env.DB.prepare(
			"SELECT author_id, COUNT(*) as cnt FROM posts GROUP BY author_id",
		).all();
		const postMap = new Map(
			postCounts.results.map((r) => [
				(r as { author_id: number }).author_id,
				(r as { cnt: number }).cnt,
			]),
		);

		// Get digest counts per user
		const digestCounts = await env.DB.prepare(
			"SELECT author_id, COUNT(*) as cnt FROM threads WHERE digest > 0 GROUP BY author_id",
		).all();
		const digestMap = new Map(
			digestCounts.results.map((r) => [
				(r as { author_id: number }).author_id,
				(r as { cnt: number }).cnt,
			]),
		);

		// Batch update all users
		const statements = userIds.map((uid) =>
			env.DB.prepare("UPDATE users SET threads = ?, posts = ?, digest_posts = ? WHERE id = ?").bind(
				threadMap.get(uid) ?? 0,
				postMap.get(uid) ?? 0,
				digestMap.get(uid) ?? 0,
				uid,
			),
		);

		// D1 batch has a limit, chunk if needed
		for (let i = 0; i < statements.length; i += BATCH_SIZE) {
			await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
		}

		// Cache invalidation (docs/19 §6 row "admin statistics recalc-users"):
		// drop user:mini:<id> (v1) AND user:mini:v2:<id> + both viewer-bucket
		// variants of user:public:v2:<id> per user. The v1 user-cache
		// helpers will retire when user:mini ships its v2 schema (Phase 6).
		// Run as a chunked best-effort sweep so a large user set doesn't
		// fan out thousands of concurrent KV calls; KV failures are
		// already swallowed inside the helpers.
		const KV_CHUNK = 50;
		for (let i = 0; i < userIds.length; i += KV_CHUNK) {
			const chunk = userIds.slice(i, i + KV_CHUNK);
			await Promise.all(
				chunk.flatMap((uid) => [invalidateUserCache(env, uid), invalidateUserCaches(env, uid)]),
			);
		}

		return jsonNoStoreResponse({ updated: userIds.length }, origin);
	},
);

// ─── POST /api/admin/statistics/recalc-post-forums ──────────────────────────
// Sync posts.forum_id to match their thread's current forum_id.
// Processes in batches to stay within D1 CPU limits.

export const recalcPostForumIds = withEntityAuth(
	statsConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let totalUpdated = 0;

		while (totalUpdated < POST_FORUM_MAX_ROWS) {
			const mismatched = await env.DB.prepare(`
				SELECT p.id, t.forum_id
				FROM posts p
				JOIN threads t ON t.id = p.thread_id
				WHERE p.forum_id != t.forum_id
				LIMIT ?
			`)
				.bind(POST_FORUM_FETCH_LIMIT)
				.all();

			const rows = mismatched.results as Array<{ id: number; forum_id: number }>;
			if (rows.length === 0) break;

			for (let i = 0; i < rows.length; i += BATCH_SIZE) {
				const chunk = rows.slice(i, i + BATCH_SIZE);
				const statements = chunk.map((row) =>
					env.DB.prepare("UPDATE posts SET forum_id = ? WHERE id = ?").bind(row.forum_id, row.id),
				);
				await env.DB.batch(statements);
			}

			totalUpdated += rows.length;

			if (rows.length < POST_FORUM_FETCH_LIMIT) break;
		}

		const remainingResult = await env.DB.prepare(`
			SELECT COUNT(*) as cnt
			FROM posts p
			JOIN threads t ON t.id = p.thread_id
			WHERE p.forum_id != t.forum_id
		`).first<{ cnt: number }>();
		const remaining = remainingResult?.cnt ?? 0;

		if (totalUpdated > 0) {
			await bumpForumSummaryGen(env);
		}

		return jsonNoStoreResponse({ updated: totalUpdated, remaining }, origin);
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
