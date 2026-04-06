import { type Forum, type ModeratorInfo, UserRole, canViewForumVisibility } from "@ellie/types";
import type { ForumVisibility, VisibilityContext } from "@ellie/types";
import { type Env, isKvUserCacheEnabled } from "../lib/env";
import {
	enrichForumWithUserCache,
	enrichForumsWithUserCache,
	parseModeratorIds,
	toForum,
} from "../lib/mappers";
import { getUserProfiles } from "../lib/user-cache";

// Forum handlers for Cloudflare Worker
import { optionalAuthVerified } from "../middleware/auth";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/**
 * Build visibility context from optional user auth.
 */
function buildVisibilityContext(user: { userId: number; role: number } | null): VisibilityContext {
	return {
		isLoggedIn: user !== null,
		role: user?.role ?? UserRole.User,
	};
}

/** Fetch moderator names by IDs in a single query */
async function fetchModeratorNames(
	db: D1Database,
	moderatorIds: number[],
): Promise<Map<number, string>> {
	if (moderatorIds.length === 0) return new Map();

	const placeholders = moderatorIds.map(() => "?").join(",");
	const result = await db
		.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`)
		.bind(...moderatorIds)
		.all<{ id: number; username: string }>();

	const map = new Map<number, string>();
	for (const row of result.results) {
		map.set(row.id, row.username);
	}
	return map;
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
		: `SELECT f.*, u.avatar AS last_poster_avatar
		   FROM forums f
		   LEFT JOIN users u ON f.last_poster_id = u.id
		   ORDER BY f.display_order`;

	const [forumResult, countResult] = await Promise.all([
		env.DB.prepare(forumQuery).all(),
		// Only count visible threads (sticky >= 0) for today's count
		env.DB.prepare(
			"SELECT forum_id, COUNT(*) AS cnt FROM threads WHERE created_at >= ? AND sticky >= 0 GROUP BY forum_id",
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
		if (f.status <= 0 || f.status === 2 || f.status === 3) return false;
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
	if (forum.status <= 0 || forum.status === 2 || forum.status === 3) {
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

	// Count threads in last 24h for this forum
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;
	const countResult = await env.DB.prepare(
		"SELECT COUNT(*) AS cnt FROM threads WHERE forum_id = ? AND created_at >= ?",
	)
		.bind(id, cutoff24h)
		.first<{ cnt: number }>();
	forum.todayThreads = countResult?.cnt ?? 0;

	// Enrich with KV user cache (only if enabled)
	if (useKvCache && forum.lastPosterId > 0) {
		const userCache = await getUserProfiles(env, ctx, [forum.lastPosterId]);
		forum = enrichForumWithUserCache(forum, userCache);
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
