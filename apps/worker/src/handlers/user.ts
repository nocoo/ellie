// User handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { toPost, toPublicUser, toThread } from "../lib/mappers";
import { jsonResponse } from "../lib/response";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** Explicit PublicUser columns — never SELECT * to avoid leaking sensitive fields */
const PUBLIC_USER_COLUMNS = "id, username, avatar, role, reg_date, threads, posts, credits";

/** Default/max page sizes for user history endpoints */
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 50;

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

	const result = await env.DB.prepare(`SELECT ${PUBLIC_USER_COLUMNS} FROM users WHERE id = ?`)
		.bind(id)
		.first();

	if (!result) {
		return errorResponse("USER_NOT_FOUND", 404, undefined, origin);
	}

	return jsonResponse(toPublicUser(result as Record<string, unknown>), origin);
}

/** GET /api/v1/users/:id/threads - List user's threads with keyset pagination */
export async function listThreads(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);
	const userId = parseUserIdFromParent(url);

	if (Number.isNaN(userId) || userId <= 0) {
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid userId" }, origin);
	}

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr ? decodeHistoryCursor(cursorStr) : null;

	let result: D1Result;
	if (cursor) {
		result = await env.DB.prepare(
			`SELECT * FROM threads WHERE author_id = ?
			 AND (created_at < ? OR (created_at = ? AND id < ?))
			 ORDER BY created_at DESC, id DESC LIMIT ?`,
		)
			.bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit)
			.all();
	} else {
		result = await env.DB.prepare(
			"SELECT * FROM threads WHERE author_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
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

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr ? decodeHistoryCursor(cursorStr) : null;

	let result: D1Result;
	if (cursor) {
		result = await env.DB.prepare(
			`SELECT * FROM posts WHERE author_id = ?
			 AND (created_at < ? OR (created_at = ? AND id < ?))
			 ORDER BY created_at DESC, id DESC LIMIT ?`,
		)
			.bind(userId, cursor.createdAt, cursor.createdAt, cursor.id, clampedLimit)
			.all();
	} else {
		result = await env.DB.prepare(
			"SELECT * FROM posts WHERE author_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
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
