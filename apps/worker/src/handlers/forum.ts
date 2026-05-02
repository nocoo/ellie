import { type Forum, type ModeratorInfo, canViewForumVisibility } from "@ellie/types";
import type { ForumVisibility } from "@ellie/types";
import { type Env, isKvUserCacheEnabled } from "../lib/env";
import { enrichForumsWithUserCache, parseModeratorIds, toForum } from "../lib/mappers";
import { getUserProfiles } from "../lib/user-cache";
import { THREAD_VISIBLE, buildVisibilityContext, isForumActive } from "../lib/visibility";

// Forum handlers for Cloudflare Worker
import { optionalAuthVerified } from "../middleware/auth";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** Fetch moderator names by IDs in a single query (batched for SQLite limits) */
async function fetchModeratorNames(
	db: D1Database,
	moderatorIds: number[],
): Promise<Map<number, string>> {
	if (moderatorIds.length === 0) return new Map();

	const map = new Map<number, string>();

	// SQLite has a limit of 999 variables, batch to stay safe
	const BATCH_SIZE = 500;
	for (let i = 0; i < moderatorIds.length; i += BATCH_SIZE) {
		const batch = moderatorIds.slice(i, i + BATCH_SIZE);
		const placeholders = batch.map(() => "?").join(",");
		const result = await db
			.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`)
			.bind(...batch)
			.all<{ id: number; username: string }>();

		for (const row of result.results) {
			map.set(row.id, row.username);
		}
	}

	return map;
}

/** Visible last thread info for a forum */
interface VisibleLastThread {
	forumId: number;
	threadId: number;
	subject: string;
	lastPostAt: number;
	lastPosterId: number;
	lastPoster: string;
}

/**
 * Fetch the most recent visible thread for each forum.
 * Returns a map of forum_id -> visible last thread info.
 * Only includes threads with sticky >= 0 (visible).
 *
 * Note: Batches queries to stay under SQLite's 999 variable limit.
 */
async function fetchVisibleLastThreads(
	db: D1Database,
	forumIds: number[],
): Promise<Map<number, VisibleLastThread>> {
	if (forumIds.length === 0) return new Map();

	const result = new Map<number, VisibleLastThread>();

	// SQLite has a limit of 999 variables, batch to stay safe
	const BATCH_SIZE = 100;
	for (let i = 0; i < forumIds.length; i += BATCH_SIZE) {
		const batch = forumIds.slice(i, i + BATCH_SIZE);
		const placeholders = batch.map(() => "?").join(",");

		// Use a simpler approach: join with a subquery that gets max last_post_at per forum
		const batchResult = await db
			.prepare(
				`SELECT t.forum_id, t.id as thread_id, t.subject, t.last_post_at, t.last_poster_id, t.last_poster
				 FROM threads t
				 INNER JOIN (
					 SELECT forum_id, MAX(last_post_at) as max_post_at
					 FROM threads
					 WHERE forum_id IN (${placeholders}) AND sticky >= 0
					 GROUP BY forum_id
				 ) sub ON t.forum_id = sub.forum_id AND t.last_post_at = sub.max_post_at
				 WHERE t.sticky >= 0`,
			)
			.bind(...batch)
			.all<{
				forum_id: number;
				thread_id: number;
				subject: string;
				last_post_at: number;
				last_poster_id: number;
				last_poster: string;
			}>();

		for (const row of batchResult.results) {
			// Only keep first match if there are ties
			if (!result.has(row.forum_id)) {
				result.set(row.forum_id, {
					forumId: row.forum_id,
					threadId: row.thread_id,
					subject: row.subject,
					lastPostAt: row.last_post_at,
					lastPosterId: row.last_poster_id,
					lastPoster: row.last_poster,
				});
			}
		}
	}

	return result;
}

/** Build moderatorList from moderator_ids string and name map */
function buildModeratorList(
	moderatorIdsStr: string,
	nameMap: Map<number, string>,
): ModeratorInfo[] {
	const ids = parseModeratorIds(moderatorIdsStr);
	return ids
		.map((id) => {
			const name = nameMap.get(id);
			return name ? { id, name } : null;
		})
		.filter((m): m is ModeratorInfo => m !== null);
}

/** GET /api/v1/forums - List all forums (no pagination) */
export async function list(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Get optional user auth for visibility filtering (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);

	// Run both queries in parallel: all forums + per-forum thread count in last 24h
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;

	const useKvCache = isKvUserCacheEnabled(env);

	// Choose query based on cache strategy
	const forumQuery = useKvCache
		? "SELECT * FROM forums ORDER BY display_order"
		: `SELECT f.*, u.avatar AS last_poster_avatar, u.avatar_path AS last_poster_avatar_path
		   FROM forums f
		   LEFT JOIN users u ON f.last_poster_id = u.id
		   ORDER BY f.display_order`;

	const [forumResult, countResult] = await Promise.all([
		env.DB.prepare(forumQuery).all(),
		// Only count visible threads (sticky >= 0) for today's count
		env.DB.prepare(
			`SELECT forum_id, COUNT(*) AS cnt FROM threads WHERE created_at >= ? AND ${THREAD_VISIBLE} GROUP BY forum_id`,
		)
			.bind(cutoff24h)
			.all<{ forum_id: number; cnt: number }>(),
	]);

	// Build lookup map: forum_id → todayThreads
	const todayMap = new Map<number, number>();
	for (const row of countResult.results) {
		todayMap.set(row.forum_id, row.cnt);
	}

	let forums: Forum[] = forumResult.results.map((row) => {
		const r = row as Record<string, unknown>;
		const forum = toForum(r);
		forum.todayThreads = todayMap.get(forum.id) ?? 0;
		// If JOIN approach, populate avatar directly from query result
		if (!useKvCache && r.last_poster_avatar !== undefined) {
			forum.lastPosterAvatar = (r.last_poster_avatar as string) ?? "";
			forum.lastPosterAvatarPath = (r.last_poster_avatar_path as string) ?? "";
		}
		return forum;
	});

	// Collect all moderator IDs and fetch their names
	const allModeratorIds = new Set<number>();
	for (const row of forumResult.results) {
		const moderatorIdsStr = (row as Record<string, unknown>).moderator_ids as string;
		for (const id of parseModeratorIds(moderatorIdsStr ?? "")) {
			allModeratorIds.add(id);
		}
	}
	const moderatorNameMap = await fetchModeratorNames(env.DB, [...allModeratorIds]);

	// Populate moderatorList for each forum
	forums = forums.map((forum, i) => {
		const moderatorIdsStr = (forumResult.results[i] as Record<string, unknown>)
			.moderator_ids as string;
		return {
			...forum,
			moderatorList: buildModeratorList(moderatorIdsStr ?? "", moderatorNameMap),
		};
	});

	// Replace forum last thread metadata with visible thread data
	// This prevents leaking hidden/deleted thread subjects and posters
	const forumIds = forums.map((f) => f.id);
	const visibleLastThreads = await fetchVisibleLastThreads(env.DB, forumIds);
	forums = forums.map((forum) => {
		const visible = visibleLastThreads.get(forum.id);
		if (visible) {
			return {
				...forum,
				lastThreadId: visible.threadId,
				lastThreadSubject: visible.subject,
				lastPostAt: visible.lastPostAt,
				lastPosterId: visible.lastPosterId,
				lastPoster: visible.lastPoster,
			};
		}
		// No visible threads in this forum - clear the metadata
		return {
			...forum,
			lastThreadId: 0,
			lastThreadSubject: "",
			lastPostAt: 0,
			lastPosterId: 0,
			lastPoster: "",
			lastPosterAvatar: "",
		};
	});

	// Enrich with KV user cache (only if enabled)
	if (useKvCache) {
		const lastPosterIds = forums.map((f) => f.lastPosterId).filter((id) => id > 0);
		if (lastPosterIds.length > 0) {
			const userCache = await getUserProfiles(env, ctx, lastPosterIds);
			forums = enrichForumsWithUserCache(forums, userCache);
		}
	}

	// Filter by visibility: remove forums the user can't access
	// Also filter by status: hide admin-hidden (0), deleted (-1), paused (2), QQ group (3)
	forums = forums.filter((f) => {
		// Status filter
		if (!isForumActive(f)) return false;
		// Visibility filter
		return canViewForumVisibility(f.visibility as ForumVisibility, visCtx);
	});

	return new Response(
		JSON.stringify({
			data: forums,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
			},
		}),
		{
			headers: {
				...corsHeaders(origin),
				"Content-Type": "application/json",
			},
		},
	);
}

/** GET /api/v1/forums/:id - Get forum by ID */
export async function getById(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	// Get optional user auth for visibility filtering (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);

	const useKvCache = isKvUserCacheEnabled(env);

	// Choose query based on cache strategy
	const forumQuery = useKvCache
		? "SELECT * FROM forums WHERE id = ?"
		: `SELECT f.*, u.avatar AS last_poster_avatar
		   FROM forums f
		   LEFT JOIN users u ON f.last_poster_id = u.id
		   WHERE f.id = ?`;

	const result = await env.DB.prepare(forumQuery).bind(id).first();

	if (!result) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	const r = result as Record<string, unknown>;
	let forum = toForum(r);

	// Check status and visibility
	if (!isForumActive(forum)) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}
	if (!canViewForumVisibility(forum.visibility as ForumVisibility, visCtx)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this forum" },
			origin,
		);
	}

	// If JOIN approach, populate avatar directly from query result
	if (!useKvCache && r.last_poster_avatar !== undefined) {
		forum.lastPosterAvatar = (r.last_poster_avatar as string) ?? "";
	}

	// Populate moderatorList
	const moderatorIdsStr = r.moderator_ids as string;
	const moderatorIds = parseModeratorIds(moderatorIdsStr ?? "");
	if (moderatorIds.length > 0) {
		const moderatorNameMap = await fetchModeratorNames(env.DB, moderatorIds);
		forum.moderatorList = buildModeratorList(moderatorIdsStr ?? "", moderatorNameMap);
	}

	// Replace forum last thread metadata with visible thread data
	// This prevents leaking hidden/deleted thread subjects and posters
	const visibleLastThreads = await fetchVisibleLastThreads(env.DB, [id]);
	const visible = visibleLastThreads.get(id);
	if (visible) {
		forum.lastThreadId = visible.threadId;
		forum.lastThreadSubject = visible.subject;
		forum.lastPostAt = visible.lastPostAt;
		forum.lastPosterId = visible.lastPosterId;
		forum.lastPoster = visible.lastPoster;
	} else {
		// No visible threads in this forum - clear the metadata
		forum.lastThreadId = 0;
		forum.lastThreadSubject = "";
		forum.lastPostAt = 0;
		forum.lastPosterId = 0;
		forum.lastPoster = "";
		forum.lastPosterAvatar = "";
	}

	// Count threads in last 24h for this forum (only visible threads: sticky >= 0)
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;
	const countResult = await env.DB.prepare(
		`SELECT COUNT(*) AS cnt FROM threads WHERE forum_id = ? AND created_at >= ? AND ${THREAD_VISIBLE}`,
	)
		.bind(id, cutoff24h)
		.first<{ cnt: number }>();
	forum.todayThreads = countResult?.cnt ?? 0;

	// Enrich with KV user cache (only if enabled)
	if (useKvCache && forum.lastPosterId > 0) {
		const userCache = await getUserProfiles(env, ctx, [forum.lastPosterId]);
		forum = enrichForumsWithUserCache([forum], userCache)[0] ?? forum;
	}

	return new Response(
		JSON.stringify({
			data: forum,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
			},
		}),
		{
			headers: {
				...corsHeaders(origin),
				"Content-Type": "application/json",
			},
		},
	);
}
