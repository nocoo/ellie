// Admin statistics handlers — recalculate denormalized counters
// Provides endpoints to fix stale data from migrations or deletions.

import { withEntityAuth } from "../../lib/adminHelpers";
import type { EntityConfig } from "../../lib/crud";
import type { Env } from "../../lib/env";
import { jsonResponse } from "../../lib/response";
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
			return jsonResponse({ updated: 0 }, origin);
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
			SELECT t1.forum_id, t1.id, t1.subject, t1.last_post_at, t1.last_poster
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
					last_thread_subject = ?
				WHERE id = ?
			`).bind(
				threadMap.get(fid) ?? 0,
				postMap.get(fid) ?? 0,
				lastThread?.id ?? 0,
				lastThread?.last_post_at ?? 0,
				lastThread?.last_poster ?? "",
				lastThread?.subject ?? "",
				fid,
			);
		});

		await env.DB.batch(statements);

		return jsonResponse({ updated: forumIds.length }, origin);
	},
);

// ─── POST /api/admin/statistics/recalc-threads ───────────────────────────────
// Recalculate all thread counters: replies, last_post_at, last_poster.

export const recalcThreads = withEntityAuth(
	statsConfig,
	async (request: Request, env: Env): Promise<Response> => {
		const origin = request.headers.get("Origin") ?? undefined;

		let body: Record<string, unknown> = {};
		try {
			const text = await request.text();
			if (text) body = JSON.parse(text) as Record<string, unknown>;
		} catch {
			return errorResponse("INVALID_BODY", 400, undefined, origin);
		}

		// Optional: limit to specific forum
		const forumId =
			typeof body.forumId === "number" && body.forumId > 0 ? body.forumId : null;

		// Get threads to update
		let threads: D1Result;
		if (forumId) {
			threads = await env.DB.prepare(
				"SELECT id, created_at, author_name FROM threads WHERE forum_id = ?",
			)
				.bind(forumId)
				.all();
		} else {
			threads = await env.DB.prepare(
				"SELECT id, created_at, author_name FROM threads",
			).all();
		}

		const threadData = threads.results as Array<{
			id: number;
			created_at: number;
			author_name: string;
		}>;

		if (threadData.length === 0) {
			return jsonResponse({ updated: 0 }, origin);
		}

		// Get reply counts per thread (excluding first post)
		const threadIds = threadData.map((t) => t.id);
		const placeholders = threadIds.map(() => "?").join(",");

		const replyCounts = await env.DB.prepare(
			`SELECT thread_id, COUNT(*) - 1 as cnt FROM posts WHERE thread_id IN (${placeholders}) GROUP BY thread_id`,
		)
			.bind(...threadIds)
			.all();
		const replyMap = new Map(
			replyCounts.results.map((r) => [
				(r as { thread_id: number }).thread_id,
				Math.max(0, (r as { cnt: number }).cnt),
			]),
		);

		// Get last post info per thread
		const lastPosts = await env.DB.prepare(`
			SELECT p1.thread_id, p1.created_at, p1.author_name
			FROM posts p1
			INNER JOIN (
				SELECT thread_id, MAX(created_at) as max_created_at
				FROM posts
				WHERE thread_id IN (${placeholders})
				GROUP BY thread_id
			) p2 ON p1.thread_id = p2.thread_id AND p1.created_at = p2.max_created_at
		`)
			.bind(...threadIds)
			.all();
		const lastPostMap = new Map(
			lastPosts.results.map((r) => [
				(r as { thread_id: number }).thread_id,
				r as { created_at: number; author_name: string },
			]),
		);

		// Batch update all threads
		const statements = threadData.map((thread) => {
			const lastPost = lastPostMap.get(thread.id);
			// If no posts, fall back to thread's own creation info
			const lastPostAt = lastPost?.created_at ?? thread.created_at;
			const lastPoster = lastPost?.author_name ?? thread.author_name;

			return env.DB.prepare(`
				UPDATE threads SET
					replies = ?,
					last_post_at = ?,
					last_poster = ?
				WHERE id = ?
			`).bind(replyMap.get(thread.id) ?? 0, lastPostAt, lastPoster, thread.id);
		});

		// D1 batch has a limit, chunk if needed
		const BATCH_SIZE = 500;
		for (let i = 0; i < statements.length; i += BATCH_SIZE) {
			await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
		}

		return jsonResponse({ updated: threadData.length, forumId }, origin);
	},
);

// ─── POST /api/admin/statistics/recalc-users ─────────────────────────────────
// Re-export from user.ts for convenience (already implemented there)
export { batchRecalcCounters as recalcUsers } from "./user";
