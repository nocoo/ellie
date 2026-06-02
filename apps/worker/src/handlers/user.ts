import { decodeGenericCursor } from "@ellie/types";
import type { Env } from "../lib/env";
import { toPublicUser, toThread, toUserPostHistoryItem } from "../lib/mappers";
import { buildNextCursor, clampLimit } from "../lib/pagination";
import { parseIdFromPath, parsePathSegment } from "../lib/parseId";
import { jsonResponse } from "../lib/response";
import {
	USER_ACTIVE,
	buildForumFilter,
	buildVisibilityContext,
	postVisible,
	threadVisible,
} from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

/** Explicit PublicUser columns — never SELECT * to avoid leaking sensitive fields */
const PUBLIC_USER_COLUMNS =
	"id, username, avatar, avatar_path, role, reg_date, threads, posts, credits, coins, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, last_activity, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, campus, reg_ip, last_ip";

/**
 * LEFT JOIN to surface daily check-in stats from `user_checkins`.
 * Aliased to `checkin_*` to match the optional fields on `D1UserRow`
 * consumed by `toUser` / `toPublicUser`.
 */
const CHECKIN_JOIN_COLUMNS =
	"c.total_days AS checkin_total_days, c.month_days AS checkin_month_days, c.streak_days AS checkin_streak_days, c.last_checkin_at AS checkin_last_checkin_at";
const CHECKIN_JOIN_CLAUSE = "LEFT JOIN user_checkins c ON c.user_id = users.id";

/** Default/max page sizes for user history endpoints */
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

/** Default/max limits for user search */
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 20;

// ─── Cursor helpers ──────────────────────────────────────────

interface UserHistoryCursor {
	createdAt: number;
	id: number;
}

/** Validate user history cursor payload shape */
function isHistoryCursor(p: Partial<UserHistoryCursor>): boolean {
	return typeof p.createdAt === "number" && typeof p.id === "number";
}

/** Parse userId from the second-to-last URL path segment: /api/v1/users/:id/threads */
function parseUserIdFromParent(request: Request): number {
	return parsePathSegment(request, 1) ?? Number.NaN;
}

/**
 * Shared scaffolding for the user history endpoints (`listThreads`,
 * `listPosts`, `listDigest`). They all follow the same pattern:
 *   1. parse + validate `userId`
 *   2. resolve verified auth + visibility context
 *   3. clamp `limit`, decode optional cursor
 *   4. run a 2-form keyset query (with / without cursor)
 *   5. map rows + emit `nextCursor`
 * Centralising it removes ~120 lines of near-identical code and makes
 * adding a new history endpoint a one-liner.
 */
async function runUserHistoryQuery<T>(
	request: Request,
	env: Env,
	opts: {
		buildQuery: (
			forumFilter: string,
			withCursor: boolean,
			ctx: {
				profileUserId: number;
				viewer: { userId: number; role: number } | null;
			},
		) => string;
		mapper: (row: Record<string, unknown>, viewer: { userId: number; role: number } | null) => T;
		/**
		 * Extract the keyset cursor from a mapped item. Default: read top-level
		 * `createdAt` + `id`. Composite items (e.g. `{ post, thread }`) must
		 * override this so the cursor stays anchored on the leading table.
		 */
		cursorOf?: (item: T) => UserHistoryCursor;
	},
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const userId = parseUserIdFromParent(request);

	if (Number.isNaN(userId) || userId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid userId" }, origin);
	}

	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumFilter(visCtx);
	const viewer = user ? { userId: user.userId, role: user.role } : null;

	const clampedLimit = clampLimit(url.searchParams.get("limit"), {
		defaultLimit: DEFAULT_HISTORY_LIMIT,
		maxLimit: MAX_HISTORY_LIMIT,
	});
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr
		? decodeGenericCursor<UserHistoryCursor>(cursorStr, isHistoryCursor)
		: null;

	const query = opts.buildQuery(forumFilter, cursor !== null, {
		profileUserId: userId,
		viewer,
	});
	const result: D1Result = cursor
		? await env.DB.prepare(query)
				.bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit)
				.all()
		: await env.DB.prepare(query).bind(userId, clampedLimit).all();

	const items: T[] = new Array(result.results.length);
	for (let i = 0; i < result.results.length; i++) {
		items[i] = opts.mapper(result.results[i] as Record<string, unknown>, viewer);
	}

	const cursorOf =
		opts.cursorOf ??
		((last: T) => {
			const r = last as unknown as UserHistoryCursor;
			return { createdAt: r.createdAt, id: r.id };
		});
	const nextCursor = buildNextCursor<T, UserHistoryCursor>(items, clampedLimit, cursorOf);

	return jsonResponse(items, origin, { nextCursor });
}

// ─── Handlers ────────────────────────────────────────────────

/** Max IDs per batch request */
const MAX_BATCH_IDS = 100;

/**
 * GET /api/v1/users/batch?ids=1,2,3 - Batch user lookup
 *
 * Returns public profiles for multiple users in a single request.
 * Designed to eliminate N+1 per-author fetches in thread detail pages.
 *
 * - Uses PUBLIC_USER_COLUMNS (no sensitive field leaks)
 * - Staff viewers see IP fields (same as getById)
 * - Caps at 100 IDs, deduplicates, filters invalid
 * - Omits non-existent and non-public users (status < 0) silently
 */
export async function batchGet(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const idsParam = url.searchParams.get("ids");

	if (!idsParam) {
		return errorResponse("INVALID_REQUEST", 400, { message: "ids parameter is required" }, origin);
	}

	// Parse, deduplicate, and validate IDs
	const rawIds = idsParam.split(",").map((s) => Number.parseInt(s.trim(), 10));
	const uniqueIds = [...new Set(rawIds.filter((id) => !Number.isNaN(id) && id > 0))];

	if (uniqueIds.length === 0) {
		return jsonResponse([], origin);
	}

	if (uniqueIds.length > MAX_BATCH_IDS) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: `Too many IDs (max ${MAX_BATCH_IDS})` },
			origin,
		);
	}

	// Auth lookup is independent of the batch query — fire it eagerly so it
	// overlaps in production.
	const viewerPromise = optionalAuthVerified(request, env);

	// Batch query with IN clause (SQLite limit is 999 vars, we cap at 100)
	const placeholders = uniqueIds.map(() => "?").join(",");
	const [viewer, result] = await Promise.all([
		viewerPromise,
		env.DB.prepare(
			`SELECT ${PUBLIC_USER_COLUMNS}, status, ${CHECKIN_JOIN_COLUMNS} FROM users ${CHECKIN_JOIN_CLAUSE} WHERE users.id IN (${placeholders})`,
		)
			.bind(...uniqueIds)
			.all<Record<string, unknown>>(),
	]);
	const isStaff = viewer !== null && viewer.role >= 1;

	// Filter out non-public users and map to PublicUser
	const users = result.results
		.filter((row) => (row.status as number) >= 0)
		.map((row) => toPublicUser(row, isStaff));

	return jsonResponse(users, origin);
}

/** GET /api/v1/users/:id - Get user public profile */
export async function getById(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parseIdFromPath(request) ?? Number.NaN;

	// Fire auth + user-row queries in parallel — they're independent.
	const [viewer, result] = await Promise.all([
		optionalAuthVerified(request, env),
		env.DB.prepare(
			`SELECT ${PUBLIC_USER_COLUMNS}, status, ${CHECKIN_JOIN_COLUMNS} FROM users ${CHECKIN_JOIN_CLAUSE} WHERE users.id = ?`,
		)
			.bind(id)
			.first<Record<string, unknown>>(),
	]);

	if (!result) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	// Return 404 for non-public users:
	// status = -1: banned
	// status = -2: archived (historical, cannot login)
	// status = -3: placeholder (deleted user placeholder)
	if ((result.status as number) < 0) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	const isStaff = viewer !== null && viewer.role >= 1;

	return jsonResponse(toPublicUser(result, isStaff), origin);
}

/**
 * GET /api/v1/users/:id/avatar-path - Get user's avatar_path for avatar proxy
 *
 * Internal endpoint for avatar resolution. Does NOT check user status,
 * allowing avatar display for banned/archived users whose historical posts
 * are still visible.
 *
 * Returns:
 * - { data: { avatarPath: "avatars/xxx.jpg" } } if user has GUID-based avatar
 * - { data: { avatarPath: "" } } if user exists but no GUID avatar (use legacy path)
 * - 404 if user doesn't exist at all
 */
export async function getAvatarPath(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const id = parsePathSegment(request, 1);

	if (id === null || id <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid userId" }, origin);
	}

	const result = await env.DB.prepare("SELECT avatar_path FROM users WHERE id = ?")
		.bind(id)
		.first<{ avatar_path: string }>();

	if (!result) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse({ avatarPath: result.avatar_path ?? "" }, origin);
}

/**
 * SQL fragment that filters out anonymous-flagged rows from a user-history
 * listing.
 *
 * Even when the row's author_id/author_name are masked by the serializer, the
 * URL `/api/v1/users/:id/posts` still encodes the implicit claim "these rows
 * belong to user :id" — so anonymous content must be excluded from the
 * listing itself. Skip the filter for staff and for the profile owner viewing
 * their own history.
 *
 * `column` is the literal column reference (e.g. `p.anonymous` or
 * `t.anonymous_author`) — produced by the caller to keep this helper alias-
 * agnostic.
 */
export function anonymousHistoryFilter(
	column: string,
	profileUserId: number,
	viewer: { userId: number; role: number } | null,
): string {
	if (viewer === null) return `${column} = 0`;
	if (viewer.role === 1 || viewer.role === 2 || viewer.role === 3) return "1=1";
	if (viewer.userId === profileUserId) return "1=1";
	return `${column} = 0`;
}

/** GET /api/v1/users/:id/threads - List user's threads with keyset pagination */
export async function listThreads(request: Request, env: Env): Promise<Response> {
	return runUserHistoryQuery(request, env, {
		buildQuery: (forumFilter, withCursor, ctx) => {
			const anonFilter = anonymousHistoryFilter(
				"t.anonymous_author",
				ctx.profileUserId,
				ctx.viewer,
			);
			return withCursor
				? `SELECT t.* FROM threads t
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE t.author_id = ? AND ${anonFilter} AND ${threadVisible("t")} AND ${forumFilter}
				   AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
				   ORDER BY t.created_at DESC, t.id DESC LIMIT ?`
				: `SELECT t.* FROM threads t
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE t.author_id = ? AND ${anonFilter} AND ${threadVisible("t")} AND ${forumFilter}
				   ORDER BY t.created_at DESC, t.id DESC LIMIT ?`;
		},
		mapper: (row, viewer) => toThread(row, viewer),
	});
}

/**
 * GET /api/v1/users/:id/posts - List user's posts with keyset pagination.
 *
 * Each item is a `UserPostHistoryItem` ({ post, thread }) so the profile page
 * can render a forum-list-style row (title/forum/replies/views/time) without
 * an extra per-row thread lookup. The thread columns are projected with
 * explicit `thread_*` aliases so they cannot collide with `p.*`. The cursor
 * stays anchored on `p.created_at, p.id` — joined thread fields must never
 * influence pagination order.
 *
 * Filters out the user's own thread first-posts (`p.is_first = 0`): "回复"
 * means *replies*, so a user's own opening post belongs in the 主题 tab and
 * would otherwise duplicate-display here. Without this filter the 回复 tab
 * mixes in subjects the user authored, which is exactly the regression
 * reported on the user-profile page.
 */
export async function listPosts(request: Request, env: Env): Promise<Response> {
	const postColumns =
		"p.id, p.thread_id, p.forum_id, p.author_id, p.author_name, p.content, p.created_at, p.is_first, p.position, p.anonymous";
	const threadColumns =
		"t.id AS thread_id_for_link, t.forum_id AS thread_forum_id, t.subject AS thread_subject, t.replies AS thread_replies, t.views AS thread_views, t.created_at AS thread_created_at, t.last_post_at AS thread_last_post_at, t.closed AS thread_closed, t.sticky AS thread_sticky, t.digest AS thread_digest, t.special AS thread_special, t.highlight AS thread_highlight, t.type_name AS thread_type_name";
	const selectColumns = `${postColumns}, ${threadColumns}`;
	return runUserHistoryQuery(request, env, {
		buildQuery: (forumFilter, withCursor, ctx) => {
			const anonFilter = anonymousHistoryFilter("p.anonymous", ctx.profileUserId, ctx.viewer);
			return withCursor
				? `SELECT ${selectColumns} FROM posts p
				   INNER JOIN threads t ON p.thread_id = t.id
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE p.author_id = ? AND p.is_first = 0 AND ${anonFilter} AND ${postVisible("p")} AND ${threadVisible("t")} AND ${forumFilter}
				   AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))
				   ORDER BY p.created_at DESC, p.id DESC LIMIT ?`
				: `SELECT ${selectColumns} FROM posts p
				   INNER JOIN threads t ON p.thread_id = t.id
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE p.author_id = ? AND p.is_first = 0 AND ${anonFilter} AND ${postVisible("p")} AND ${threadVisible("t")} AND ${forumFilter}
				   ORDER BY p.created_at DESC, p.id DESC LIMIT ?`;
		},
		mapper: (row, viewer) => toUserPostHistoryItem(row, viewer),
		// Cursor must follow the leading table (posts), not the joined thread.
		cursorOf: (item) => ({ createdAt: item.post.createdAt, id: item.post.id }),
	});
}

/** GET /api/v1/users/:id/digest - List user's digest threads with keyset pagination */
export async function listDigest(request: Request, env: Env): Promise<Response> {
	return runUserHistoryQuery(request, env, {
		buildQuery: (forumFilter, withCursor, ctx) => {
			const anonFilter = anonymousHistoryFilter(
				"t.anonymous_author",
				ctx.profileUserId,
				ctx.viewer,
			);
			return withCursor
				? `SELECT t.* FROM threads t
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE t.author_id = ? AND t.digest > 0 AND ${anonFilter} AND ${threadVisible("t")} AND ${forumFilter}
				   AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
				   ORDER BY t.created_at DESC, t.id DESC LIMIT ?`
				: `SELECT t.* FROM threads t
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE t.author_id = ? AND t.digest > 0 AND ${anonFilter} AND ${threadVisible("t")} AND ${forumFilter}
				   ORDER BY t.created_at DESC, t.id DESC LIMIT ?`;
		},
		mapper: (row, viewer) => toThread(row, viewer),
	});
}

/**
 * GET /api/v1/users/search - Search users by username prefix
 *
 * Used for autocomplete in private messaging compose dialog.
 * Only returns normal users (status >= 0).
 *
 * Query params:
 * - q: search keyword (required, min 2 chars)
 * - limit: max results (default 10, max 20)
 */
export async function search(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	const query = url.searchParams.get("q")?.trim();
	if (!query || query.length < 2) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "Search query must be at least 2 characters" },
			origin,
		);
	}

	// Clamp limit
	const clampedLimit = clampLimit(url.searchParams.get("limit"), {
		defaultLimit: DEFAULT_SEARCH_LIMIT,
		maxLimit: MAX_SEARCH_LIMIT,
	});

	// Prefix match on username, only normal users (status >= 0)
	// Escape special LIKE characters
	const escapedQuery = query.replace(/[%_\\]/g, "\\$&");
	const result = await env.DB.prepare(
		`SELECT id, username FROM users WHERE username LIKE ? ESCAPE '\\' AND ${USER_ACTIVE} ORDER BY username LIMIT ?`,
	)
		.bind(`${escapedQuery}%`, clampedLimit)
		.all<{ id: number; username: string }>();

	const users = result.results.map((row) => ({
		id: row.id,
		username: row.username,
	}));

	return jsonResponse(users, origin);
}
