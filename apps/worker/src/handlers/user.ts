// User handlers for Cloudflare Worker
import { UserRole } from "@ellie/types";
import type { VisibilityContext } from "@ellie/types";
import type { Env } from "../lib/env";
import { toPost, toPublicUser, toThread } from "../lib/mappers";
import { jsonResponse } from "../lib/response";
import { type AuthUser, optionalAuthVerified } from "../middleware/auth";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** Build visibility context from optional user */
function buildVisibilityContext(user: AuthUser | null): VisibilityContext {
	return {
		isLoggedIn: user !== null,
		role: user !== null ? user.role : UserRole.User,
	};
}

/**
 * Build SQL WHERE clause for forum visibility filtering.
 * Only includes forums that are:
 * - Active (status = 1)
 * - Visible to the current user based on their role
 */
function buildForumVisibilityFilter(visCtx: VisibilityContext): string {
	// Always filter out hidden/deleted/paused/QQ forums
	const statusFilter = "f.status = 1";

	// Visibility filter based on user context
	// public: everyone, members: logged in, staff: mod+, admin: admin only
	const visibilityConditions: string[] = ["f.visibility = 'public'"];

	if (visCtx.isLoggedIn) {
		visibilityConditions.push("f.visibility = 'members'");
	}
	// Staff: Mod (3), SuperMod (2), Admin (1)
	if (
		visCtx.role === UserRole.Mod ||
		visCtx.role === UserRole.SuperMod ||
		visCtx.role === UserRole.Admin
	) {
		visibilityConditions.push("f.visibility = 'staff'");
	}
	if (visCtx.role === UserRole.Admin) {
		visibilityConditions.push("f.visibility = 'admin'");
	}

	return `${statusFilter} AND (${visibilityConditions.join(" OR ")})`;
}

/** Explicit PublicUser columns — never SELECT * to avoid leaking sensitive fields */
const PUBLIC_USER_COLUMNS =
	"id, username, avatar, role, reg_date, threads, posts, credits, signature, group_title, group_stars, group_color, custom_title, digest_posts, ol_time, last_activity, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site";

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

function encodeHistoryCursor(payload: UserHistoryCursor): string {
	return btoa(JSON.stringify(payload));
}

function decodeHistoryCursor(cursor: string): UserHistoryCursor | null {
	try {
		const json = atob(cursor);
		const parsed = JSON.parse(json) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"createdAt" in parsed &&
			"id" in parsed &&
			typeof (parsed as UserHistoryCursor).createdAt === "number" &&
			typeof (parsed as UserHistoryCursor).id === "number"
		) {
			return parsed as UserHistoryCursor;
		}
		return null;
	} catch {
		return null;
	}
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

	return jsonResponse(toPublicUser(result), origin);
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
	const forumFilter = buildForumVisibilityFilter(visCtx);

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr ? decodeHistoryCursor(cursorStr) : null;

	let result: D1Result;
	if (cursor) {
		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE t.author_id = ? AND t.sticky >= 0 AND ${forumFilter}
			 AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
			 ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit)
			.all();
	} else {
		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE t.author_id = ? AND t.sticky >= 0 AND ${forumFilter}
			 ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(userId, clampedLimit)
			.all();
	}

	const threads = result.results.map((row) => toThread(row as Record<string, unknown>));

	let nextCursor: string | null = null;
	if (threads.length === clampedLimit && threads.length > 0) {
		const last = threads[threads.length - 1];
		nextCursor = encodeHistoryCursor({ createdAt: last.createdAt, id: last.id });
	}

	return new Response(
		JSON.stringify({
			data: threads,
			meta: { timestamp: Date.now(), requestId: crypto.randomUUID(), nextCursor },
		}),
		{ headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
	);
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
	const forumFilter = buildForumVisibilityFilter(visCtx);

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr ? decodeHistoryCursor(cursorStr) : null;

	let result: D1Result;
	if (cursor) {
		result = await env.DB.prepare(
			`SELECT p.* FROM posts p
			 INNER JOIN threads t ON p.thread_id = t.id
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE p.author_id = ? AND p.invisible = 0 AND t.sticky >= 0 AND ${forumFilter}
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
			 WHERE p.author_id = ? AND p.invisible = 0 AND t.sticky >= 0 AND ${forumFilter}
			 ORDER BY p.created_at DESC, p.id DESC LIMIT ?`,
		)
			.bind(userId, clampedLimit)
			.all();
	}

	const posts = result.results.map((row) => toPost(row as Record<string, unknown>));

	let nextCursor: string | null = null;
	if (posts.length === clampedLimit && posts.length > 0) {
		const last = posts[posts.length - 1];
		nextCursor = encodeHistoryCursor({ createdAt: last.createdAt, id: last.id });
	}

	return new Response(
		JSON.stringify({
			data: posts,
			meta: { timestamp: Date.now(), requestId: crypto.randomUUID(), nextCursor },
		}),
		{ headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
	);
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
	const forumFilter = buildForumVisibilityFilter(visCtx);

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr ? decodeHistoryCursor(cursorStr) : null;

	let result: D1Result;
	if (cursor) {
		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE t.author_id = ? AND t.digest > 0 AND t.sticky >= 0 AND ${forumFilter}
			 AND (t.created_at < ? OR (t.created_at = ? AND t.id < ?))
			 ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit)
			.all();
	} else {
		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE t.author_id = ? AND t.digest > 0 AND t.sticky >= 0 AND ${forumFilter}
			 ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(userId, clampedLimit)
			.all();
	}

	const threads = result.results.map((row) => toThread(row as Record<string, unknown>));

	let nextCursor: string | null = null;
	if (threads.length === clampedLimit && threads.length > 0) {
		const last = threads[threads.length - 1];
		nextCursor = encodeHistoryCursor({ createdAt: last.createdAt, id: last.id });
	}

	return new Response(
		JSON.stringify({
			data: threads,
			meta: { timestamp: Date.now(), requestId: crypto.randomUUID(), nextCursor },
		}),
		{ headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
	);
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
		"SELECT id, username FROM users WHERE username LIKE ? ESCAPE '\\' AND status >= 0 ORDER BY username LIMIT ?",
	)
		.bind(`${escapedQuery}%`, clampedLimit)
		.all<{ id: number; username: string }>();

	const users = result.results.map((row) => ({
		id: row.id,
		username: row.username,
	}));

	return jsonResponse(users, origin);
}
