import type { Forum, ModeratorInfo } from "@ellie/types";
import type { ForumVisibility } from "@ellie/types";
import { computeVisibilityBucket } from "../lib/cache/bucket";
import {
	getForumMetaV2,
	getForumSummaryV2,
	getForumTreeV2,
	lazyForumSnapshot,
	mergeTreeAndSummary,
} from "../lib/cache/forum-read";
import type { Env } from "../lib/env";
import { parseModeratorIds, toForum } from "../lib/mappers";
import { parseIdFromPath, parsePathSegment } from "../lib/parseId";
import { THREAD_VISIBLE, buildVisibilityContext } from "../lib/visibility";

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

/** GET /api/v1/forums - List all forums (no pagination) */
export async function list(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Forum read path is v2-only: bucket-aware tree + summary, lazy expansion.
	// Cache hit ⇒ 0 SQL (auth verify aside): summary payload already carries
	// `lastPosterAvatar` / `lastPosterAvatarPath`.
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const bucket = computeVisibilityBucket(visCtx);
	const loadSnapshot = lazyForumSnapshot(env);
	const [tree, aggregates] = await Promise.all([
		getForumTreeV2(env, ctx, bucket, loadSnapshot),
		getForumSummaryV2(env, ctx, bucket, loadSnapshot),
	]);
	return jsonResponse(mergeTreeAndSummary(tree, aggregates), origin);
}

/**
 * Load a single forum row from D1 with all enrichment needed by the public
 * `Forum` response: moderator list, visible last-thread info, today count,
 * and last-poster avatar (resolved against the *visible* last poster, NOT
 * `forums.last_poster_id`, since the row may point at a hidden / recycled
 * thread). Returns `null` when the row doesn't exist. Used by the v2
 * `forum:meta:v2` miss path so cache writes always carry the full payload.
 *
 * Status / visibility filtering is left to the caller — this loader returns
 * the raw row whether or not the bucket can see it.
 */
async function loadFullForumFromD1(env: Env, id: number): Promise<Forum | null> {
	// Do NOT JOIN `users` on `forums.last_poster_id` here: when the row
	// points at a hidden / recycled thread, the visible-last-thread
	// override below uses a different poster and the JOIN'd avatar would
	// be wrong. Avatar is resolved AFTER visible-last-thread is known.
	const result = await env.DB.prepare("SELECT * FROM forums WHERE id = ?").bind(id).first();
	if (!result) return null;

	const r = result as Record<string, unknown>;
	const forum = toForum(r);

	const moderatorIdsStr = (r.moderator_ids as string) ?? "";
	const moderatorIds = parseModeratorIds(moderatorIdsStr);

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
		forum.moderatorList = buildModeratorList(moderatorIdsStr, moderatorNameMap);
	}

	const visible = visibleLastThreads.get(id);
	if (visible) {
		forum.lastThreadId = visible.threadId;
		forum.lastThreadSubject = visible.subject;
		forum.lastPostAt = visible.lastPostAt;
		forum.lastPosterId = visible.lastPosterId;
		forum.lastPoster = visible.lastPoster;

		// Resolve the visible poster's avatar in a single targeted lookup.
		if (visible.lastPosterId > 0) {
			const av = await env.DB.prepare("SELECT avatar, avatar_path FROM users WHERE id = ?")
				.bind(visible.lastPosterId)
				.first<{ avatar: string | null; avatar_path: string | null }>();
			forum.lastPosterAvatar = (av?.avatar ?? "") || "";
			forum.lastPosterAvatarPath = (av?.avatar_path ?? "") || "";
		} else {
			forum.lastPosterAvatar = "";
			forum.lastPosterAvatarPath = "";
		}
	} else {
		forum.lastThreadId = 0;
		forum.lastThreadSubject = "";
		forum.lastPostAt = 0;
		forum.lastPosterId = 0;
		forum.lastPoster = "";
		forum.lastPosterAvatar = "";
		forum.lastPosterAvatarPath = "";
	}

	forum.todayThreads = countResult?.cnt ?? 0;

	return forum;
}

/** GET /api/v1/forums/:id - Get forum by ID */
export async function getById(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request) ?? Number.NaN;

	// Forum read path is v2-only.
	// `forum:meta:v2:<id>:<bucket>:g<gen>`. Cache hit ⇒ 0 SQL.
	// Miss → load row from D1, distinguish 404 (missing/inactive) vs.
	// 403 (visible mismatch) vs. 200 (write KV). 403/404 NEVER write KV.
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const bucket = computeVisibilityBucket(visCtx);

	const result = await getForumMetaV2(env, ctx, id, bucket, () => loadFullForumFromD1(env, id));

	if (result.kind === "notFound") {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}
	if (result.kind === "forbidden") {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this forum" },
			origin,
		);
	}
	return jsonResponse(result.forum, origin);
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
 * ancestor chain (root → parent), computed from the v2 KV-cached forum tree
 * which is already pre-filtered to active + visible nodes for the bucket.
 * Hidden parents are absent from the tree, so the ancestor chain naturally
 * terminates at the first hidden link.
 */
export async function getAncestors(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Parse forum ID from path: /api/v1/forums/:id/ancestors
	const forumId = parsePathSegment(request, 1);
	if (!forumId || forumId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	// Get optional user auth for visibility filtering
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const bucket = computeVisibilityBucket(visCtx);
	const loadSnapshot = lazyForumSnapshot(env);
	const visibleNodes = await getForumTreeV2(env, ctx, bucket, loadSnapshot);

	const target = visibleNodes.find((n) => n.id === forumId);
	if (!target) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}

	const byId = new Map<number, (typeof visibleNodes)[number]>();
	for (const n of visibleNodes) byId.set(n.id, n);

	const ancestors: AncestorItem[] = [];
	let current = byId.get(target.parentId);
	while (current) {
		ancestors.push({ id: current.id, parentId: current.parentId, name: current.name });
		if (current.parentId === 0 || current.parentId === current.id) break;
		current = byId.get(current.parentId);
	}
	ancestors.reverse();

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
