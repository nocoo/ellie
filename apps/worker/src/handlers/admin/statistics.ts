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
import { jsonResponse } from "../../lib/response";
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

// D1 has a limit of 999 parameters per query
const _MAX_PARAMS = 500;
const BATCH_SIZE = 500;

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
		const forumId = typeof body.forumId === "number" && body.forumId > 0 ? body.forumId : null;

		// Get threads to update
		let threads: D1Result;
		if (forumId) {
			threads = await env.DB.prepare(
				"SELECT id, created_at, author_name, author_id FROM threads WHERE forum_id = ?",
			)
				.bind(forumId)
				.all();
		} else {
			threads = await env.DB.prepare(
				"SELECT id, created_at, author_name, author_id FROM threads",
			).all();
		}

		const threadData = threads.results as Array<{
			id: number;
			created_at: number;
			author_name: string;
			author_id: number;
		}>;

		if (threadData.length === 0) {
			return jsonResponse({ updated: 0 }, origin);
		}

		// Build maps using full table scans (no WHERE IN limitation)
		// Get reply counts per thread (count - 1 for excluding first post)
		const replyCounts = await env.DB.prepare(
			"SELECT thread_id, COUNT(*) - 1 as cnt FROM posts GROUP BY thread_id",
		).all();
		const replyMap = new Map(
			replyCounts.results.map((r) => [
				(r as { thread_id: number }).thread_id,
				Math.max(0, (r as { cnt: number }).cnt),
			]),
		);

		// Get last post info per thread using a subquery
		const lastPosts = await env.DB.prepare(`
			SELECT p1.thread_id, p1.created_at, p1.author_name, p1.author_id
			FROM posts p1
			INNER JOIN (
				SELECT thread_id, MAX(created_at) as max_created_at
				FROM posts
				GROUP BY thread_id
			) p2 ON p1.thread_id = p2.thread_id AND p1.created_at = p2.max_created_at
		`).all();
		const lastPostMap = new Map(
			lastPosts.results.map((r) => [
				(r as { thread_id: number }).thread_id,
				r as { created_at: number; author_name: string; author_id: number },
			]),
		);

		// Batch update all threads
		const statements = threadData.map((thread) => {
			const lastPost = lastPostMap.get(thread.id);
			// If no posts, fall back to thread's own creation info
			const lastPostAt = lastPost?.created_at ?? thread.created_at;
			const lastPoster = lastPost?.author_name ?? thread.author_name;
			const lastPosterId = lastPost?.author_id ?? thread.author_id;

			return env.DB.prepare(`
				UPDATE threads SET
					replies = ?,
					last_post_at = ?,
					last_poster = ?,
					last_poster_id = ?
				WHERE id = ?
			`).bind(replyMap.get(thread.id) ?? 0, lastPostAt, lastPoster, lastPosterId, thread.id);
		});

		// D1 batch has a limit, chunk if needed
		for (let i = 0; i < statements.length; i += BATCH_SIZE) {
			await env.DB.batch(statements.slice(i, i + BATCH_SIZE));
		}

		// Cache invalidation (docs/19 §6 row "admin statistics recalc-threads"):
		// bump forum:summary:gen (last-post / counts may have shifted as a
		// side-effect of recalculating thread last-post). For thread:list:v2,
		// bump per-forum gen when scoped to a single forum, else fall back to
		// the global `thread:list:gen:all` to invalidate every per-forum
		// thread-list cache in one write (docs/19 §3.3.1 option (b)).
		await Promise.all([
			bumpForumSummaryGen(env),
			forumId ? bumpThreadListGen(env, forumId) : bumpThreadListGenAll(env),
		]);

		return jsonResponse({ updated: threadData.length }, origin);
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
			return jsonResponse({ updated: 0 }, origin);
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

		return jsonResponse({ updated: userIds.length }, origin);
	},
);
