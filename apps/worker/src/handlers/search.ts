// Search handlers for Cloudflare Worker
// FTS5 full-text search on thread subjects

import { type Thread, decodeGenericCursor, encodeGenericCursor } from "@ellie/types";
import type { Env } from "../lib/env";
import { isKvUserCacheEnabled } from "../lib/env";
import { enrichThreadsWithUserCache, toThread } from "../lib/mappers";
import { clampLimit } from "../lib/pagination";
import { jsonResponse } from "../lib/response";
import { getSetting } from "../lib/settings";
import { getUserProfiles } from "../lib/user-cache";
import { buildForumFilter, buildVisibilityContext, threadVisible } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

/** Search cursor payload (matches thread list cursor format) */
interface SearchCursorPayload {
	lastPostAt: number;
	id: number;
}

/** Validate search cursor payload shape */
function isSearchCursor(p: Partial<SearchCursorPayload>): boolean {
	return typeof p.lastPostAt === "number" && typeof p.id === "number";
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

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;

/** Clamp search limit — same as clampLimit but treats NaN as default */
function parseLimit(limitParam: string | null): number {
	const result = clampLimit(limitParam, {
		defaultLimit: SEARCH_DEFAULT_LIMIT,
		maxLimit: SEARCH_MAX_LIMIT,
	});
	return Number.isNaN(result) ? SEARCH_DEFAULT_LIMIT : result;
}

/** Correlated subquery: true when no earlier visible thread by the same author exists. */
const IS_AUTHOR_FIRST_THREAD =
	"(CASE WHEN t.author_id > 0 AND NOT EXISTS (SELECT 1 FROM threads t2 WHERE t2.author_id = t.author_id AND t2.sticky >= 0 AND (t2.created_at < t.created_at OR (t2.created_at = t.created_at AND t2.id < t.id))) THEN 1 ELSE 0 END) AS is_author_first_thread";

/** Build search SQL query */
function buildSearchSql(forumFilter: string, hasCursor: boolean): string {
	const cursorCondition = hasCursor
		? "AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))"
		: "";

	return `
    SELECT t.*, ${IS_AUTHOR_FIRST_THREAD}
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
}

/** Build search params array */
function buildSearchParams(
	ftsQuery: string,
	cursorPayload: SearchCursorPayload | null,
	limit: number,
): (string | number)[] {
	if (cursorPayload) {
		return [
			ftsQuery,
			cursorPayload.lastPostAt,
			cursorPayload.lastPostAt,
			cursorPayload.id,
			limit + 1,
		];
	}
	return [ftsQuery, limit + 1];
}

/** Get total count for first page (optional) */
async function getSearchTotalCount(
	env: Env,
	ftsQuery: string,
	forumFilter: string,
): Promise<number> {
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
	return countResult?.cnt ?? 0;
}

/** Enrich threads with user cache data */
async function enrichWithUserCache(
	env: Env,
	ctx: ExecutionContext,
	threads: Thread[],
): Promise<Thread[]> {
	if (!isKvUserCacheEnabled(env)) {
		// KV cache disabled: accepted degradation for search results.
		return threads;
	}

	// Collect user IDs and fetch from KV cache
	const userIds = new Set<number>();
	for (const thread of threads) {
		if (thread.authorId > 0) userIds.add(thread.authorId);
		if (thread.lastPosterId > 0) userIds.add(thread.lastPosterId);
	}
	const userCache = userIds.size > 0 ? await getUserProfiles(env, ctx, [...userIds]) : new Map();
	return enrichThreadsWithUserCache(threads, userCache);
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

	// Auth + the search-enabled settings lookup are independent of each
	// other and of the URL parsing below — fire both eagerly so they overlap.
	const userPromise = optionalAuthVerified(request, env);

	// 0. Check if search is enabled (via settings). Use the cached
	// `getSetting` helper so the lookup hits the settings KV cache instead
	// of issuing a per-request D1 read on a key that almost never changes
	// (`upsertSettings` invalidates the KV cache on write).
	const searchEnabled = await getSetting(env, "general.search.enabled", true);

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

	const clampedLimit = parseLimit(url.searchParams.get("limit"));

	// 2. Parse cursor (base64 encoded)
	const cursorStr = url.searchParams.get("cursor");
	let cursorPayload: SearchCursorPayload | null = null;
	if (cursorStr) {
		cursorPayload = decodeGenericCursor<SearchCursorPayload>(cursorStr, isSearchCursor);
		if (!cursorPayload) {
			return errorResponse("INVALID_REQUEST", 400, { message: "Invalid cursor format" }, origin);
		}
	}

	// 3. Build visibility context from optional auth (already in-flight)
	const user = await userPromise;
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumFilter(visCtx, "f");

	// 4. Build search query with visibility filtering
	const ftsQuery = buildFtsQuery(query);
	const sql = buildSearchSql(forumFilter, !!cursorPayload);
	const params = buildSearchParams(ftsQuery, cursorPayload, clampedLimit);

	// Run the page query and (when on first page) the total-count query in
	// parallel — they're independent.
	const [result, total] = await Promise.all([
		env.DB.prepare(sql)
			.bind(...params)
			.all(),
		cursorStr ? Promise.resolve(0) : getSearchTotalCount(env, ftsQuery, forumFilter),
	]);

	// 6. Build response with pagination
	const hasMore = result.results.length > clampedLimit;
	const items = hasMore ? result.results.slice(0, -1) : result.results;

	// Map to Thread type using existing mapper
	const viewer = user ? { userId: user.userId, role: user.role } : null;
	const threads = items.map((row) => toThread(row as Record<string, unknown>, viewer));

	// 7. Enrich with user cache (avatars)
	const enrichedThreads = await enrichWithUserCache(env, ctx, threads);

	// Build next cursor
	const lastItem = items[items.length - 1] as { last_post_at: number; id: number } | undefined;
	const nextCursor =
		hasMore && lastItem
			? encodeGenericCursor<SearchCursorPayload>({
					lastPostAt: lastItem.last_post_at,
					id: lastItem.id,
				})
			: null;

	return jsonResponse(enrichedThreads, origin, { nextCursor, total });
}
