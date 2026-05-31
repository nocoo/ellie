import type { Forum, ForumThreadType, ModeratorInfo } from "@ellie/types";
import type { ForumVisibility } from "@ellie/types";
import { canModerate } from "@ellie/types";
import { computeVisibilityBucket } from "../lib/cache/bucket";
import {
	getForumMetaV2,
	getForumSummaryV2,
	getForumTreeV2,
	lazyForumSnapshot,
	mergeTreeAndSummary,
} from "../lib/cache/forum-read";
import { invalidateForumUpdateV2 } from "../lib/cache/invalidate";
import {
	recordDelete,
	recordError,
	recordHit,
	recordMiss,
	recordRead,
	recordWrite,
	scheduleMetricsFlush,
} from "../lib/cache/metrics";
import type { Env } from "../lib/env";
import { ANONYMOUS_AUTHOR_NAME, parseModeratorIds, toForum } from "../lib/mappers";
import { parseIdFromPath, parsePathSegment } from "../lib/parseId";
import { getForumForPermission, getUserForPermission } from "../lib/permissionHelpers";
import { prepareAnnouncement } from "../lib/sanitizeAnnouncement";
import { THREAD_VISIBLE, buildVisibilityContext } from "../lib/visibility";

// Forum handlers for Cloudflare Worker
import { jsonResponse } from "../lib/response";
import { moderationMiddleware, optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

// ─── Thread types cache ───────────────────────────────────────────
const THREAD_TYPES_CACHE_TTL = 86_400; // 24h
const THREAD_TYPES_METRICS_FAMILY = "thread-types";

function threadTypesCacheKey(forumId: number): string {
	return `thread-types:${forumId}`;
}

/** Invalidate thread types cache for a forum. Export for admin handler. */
export async function invalidateThreadTypesCache(env: Env, forumId: number): Promise<void> {
	try {
		await env.KV.delete(threadTypesCacheKey(forumId));
		recordDelete(THREAD_TYPES_METRICS_FAMILY);
	} catch (err) {
		recordError(THREAD_TYPES_METRICS_FAMILY);
		console.warn("[thread-types] KV delete failed", err);
	}
}

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
	/** 1 = the thread's last post is anonymous; the caller masks lastPoster*. */
	anonymousLastPoster: number;
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
				`SELECT t.forum_id, t.id as thread_id, t.subject, t.last_post_at, t.last_poster_id, t.last_poster, t.anonymous_last_poster
				 FROM threads t
				 INNER JOIN (
					 SELECT forum_id, MAX(last_post_at) as max_post_at
					 FROM threads
					 WHERE forum_id IN (${placeholders}) AND sticky >= 0
					 GROUP BY forum_id
				 ) sub ON t.forum_id = sub.forum_id AND t.last_post_at = sub.max_post_at
				 WHERE t.sticky >= 0
				 ORDER BY t.last_post_at DESC, t.id DESC`,
			)
			.bind(...batch)
			.all<{
				forum_id: number;
				thread_id: number;
				subject: string;
				last_post_at: number;
				last_poster_id: number;
				last_poster: string;
				anonymous_last_poster: number;
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
					anonymousLastPoster: row.anonymous_last_poster === 1 ? 1 : 0,
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
export async function loadFullForumFromD1(env: Env, id: number): Promise<Forum | null> {
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
		// Anonymous last poster: forum-tree/summary cache is shared across
		// all viewers (bucket-independent), so we mask aggressively here.
		// Staff/self viewers see the masked label on the forum index and can
		// click into the thread detail to see the real author. Same trade-off
		// as thread:list:v2 (docs/19 §6).
		if (visible.anonymousLastPoster === 1) {
			forum.lastPosterId = 0;
			forum.lastPoster = ANONYMOUS_AUTHOR_NAME;
			forum.lastPosterAvatar = "";
			forum.lastPosterAvatarPath = "";
		} else {
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

// ─── Thread types endpoint ──────────────────────────────────────────

/**
 * Public thread-types payload for one forum.
 *
 *   • config flags mirror `forums.thread_types_*` — match Forum.threadTypes
 *     so callers that already have the Forum DTO can drop a redundant fetch.
 *   • `types` — only **enabled** rows from `forum_thread_types`. Tombstones
 *     (enabled=0) are intentionally excluded; they are render-only via the
 *     thread.type_name denorm column. Admin/debug endpoints get the full
 *     row set including source_typeid.
 *
 * Reviewer pin (msg b03d4af3 #1, #5): `id` is the synthetic global id, the
 * Discuz-local source_typeid is admin-only and not surfaced here.
 *
 * Reviewer pin (msg 07f1ad4e P1): rows are emitted as the shared
 * `ForumThreadType` DTO (id, name, displayOrder, icon, enabled,
 * moderatorOnly). The public endpoint only ever returns enabled rows so
 * `enabled` is structurally redundant on the wire — kept to match the
 * shared shape and to give #9 / future moderator UI room without a DTO
 * change.
 */
interface ThreadTypesPayload {
	enabled: boolean;
	required: boolean;
	listable: boolean;
	prefix: boolean;
	types: ForumThreadType[];
}

/**
 * GET /api/v1/forums/:forumId/thread-types
 *
 * Returns the per-forum 主题分类 picker payload. Visibility is enforced via
 * the v2 forum:meta cache path (same 403/404 semantics as `getById`); the
 * thread-types row set is cached in KV for 24h. Admin add/remove invalidates
 * the cache.
 *
 * Reviewer pin: empty `types[]` is valid (forum may have config switches
 * on but no rows — UI simply shows no picker entries).
 */
export async function getThreadTypes(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	const forumId = parsePathSegment(request, 1);
	if (!forumId || forumId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	// Reuse the v2 meta path for visibility / 403 / 404 semantics. Cheap
	// because cold-start populates `forum:meta:v2` and warm hits cost 0
	// SQL — the only D1 cost specific to this endpoint is the row read.
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const bucket = computeVisibilityBucket(visCtx);
	const meta = await getForumMetaV2(env, ctx, forumId, bucket, () =>
		loadFullForumFromD1(env, forumId),
	);
	if (meta.kind === "notFound") {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}
	if (meta.kind === "forbidden") {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "You don't have access to this forum" },
			origin,
		);
	}

	// Try KV cache first (thread types rarely change)
	const cacheKey = threadTypesCacheKey(forumId);
	recordRead(THREAD_TYPES_METRICS_FAMILY);
	try {
		const cached = await env.KV.get(cacheKey);
		if (cached) {
			recordHit(THREAD_TYPES_METRICS_FAMILY);
			scheduleMetricsFlush(env, ctx);
			return jsonResponse(JSON.parse(cached) as ThreadTypesPayload, origin);
		}
	} catch (err) {
		recordError(THREAD_TYPES_METRICS_FAMILY);
		console.warn("[thread-types] KV read failed", err);
	}
	recordMiss(THREAD_TYPES_METRICS_FAMILY);

	const cfg = meta.forum.threadTypes;
	const rows = await env.DB.prepare(
		`SELECT id, name, display_order, icon, enabled, moderator_only
		 FROM forum_thread_types
		 WHERE forum_id = ? AND enabled = 1
		 ORDER BY display_order ASC, id ASC`,
	)
		.bind(forumId)
		.all<{
			id: number;
			name: string;
			display_order: number;
			icon: string | null;
			enabled: number;
			moderator_only: number;
		}>();

	const types: ForumThreadType[] = rows.results.map((r) => ({
		id: r.id,
		name: r.name,
		displayOrder: r.display_order,
		icon: r.icon ?? "",
		enabled: r.enabled === 1,
		moderatorOnly: r.moderator_only === 1,
	}));

	const payload: ThreadTypesPayload = {
		enabled: cfg.enabled,
		required: cfg.required,
		listable: cfg.listable,
		prefix: cfg.prefix,
		types,
	};

	// Write to KV cache
	try {
		await env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: THREAD_TYPES_CACHE_TTL });
		recordWrite(THREAD_TYPES_METRICS_FAMILY);
	} catch (err) {
		recordError(THREAD_TYPES_METRICS_FAMILY);
		console.warn("[thread-types] KV write failed", err);
	}

	scheduleMetricsFlush(env, ctx);
	return jsonResponse(payload, origin);
}

// ─── PATCH /api/v1/forums/:id/announcement ────────────────────────
//
// Updates the public-facing forum announcement (the "本版规则" card
// at the top of a forum's thread list). Permission model:
//   1. `moderationMiddleware` — role ∈ {Admin, SuperMod, Mod} + not banned
//      + email verified (matches sticky / digest / close endpoints).
//   2. `canModerate(user, forum)` — Admin/SuperMod always pass; Mod must
//      have their username in `forum.moderators` (per-forum scope).
//
// Body: `{ announcement: string }` (4 KiB max post-sanitize). Empty
// string clears the announcement. The Worker is the security boundary —
// the Web UI hides the edit button for non-moderators but that is UX
// polish only; this endpoint is the only gate that matters.
//
// Cache invalidation: announcement is a non-digest-affecting field, so
// we use `invalidateForumUpdateV2(env, { affectsDigest: false })` which
// bumps tree + summary gens but not digest gen.
export async function setAnnouncement(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	const authResult = await moderationMiddleware(request, env);
	if (authResult instanceof Response) return authResult;

	const forumId = parsePathSegment(request, 1);
	if (forumId === null) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid forum ID" }, origin);
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		return errorResponse("INVALID_BODY", 400, { message: "Invalid JSON body" }, origin);
	}

	const prepared = prepareAnnouncement(body.announcement);
	if (!prepared.ok) {
		if (prepared.code === "INVALID_TYPE") {
			return errorResponse(
				"INVALID_BODY",
				400,
				{ message: "announcement must be a string" },
				origin,
			);
		}
		if (prepared.code === "TOO_LONG") {
			return errorResponse(
				"PAYLOAD_TOO_LARGE",
				400,
				{ message: "announcement exceeds 4 KiB after sanitize" },
				origin,
			);
		}
	}

	// `prepared.ok === true` from here on. Fetch user + forum for the
	// per-forum permission check. Both queries are required and run in
	// parallel — a Mod's scope is determined by `forum.moderators`.
	const [user, forum] = await Promise.all([
		getUserForPermission(env, authResult.user.userId),
		getForumForPermission(env, forumId),
	]);

	if (!forum) {
		return errorResponse("FORUM_NOT_FOUND", 404, undefined, origin);
	}
	if (!user) {
		return errorResponse(
			"INTERNAL_ERROR",
			500,
			{ message: "Failed to fetch permission data" },
			origin,
		);
	}

	if (!canModerate(user, forum)) {
		return errorResponse(
			"FORBIDDEN",
			403,
			{ message: "No permission to moderate this forum" },
			origin,
		);
	}

	// `prepared.html` is the sanitized payload that will live in D1.
	// Length is already capped to 4 KiB UTF-8 by `prepareAnnouncement`.
	await env.DB.prepare("UPDATE forums SET announcement = ? WHERE id = ?")
		.bind(prepared.html ?? "", forumId)
		.run();

	await invalidateForumUpdateV2(env, { affectsDigest: false });

	return jsonResponse({ id: forumId, announcement: prepared.html ?? "" }, origin);
}
