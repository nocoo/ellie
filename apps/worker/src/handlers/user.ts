import { decodeGenericCursor, encodeGenericCursor } from "@ellie/types";
import type { Env } from "../lib/env";
import { toPost, toPublicUser, toThread } from "../lib/mappers";
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

/** Clamp limit to [1, MAX_HISTORY_LIMIT] */
function clampLimit(limitParam: string | null): number {
	const n = limitParam ? Number.parseInt(limitParam, 10) : undefined;
	return n === undefined || n <= 0 ? DEFAULT_HISTORY_LIMIT : Math.min(n, MAX_HISTORY_LIMIT);
}

// ─── Handlers ────────────────────────────────────────────────

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
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const userId = parseUserIdFromParent(url);

	if (Number.isNaN(userId) || userId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid userId" }, origin);
	}

	// Get user auth for visibility filtering (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumFilter(visCtx);

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr
		? decodeGenericCursor<UserHistoryCursor>(cursorStr, isHistoryCursor)
		: null;

	let result: D1Result;
	if (cursor) {
		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE t.author_id = ? AND ${threadVisible("t")} AND ${forumFilter}
			 AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
			 ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit)
			.all();
	} else {
		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE t.author_id = ? AND ${threadVisible("t")} AND ${forumFilter}
			 ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(userId, clampedLimit)
			.all();
	}

	const threads = result.results.map((row) => toThread(row as Record<string, unknown>));

	let nextCursor: string | null = null;
	if (threads.length === clampedLimit && threads.length > 0) {
		const last = threads[threads.length - 1];
		nextCursor = encodeGenericCursor<UserHistoryCursor>({ createdAt: last.createdAt, id: last.id });
	}

	return jsonResponse(threads, origin, { nextCursor });
}

/** GET /api/v1/users/:id/posts - List user's posts with keyset pagination */
export async function listPosts(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const userId = parseUserIdFromParent(url);

	if (Number.isNaN(userId) || userId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid userId" }, origin);
	}

	// Get user auth for visibility filtering (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumFilter(visCtx);

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr
		? decodeGenericCursor<UserHistoryCursor>(cursorStr, isHistoryCursor)
		: null;

	let result: D1Result;
	if (cursor) {
		result = await env.DB.prepare(
			`SELECT p.* FROM posts p
			 INNER JOIN threads t ON p.thread_id = t.id
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE p.author_id = ? AND ${postVisible("p")} AND ${threadVisible("t")} AND ${forumFilter}
			 AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?))
			 ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
		)
			.bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit)
			.all();
	} else {
		result = await env.DB.prepare(
			`SELECT p.* FROM posts p
			 INNER JOIN threads t ON p.thread_id = t.id
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE p.author_id = ? AND ${postVisible("p")} AND ${threadVisible("t")} AND ${forumFilter}
			 ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
		)
			.bind(userId, clampedLimit)
			.all();
	}

	const posts = result.results.map((row) => toPost(row as Record<string, unknown>));

	let nextCursor: string | null = null;
	if (posts.length === clampedLimit && posts.length > 0) {
		const last = posts[posts.length - 1];
		nextCursor = encodeGenericCursor<UserHistoryCursor>({ createdAt: last.createdAt, id: last.id });
	}

	return jsonResponse(posts, origin, { nextCursor });
}

/** GET /api/v1/users/:id/digest - List user's digest threads with keyset pagination */
export async function listDigest(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const userId = parseUserIdFromParent(url);

	if (Number.isNaN(userId) || userId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid userId" }, origin);
	}

	// Get user auth for visibility filtering (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumFilter(visCtx);

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr
		? decodeGenericCursor<UserHistoryCursor>(cursorStr, isHistoryCursor)
		: null;

	let result: D1Result;
	if (cursor) {
		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE t.author_id = ? AND t.digest > 0 AND ${threadVisible("t")} AND ${forumFilter}
			 AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
			 ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit)
			.all();
	} else {
		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE t.author_id = ? AND t.digest > 0 AND ${threadVisible("t")} AND ${forumFilter}
			 ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(userId, clampedLimit)
			.all();
	}

	const threads = result.results.map((row) => toThread(row as Record<string, unknown>));

	let nextCursor: string | null = null;
	if (threads.length === clampedLimit && threads.length > 0) {
		const last = threads[threads.length - 1];
		nextCursor = encodeGenericCursor<UserHistoryCursor>({ createdAt: last.createdAt, id: last.id });
	}

	return jsonResponse(threads, origin, { nextCursor });
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
	const limitParam = url.searchParams.get("limit");
	const limitNum = limitParam ? Number.parseInt(limitParam, 10) : undefined;
	const clampedLimit =
		limitNum === undefined || limitNum <= 0
			? DEFAULT_SEARCH_LIMIT
			: Math.min(limitNum, MAX_SEARCH_LIMIT);

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
