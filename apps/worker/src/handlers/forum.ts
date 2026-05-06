import { type Forum, type ModeratorInfo, canViewForumVisibility } from "@ellie/types";
import type { ForumVisibility } from "@ellie/types";
import { type Env, isKvUserCacheEnabled } from "../lib/env";
import {
	type ForumTreeEntry,
	getForumTree,
	getForumVolatile,
	isForumCacheEnabled,
} from "../lib/forum-cache";
import { enrichForumsWithUserCache, parseModeratorIds, toForum } from "../lib/mappers";
import { getUserProfiles } from "../lib/user-cache";
import { THREAD_VISIBLE, buildVisibilityContext, isForumActive } from "../lib/visibility";

// Forum handlers for Cloudflare Worker
import { jsonResponse } from "../lib/response";
import { optionalAuthVerified } from "../middleware/auth";
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
	return buildModeratorListFromIds(parseModeratorIds(moderatorIdsStr), nameMap);
}

/** Build moderatorList from already-parsed IDs (avoids re-parsing the string). */
function buildModeratorListFromIds(ids: number[], nameMap: Map<number, string>): ModeratorInfo[] {
	const out: ModeratorInfo[] = [];
	for (const id of ids) {
		const name = nameMap.get(id);
		if (name) out.push({ id, name });
	}
	return out;
}

/** Batch-fetch last poster avatars via D1 when user cache is disabled. */
async function enrichForumsWithAvatarSQL(db: D1Database, forums: Forum[]): Promise<Forum[]> {
	const lastPosterIds = [...new Set(forums.map((f) => f.lastPosterId).filter((id) => id > 0))];
	if (lastPosterIds.length === 0) return forums;

	const placeholders = lastPosterIds.map(() => "?").join(",");
	const avatarResult = await db
		.prepare(`SELECT id, avatar, avatar_path FROM users WHERE id IN (${placeholders})`)
		.bind(...lastPosterIds)
		.all<{ id: number; avatar: string; avatar_path: string }>();

	const avatarMap = new Map<number, { avatar: string; avatarPath: string }>();
	for (const row of avatarResult.results) {
		avatarMap.set(row.id, {
			avatar: row.avatar ?? "",
			avatarPath: row.avatar_path ?? "",
		});
	}

	return forums.map((f) => {
		const info = avatarMap.get(f.lastPosterId);
		if (info) {
			return { ...f, lastPosterAvatar: info.avatar, lastPosterAvatarPath: info.avatarPath };
		}
		return f;
	});
}

/**
 * Legacy D1-only path for forum.list — kept on the hot path because the KV
 * forum cache is gated behind a feature flag. Single-pass row → Forum mapping
 * with mutate-in-place enrichment to avoid intermediate `.map()` allocations.
 */
async function listForumsLegacy(env: Env, useKvUserCache: boolean): Promise<Forum[]> {
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;

	const forumQuery = useKvUserCache
		? "SELECT * FROM forums ORDER BY display_order"
		: `SELECT f.*, u.avatar AS last_poster_avatar, u.avatar_path AS last_poster_avatar_path
		   FROM forums f
		   LEFT JOIN users u ON f.last_poster_id = u.id
		   ORDER BY f.display_order`;

	const [forumResult, countResult] = await Promise.all([
		env.DB.prepare(forumQuery).all(),
		env.DB.prepare(
			`SELECT forum_id, COUNT(*) AS cnt FROM threads WHERE created_at >= ? AND ${THREAD_VISIBLE} GROUP BY forum_id`,
		)
			.bind(cutoff24h)
			.all<{ forum_id: number; cnt: number }>(),
	]);

	const todayMap = new Map<number, number>();
	for (const row of countResult.results) {
		todayMap.set(row.forum_id, row.cnt);
	}

	// First pass: build base Forum objects + collect moderator IDs + forum IDs.
	const rawRows = forumResult.results as Record<string, unknown>[];
	const rowCount = rawRows.length;
	const forums: Forum[] = new Array(rowCount);
	const moderatorIdsPerForum: number[][] = new Array(rowCount);
	const forumIds: number[] = new Array(rowCount);
	const allModeratorIds = new Set<number>();
	for (let i = 0; i < rowCount; i++) {
		const r = rawRows[i];
		const forum = toForum(r);
		forum.todayThreads = todayMap.get(forum.id) ?? 0;
		if (!useKvUserCache && r.last_poster_avatar !== undefined) {
			forum.lastPosterAvatar = (r.last_poster_avatar as string) ?? "";
			forum.lastPosterAvatarPath = (r.last_poster_avatar_path as string) ?? "";
		}
		const modIds = parseModeratorIds((r.moderator_ids as string) ?? "");
		moderatorIdsPerForum[i] = modIds;
		for (const id of modIds) allModeratorIds.add(id);
		forumIds[i] = forum.id;
		forums[i] = forum;
	}

	// fetchModeratorNames and fetchVisibleLastThreads are independent D1
	// calls — run them in parallel to halve the round-trip latency for the
	// legacy forum.list path.
	const [moderatorNameMap, visibleLastThreads] = await Promise.all([
		fetchModeratorNames(env.DB, [...allModeratorIds]),
		fetchVisibleLastThreads(env.DB, forumIds),
	]);

	// Second pass: in-place enrich with moderator list + visible last-thread.
	for (let i = 0; i < rowCount; i++) {
		const forum = forums[i];
		forum.moderatorList = buildModeratorListFromIds(moderatorIdsPerForum[i], moderatorNameMap);
		const visible = visibleLastThreads.get(forum.id);
		if (visible) {
			forum.lastThreadId = visible.threadId;
			forum.lastThreadSubject = visible.subject;
			forum.lastPostAt = visible.lastPostAt;
			forum.lastPosterId = visible.lastPosterId;
			forum.lastPoster = visible.lastPoster;
		} else {
			forum.lastThreadId = 0;
			forum.lastThreadSubject = "";
			forum.lastPostAt = 0;
			forum.lastPosterId = 0;
			forum.lastPoster = "";
			forum.lastPosterAvatar = "";
		}
	}

	return forums;
}

/** GET /api/v1/forums - List all forums (no pagination) */
export async function list(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Kick off the (verified) auth lookup eagerly. We don't need the result
	// until the final visibility filter, so it can run in parallel with the
	// forum data fetch — saves one D1 round-trip on the hot path when the
	// caller is authenticated.
	const userPromise = optionalAuthVerified(request, env);

	const useForumKvCache = isForumCacheEnabled(env);
	const useKvUserCache = isKvUserCacheEnabled(env);

	let forums: Forum[];

	if (useForumKvCache) {
		// ─── Two-layer KV cache path ─────────────────────────────
		// Layer 1: structural tree (10min TTL, explicit invalidation)
		// Layer 2: volatile data (60s TTL)
		const tree = await getForumTree(env, ctx);
		const forumIds = tree.map((e) => e.id);
		const volatile = await getForumVolatile(env, ctx, forumIds);

		// Merge tree + volatile into Forum objects
		forums = tree.map((entry) => {
			const vol = volatile[entry.id];
			return {
				id: entry.id,
				parentId: entry.parentId,
				name: entry.name,
				description: entry.description,
				icon: entry.icon,
				displayOrder: entry.displayOrder,
				status: entry.status,
				visibility: entry.visibility as ForumVisibility,
				type: entry.type as Forum["type"],
				moderators: entry.moderators,
				moderatorList: entry.moderatorList,
				threads: vol?.threads ?? 0,
				posts: vol?.posts ?? 0,
				todayThreads: vol?.todayThreads ?? 0,
				lastThreadId: vol?.lastThreadId ?? 0,
				lastThreadSubject: vol?.lastThreadSubject ?? "",
				lastPostAt: vol?.lastPostAt ?? 0,
				lastPosterId: vol?.lastPosterId ?? 0,
				lastPoster: vol?.lastPoster ?? "",
				lastPosterAvatar: "",
				lastPosterAvatarPath: "",
			};
		});

		// Enrich with last poster avatars
		if (useKvUserCache) {
			const lastPosterIds = forums.map((f) => f.lastPosterId).filter((id) => id > 0);
			if (lastPosterIds.length > 0) {
				const userCache = await getUserProfiles(env, ctx, lastPosterIds);
				forums = enrichForumsWithUserCache(forums, userCache);
			}
		} else {
			forums = await enrichForumsWithAvatarSQL(env.DB, forums);
		}
	} else {
		forums = await listForumsLegacy(env, useKvUserCache);
		if (useKvUserCache) {
			const lastPosterIds = forums.map((f) => f.lastPosterId).filter((id) => id > 0);
			if (lastPosterIds.length > 0) {
				const userCache = await getUserProfiles(env, ctx, lastPosterIds);
				forums = enrichForumsWithUserCache(forums, userCache);
			}
		}
	}

	// Now resolve the auth lookup we started at the top.
	const user = await userPromise;
	const visCtx = buildVisibilityContext(user);

	// Filter by visibility and active status (both paths converge here)
	forums = forums.filter((f) => {
		if (!isForumActive(f)) return false;
		return canViewForumVisibility(f.visibility as ForumVisibility, visCtx);
	});

	return jsonResponse(forums, origin);
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

	// Auth + forum row are independent at this point — fire both eagerly so
	// they overlap in production. We don't actually need the auth result
	// until the visibility check after the forum query resolves.
	const userPromise = optionalAuthVerified(request, env);

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

	// Check status (cheap, sync) before paying for auth resolution.
	if (!isForumActive(forum)) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	const user = await userPromise;
	const visCtx = buildVisibilityContext(user);

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

	// Run the three remaining D1 calls (mod names, visible last thread, today
	// count) in parallel — they are independent.
	const cutoff24h = Math.floor(Date.now() / 1000) - 86400;
	const [moderatorNameMap, visibleLastThreads, countResult] = await Promise.all([
		moderatorIds.length > 0
			? fetchModeratorNames(env.DB, moderatorIds)
			: Promise.resolve(new Map<number, string>()),
		fetchVisibleLastThreads(env.DB, [id]),
		env.DB.prepare(
			`SELECT COUNT(*) AS cnt FROM threads WHERE forum_id = ? AND created_at >= ? AND ${THREAD_VISIBLE}`,
		)
			.bind(id, cutoff24h)
			.first<{ cnt: number }>(),
	]);

	if (moderatorIds.length > 0) {
		forum.moderatorList = buildModeratorList(moderatorIdsStr ?? "", moderatorNameMap);
	}

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

	forum.todayThreads = countResult?.cnt ?? 0;

	// Enrich with KV user cache (only if enabled)
	if (useKvCache && forum.lastPosterId > 0) {
		const userCache = await getUserProfiles(env, ctx, [forum.lastPosterId]);
		forum = enrichForumsWithUserCache([forum], userCache)[0] ?? forum;
	}

	return jsonResponse(forum, origin);
}

// ─── Ancestors endpoint ─────────────────────────────────────────────

/** Forum context returned by ancestors endpoint (structural fields only). */
interface ForumContext {
	id: number;
	parentId: number;
	name: string;
	status: number;
	visibility: ForumVisibility;
	type: string;
	moderators: string;
	moderatorIds: string;
	moderatorList: ModeratorInfo[];
}

/** Breadcrumb item returned by ancestors endpoint. */
interface AncestorItem {
	id: number;
	parentId: number;
	name: string;
}

/**
 * GET /api/v1/forums/:id/ancestors
 *
 * Lightweight breadcrumb endpoint. Returns the target forum's context plus its
 * ancestor chain (root → parent), computed from the KV-cached forum tree.
 *
 * Visibility semantics (matches existing behavior):
 * 1. Read forum tree from KV/D1
 * 2. Filter by viewer visibility + active status
 * 3. Compute ancestors from FILTERED list
 *    - Target not in filtered list → 404
 *    - Hidden ancestor → chain terminates (don't leak names)
 * 4. Return { forum: ForumContext, ancestors: AncestorItem[] }
 */
export async function getAncestors(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Parse forum ID from path: /api/v1/forums/:id/ancestors
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	// ["", "api", "v1", "forums", ":id", "ancestors"]
	const idStr = pathParts[4];
	const forumId = Number.parseInt(idStr ?? "0", 10);
	if (!forumId || forumId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	// Get optional user auth for visibility filtering
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);

	// Get forum tree (from KV cache or D1 fallback)
	const tree = await getForumTree(env, ctx);

	// Filter tree: only active + visible forums for this viewer
	const visibleForums = tree.filter((entry) => {
		if (!isForumActive(entry)) return false;
		return canViewForumVisibility(entry.visibility, visCtx);
	});

	// Find target forum in the filtered set
	const target = visibleForums.find((f) => f.id === forumId);
	if (!target) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	// Compute ancestor chain from filtered list (same algorithm as findForumAncestors)
	const byId = new Map<number, ForumTreeEntry>();
	for (const f of visibleForums) byId.set(f.id, f);

	const ancestors: AncestorItem[] = [];
	let current = byId.get(target.parentId);
	while (current) {
		ancestors.push({ id: current.id, parentId: current.parentId, name: current.name });
		if (current.parentId === 0 || current.parentId === current.id) break;
		current = byId.get(current.parentId);
	}
	ancestors.reverse(); // root → parent order

	// Build forum context
	const forumContext: ForumContext = {
		id: target.id,
		parentId: target.parentId,
		name: target.name,
		status: target.status,
		visibility: target.visibility,
		type: target.type,
		moderators: target.moderators,
		moderatorIds: target.moderatorIds,
		moderatorList: target.moderatorList,
	};

	return jsonResponse({ forum: forumContext, ancestors }, origin);
}
