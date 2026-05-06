import { decodeGenericCursor, encodeGenericCursor } from "@ellie/types";
import type { Env } from "../lib/env";
import { toPost, toPublicUser, toThread } from "../lib/mappers";
import { clampLimit } from "../lib/pagination";
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
	"id, username, avatar, avatar_path, role, reg_date, threads, posts, credits, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, last_activity, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, reg_ip, last_ip";

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
function parseUserIdFromParent(url: URL): number {
	const parts = url.pathname.split("/");
	return Number.parseInt(parts[parts.length - 2] ?? "0", 10);
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
async function runUserHistoryQuery<T extends { createdAt: number; id: number }>(
	request: Request,
	env: Env,
	opts: {
		buildQuery: (forumFilter: string, withCursor: boolean) => string;
		mapper: (row: Record<string, unknown>) => T;
	},
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const userId = parseUserIdFromParent(url);

	if (Number.isNaN(userId) || userId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid userId" }, origin);
	}

	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumFilter(visCtx);

	const clampedLimit = clampLimit(url.searchParams.get("limit"), {
		defaultLimit: DEFAULT_HISTORY_LIMIT,
		maxLimit: MAX_HISTORY_LIMIT,
	});
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr
		? decodeGenericCursor<UserHistoryCursor>(cursorStr, isHistoryCursor)
		: null;

	const query = opts.buildQuery(forumFilter, cursor !== null);
	const result: D1Result = cursor
		? await env.DB.prepare(query)
				.bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit)
				.all()
		: await env.DB.prepare(query).bind(userId, clampedLimit).all();

	const items: T[] = new Array(result.results.length);
	for (let i = 0; i < result.results.length; i++) {
		items[i] = opts.mapper(result.results[i] as Record<string, unknown>);
	}

	let nextCursor: string | null = null;
	if (items.length === clampedLimit && items.length > 0) {
		const last = items[items.length - 1];
		nextCursor = encodeGenericCursor<UserHistoryCursor>({
			createdAt: last.createdAt,
			id: last.id,
		});
	}

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

	// Check if requester is staff (role >= 1) for IP field visibility
	const viewer = await optionalAuthVerified(request, env);
	const isStaff = viewer !== null && viewer.role >= 1;

	// Batch query with IN clause (SQLite limit is 999 vars, we cap at 100)
	const placeholders = uniqueIds.map(() => "?").join(",");
	const result = await env.DB.prepare(
		`SELECT ${PUBLIC_USER_COLUMNS}, status FROM users WHERE id IN (${placeholders})`,
	)
		.bind(...uniqueIds)
		.all<Record<string, unknown>>();

	// Filter out non-public users and map to PublicUser
	const users = result.results
		.filter((row) => (row.status as number) >= 0)
		.map((row) => toPublicUser(row, isStaff));

	return jsonResponse(users, origin);
}

/** GET /api/v1/users/:id - Get user public profile */
export async function getById(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	const result = await env.DB.prepare(
		`SELECT ${PUBLIC_USER_COLUMNS}, status FROM users WHERE id = ?`,
	)
		.bind(id)
		.first<Record<string, unknown>>();

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

	// Check if requester is admin/mod (role >= 1) to include IP fields
	const viewer = await optionalAuthVerified(request, env);
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
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	// Path: /api/v1/users/:id/avatar-path -> id is second-to-last
	const idStr = pathParts[pathParts.length - 2];
	const id = Number.parseInt(idStr ?? "0", 10);

	if (Number.isNaN(id) || id <= 0) {
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

/** GET /api/v1/users/:id/threads - List user's threads with keyset pagination */
export async function listThreads(request: Request, env: Env): Promise<Response> {
	return runUserHistoryQuery(request, env, {
		buildQuery: (forumFilter, withCursor) =>
			withCursor
				? `SELECT t.* FROM threads t
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE t.author_id = ? AND ${threadVisible("t")} AND ${forumFilter}
				   AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
				   ORDER BY t.created_at DESC, t.id DESC LIMIT ?`
				: `SELECT t.* FROM threads t
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE t.author_id = ? AND ${threadVisible("t")} AND ${forumFilter}
				   ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		mapper: (row) => toThread(row),
	});
}

/** GET /api/v1/users/:id/posts - List user's posts with keyset pagination */
export async function listPosts(request: Request, env: Env): Promise<Response> {
	return runUserHistoryQuery(request, env, {
		buildQuery: (forumFilter, withCursor) =>
			withCursor
				? `SELECT p.* FROM posts p
				   INNER JOIN threads t ON p.thread_id = t.id
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE p.author_id = ? AND ${postVisible("p")} AND ${threadVisible("t")} AND ${forumFilter}
				   AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))
				   ORDER BY p.created_at DESC, p.id DESC LIMIT ?`
				: `SELECT p.* FROM posts p
				   INNER JOIN threads t ON p.thread_id = t.id
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE p.author_id = ? AND ${postVisible("p")} AND ${threadVisible("t")} AND ${forumFilter}
				   ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
		mapper: (row) => toPost(row),
	});
}

/** GET /api/v1/users/:id/digest - List user's digest threads with keyset pagination */
export async function listDigest(request: Request, env: Env): Promise<Response> {
	return runUserHistoryQuery(request, env, {
		buildQuery: (forumFilter, withCursor) =>
			withCursor
				? `SELECT t.* FROM threads t
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE t.author_id = ? AND t.digest > 0 AND ${threadVisible("t")} AND ${forumFilter}
				   AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
				   ORDER BY t.created_at DESC, t.id DESC LIMIT ?`
				: `SELECT t.* FROM threads t
				   INNER JOIN forums f ON t.forum_id = f.id
				   WHERE t.author_id = ? AND t.digest > 0 AND ${threadVisible("t")} AND ${forumFilter}
				   ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		mapper: (row) => toThread(row),
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
