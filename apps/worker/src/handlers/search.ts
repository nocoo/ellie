// Search handlers for Cloudflare Worker
// FTS5 full-text search on thread subjects

import type { Thread } from "@ellie/types";
import type { Env } from "../lib/env";
import { isKvUserCacheEnabled } from "../lib/env";
import { enrichThreadsWithUserCache, toThread } from "../lib/mappers";
import { jsonResponse } from "../lib/response";
import { getUserProfiles } from "../lib/user-cache";
import { buildForumFilter, buildVisibilityContext, threadVisible } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

/** Search cursor payload (matches thread list cursor format) */
interface SearchCursorPayload {
	lastPostAt: number;
	id: number;
}

function encodeSearchCursor(payload: SearchCursorPayload): string {
	return btoa(JSON.stringify(payload));
}

function decodeSearchCursor(cursor: string): SearchCursorPayload | null {
	try {
		const json = atob(cursor);
		const parsed = JSON.parse(json) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"lastPostAt" in parsed &&
			"id" in parsed &&
			typeof (parsed as SearchCursorPayload).lastPostAt === "number" &&
			typeof (parsed as SearchCursorPayload).id === "number"
		) {
			return parsed as SearchCursorPayload;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Tokenize and escape FTS5 query for multi-keyword AND search.
 *
 * Input: "同济 毕业典礼"
 * Output: "同济" "毕业典礼"  (FTS5 implicit AND between quoted terms)
 *
 * Each token is quoted to handle special chars, space-separated for AND logic.
 */
function buildFtsQuery(query: string): string {
	// Split by whitespace, filter empty, quote each token
	const tokens = query.split(/\s+/).filter((t) => t.length > 0);
	// Quote each token, escaping internal quotes
	return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" ");
}

/**
 * GET /api/v1/search/threads - Search threads by title
 *
 * Performs FTS5 full-text search on thread subjects with visibility filtering.
 * Supports multi-keyword AND search (space-separated keywords).
 * Results sorted by last_post_at DESC (most recently active first).
 *
 * Controlled by general.search.enabled setting (default: true).
 */
export async function searchThreads(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	const url = new URL(request.url);
	const origin = request.headers.get("Origin") ?? undefined;

	// 0. Check if search is enabled (via settings)
	const searchEnabledRow = await env.DB.prepare(
		"SELECT value FROM settings WHERE key = 'general.search.enabled'",
	).first<{ value: string }>();
	const searchEnabled = searchEnabledRow?.value !== "false"; // default true

	if (!searchEnabled) {
		return errorResponse(
			"FEATURE_DISABLED",
			503,
			{ message: "Search is currently disabled" },
			origin,
		);
	}

	// 1. Parameter validation
	const query = url.searchParams.get("q")?.trim();
	if (!query || query.length < 2) {
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "Search query must be at least 2 characters" },
			origin,
		);
	}

	const limitParam = url.searchParams.get("limit");
	const limitNum = limitParam ? Number.parseInt(limitParam, 10) : 20;
	const clampedLimit = Number.isNaN(limitNum) || limitNum <= 0 ? 20 : Math.min(limitNum, 50);

	// 2. Parse cursor (base64 encoded)
	const cursorStr = url.searchParams.get("cursor");
	let cursorPayload: SearchCursorPayload | null = null;
	if (cursorStr) {
		cursorPayload = decodeSearchCursor(cursorStr);
		if (!cursorPayload) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid cursor format" }, origin);
		}
	}

	// 3. Build visibility context from optional auth
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumFilter(visCtx, "f");

	// 4. Build search query with visibility filtering
	// Join: threads_fts -> threads -> forums
	// Filter: FTS match + thread visible + forum active + forum visibility
	const ftsQuery = buildFtsQuery(query);

	const cursorCondition = cursorPayload
		? "AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))"
		: "";

	const sql = `
    SELECT t.*
    FROM threads t
    JOIN threads_fts fts ON fts.rowid = t.id
    JOIN forums f ON t.forum_id = f.id
    WHERE threads_fts MATCH ?
      AND ${threadVisible("t")}
      AND ${forumFilter}
      ${cursorCondition}
    ORDER BY t.last_post_at DESC, t.id DESC
    LIMIT ?
  `;

	const params = cursorPayload
		? [
				ftsQuery,
				cursorPayload.lastPostAt,
				cursorPayload.lastPostAt,
				cursorPayload.id,
				clampedLimit + 1,
			]
		: [ftsQuery, clampedLimit + 1];

	const result = await env.DB.prepare(sql)
		.bind(...params)
		.all();

	// 5. Get total count (only on first page, for UI display)
	// This is an optional/approximate value, not a guaranteed precise count
	let total = 0;
	if (!cursorStr) {
		const countSql = `
      SELECT COUNT(*) as cnt
      FROM threads t
      JOIN threads_fts fts ON fts.rowid = t.id
      JOIN forums f ON t.forum_id = f.id
      WHERE threads_fts MATCH ?
        AND ${threadVisible("t")}
        AND ${forumFilter}
    `;
		const countResult = await env.DB.prepare(countSql).bind(ftsQuery).first<{ cnt: number }>();
		total = countResult?.cnt ?? 0;
	}

	// 6. Build response with pagination
	const hasMore = result.results.length > clampedLimit;
	const items = hasMore ? result.results.slice(0, -1) : result.results;

	// Map to Thread type using existing mapper
	const threads = items.map((row) => toThread(row as Record<string, unknown>));

	// 7. Enrich with user cache (avatars) - follow existing pattern
	let enrichedThreads: Thread[];
	if (isKvUserCacheEnabled(env)) {
		// Collect user IDs and fetch from KV cache
		const userIds = new Set<number>();
		for (const thread of threads) {
			if (thread.authorId > 0) userIds.add(thread.authorId);
			if (thread.lastPosterId > 0) userIds.add(thread.lastPosterId);
		}
		const userCache = userIds.size > 0 ? await getUserProfiles(env, ctx, [...userIds]) : new Map();
		enrichedThreads = enrichThreadsWithUserCache(threads, userCache);
	} else {
		// KV cache disabled: accepted degradation for search results.
		// Thread list uses JOIN approach, but search query is already complex.
		// First-phase decision: return threads without avatar enrichment.
		// This is a known inconsistency with thread list page.
		enrichedThreads = threads;
	}

	// Build next cursor
	const lastItem = items[items.length - 1] as { last_post_at: number; id: number } | undefined;
	const nextCursor =
		hasMore && lastItem
			? encodeSearchCursor({ lastPostAt: lastItem.last_post_at, id: lastItem.id })
			: null;

	return jsonResponse(enrichedThreads, origin, { nextCursor, total });
}
