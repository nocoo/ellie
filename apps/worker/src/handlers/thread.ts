import type { Thread } from "@ellie/types";
// Thread handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { corsHeaders } from "../middleware/cors";
import { errorResponse } from "../middleware/error";

/** Thread cursor payload for keyset pagination */
interface ThreadCursorPayload {
	sticky: number;
	lastPostAt: number;
	id: number;
}

/** Encode thread cursor to base64 */
function encodeThreadCursor(payload: ThreadCursorPayload): string {
	return btoa(JSON.stringify(payload));
}

/** Decode thread cursor from base64 */
function decodeThreadCursor(cursor: string): ThreadCursorPayload | null {
	try {
		const json = atob(cursor);
		const parsed = JSON.parse(json) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"sticky" in parsed &&
			"lastPostAt" in parsed &&
			"id" in parsed &&
			typeof (parsed as ThreadCursorPayload).sticky === "number" &&
			typeof (parsed as ThreadCursorPayload).lastPostAt === "number" &&
			typeof (parsed as ThreadCursorPayload).id === "number"
		) {
			return parsed as ThreadCursorPayload;
		}
		return null;
	} catch {
		return null;
	}
}

/** GET /api/v1/threads - List threads with keyset pagination */
export async function list(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const forumId = url.searchParams.get("forumId");
	const limitParam = url.searchParams.get("limit");
	const cursorStr = url.searchParams.get("cursor");

	// Clamp limit to [1, 50], defaulting to 20
	const DEFAULT_PAGE_SIZE = 20;
	const MAX_PAGE_SIZE = 50;
	const limitNum = limitParam ? Number.parseInt(limitParam, 10) : undefined;
	const clampedLimit =
		limitNum === undefined || limitNum <= 0 ? DEFAULT_PAGE_SIZE : Math.min(limitNum, MAX_PAGE_SIZE);

	if (!forumId) {
		return errorResponse("INVALID_REQUEST", 400, {
			message: "forumId is required",
		});
	}

	const forumIdNum = Number.parseInt(forumId, 10);
	if (Number.isNaN(forumIdNum)) {
		return errorResponse("INVALID_REQUEST", 400, {
			message: "Invalid forumId",
		});
	}

	const cursor = cursorStr ? decodeThreadCursor(cursorStr) : null;

	let result: D1Result;
	if (cursor) {
		// Keyset pagination: WHERE forum_id = ? AND (sticky < ? OR (sticky = ? AND (last_post_at < ? OR (last_post_at = ? AND id < ?))))
		const stmt = env.DB.prepare(
			`SELECT * FROM threads WHERE forum_id = ? AND
			 (sticky < ? OR (sticky = ? AND (last_post_at < ? OR (last_post_at = ? AND id < ?))))
			 ORDER BY sticky DESC, last_post_at DESC, id DESC LIMIT ?`,
		);
		result = await stmt
			.bind(
				forumIdNum,
				cursor.sticky,
				cursor.sticky,
				cursor.lastPostAt,
				cursor.lastPostAt,
				cursor.id,
				clampedLimit,
			)
			.all();
	} else {
		// First page
		const stmt = env.DB.prepare(
			"SELECT * FROM threads WHERE forum_id = ? ORDER BY sticky DESC, last_post_at DESC, id DESC LIMIT ?",
		);
		result = await stmt.bind(forumIdNum, clampedLimit).all();
	}

	const threads = result.results as Thread[];

	// Generate next cursor if we have more results
	let nextCursor: string | undefined;
	if (threads.length === clampedLimit && threads.length > 0) {
		const lastThread = threads[threads.length - 1];
		if (lastThread) {
			nextCursor = encodeThreadCursor({
				sticky: lastThread.sticky,
				lastPostAt: lastThread.lastPostAt,
				id: lastThread.id,
			});
		}
	}

	return new Response(
		JSON.stringify({
			data: threads,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
				nextCursor,
			},
		}),
		{
			headers: { ...corsHeaders(), "Content-Type": "application/json" },
		},
	);
}

/** GET /api/v1/threads/:id - Get thread by ID */
export async function getById(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const pathParts = url.pathname.split("/");
	const idStr = pathParts[pathParts.length - 1];
	const id = Number.parseInt(idStr ?? "0", 10);

	const stmt = env.DB.prepare("SELECT * FROM threads WHERE id = ?");
	const result = await stmt.bind(id).first();

	if (!result) {
		return errorResponse("THREAD_NOT_FOUND", 404);
	}

	return new Response(
		JSON.stringify({
			data: result as Thread,
			meta: {
				timestamp: Date.now(),
				requestId: crypto.randomUUID(),
			},
		}),
		{
			headers: { ...corsHeaders(), "Content-Type": "application/json" },
		},
	);
}
