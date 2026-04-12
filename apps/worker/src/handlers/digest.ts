import { decodeGenericCursor, encodeGenericCursor } from "@ellie/types";
import type { Env } from "../lib/env";
import { toThread } from "../lib/mappers";
import {
	FORUM_ACTIVE,
	buildForumVisibilityFilter,
	buildVisibilityContext,
	threadVisible,
} from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { corsHeaders } from "../middleware/cors";

/** Digest cursor payload for keyset pagination */
interface DigestCursorPayload {
	digest: number;
	lastPostAt: number;
	id: number;
}

/** Validate digest cursor payload shape */
function isDigestCursor(p: Partial<DigestCursorPayload>): boolean {
	return (
		typeof p.digest === "number" && typeof p.lastPostAt === "number" && typeof p.id === "number"
	);
}

/** D1 row shape for cursor extraction (snake_case) */
interface D1DigestRow {
	id: number;
	digest: number;
	last_post_at: number;
}

/** Default/max page sizes */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Clamp limit to [1, MAX_LIMIT] */
function clampLimit(limitParam: string | null): number {
	const n = limitParam ? Number.parseInt(limitParam, 10) : undefined;
	return n === undefined || n <= 0 ? DEFAULT_LIMIT : Math.min(n, MAX_LIMIT);
}

/** Build WHERE clause conditions for digest query (thread conditions only) */
function buildDigestConditions(params: {
	forumId: number | null;
	level: number | null;
	year: number | null;
}): { conditions: string[]; bindings: (string | number)[] } {
	// Only include visible threads (sticky >= 0), exclude hidden/deleted/placeholder
	const conditions: string[] = ["t.digest > 0", threadVisible("t")];
	const bindings: (string | number)[] = [];

	if (params.forumId && !Number.isNaN(params.forumId)) {
		conditions.push("t.forum_id = ?");
		bindings.push(params.forumId);
	}

	if (params.level && params.level >= 1 && params.level <= 3) {
		conditions.push("t.digest = ?");
		bindings.push(params.level);
	}

	if (params.year && !Number.isNaN(params.year)) {
		// Filter by year based on created_at timestamp
		const startOfYear = Math.floor(new Date(`${params.year}-01-01T00:00:00Z`).getTime() / 1000);
		const endOfYear = Math.floor(new Date(`${params.year + 1}-01-01T00:00:00Z`).getTime() / 1000);
		conditions.push("t.created_at >= ? AND t.created_at < ?");
		bindings.push(startOfYear, endOfYear);
	}

	return { conditions, bindings };
}

/** GET /api/v1/digest - List digest threads (all forums, keyset pagination) */
export async function list(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	// Get user auth for visibility filtering (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumVisibilityFilter(visCtx);

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr ? decodeGenericCursor<DigestCursorPayload>(cursorStr, isDigestCursor) : null;

	// Optional filters
	const forumIdParam = url.searchParams.get("forumId");
	const forumId = forumIdParam ? Number.parseInt(forumIdParam, 10) : null;

	const levelParam = url.searchParams.get("level");
	const level = levelParam ? Number.parseInt(levelParam, 10) : null;

	const yearParam = url.searchParams.get("year");
	const year = yearParam ? Number.parseInt(yearParam, 10) : null;

	const { conditions, bindings } = buildDigestConditions({ forumId, level, year });

	// Add forum visibility filter (status = 1 for active, and visibility check)
	const fullConditions = [...conditions, FORUM_ACTIVE.replace("status", "f.status"), forumFilter];

	let result: D1Result;
	if (cursor) {
		// Keyset pagination: ORDER BY digest DESC, last_post_at DESC, id DESC
		const cursorCondition =
			"(t.digest < ? OR (t.digest = ? AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))))";
		const whereClause = [...fullConditions, cursorCondition].join(" AND ");
		const cursorBindings = [
			cursor.digest,
			cursor.digest,
			cursor.lastPostAt,
			cursor.lastPostAt,
			cursor.id,
		];

		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE ${whereClause}
			 ORDER BY t.digest DESC, t.last_post_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(...bindings, ...cursorBindings, clampedLimit)
			.all();
	} else {
		// First page
		const whereClause = fullConditions.join(" AND ");
		result = await env.DB.prepare(
			`SELECT t.* FROM threads t
			 INNER JOIN forums f ON t.forum_id = f.id
			 WHERE ${whereClause}
			 ORDER BY t.digest DESC, t.last_post_at DESC, t.id DESC LIMIT ?`,
		)
			.bind(...bindings, clampedLimit)
			.all();
	}

	const threads = result.results.map((row) => toThread(row as Record<string, unknown>));

	// Generate next cursor
	let nextCursor: string | null = null;
	if (threads.length === clampedLimit && threads.length > 0) {
		const lastRawRow = result.results[result.results.length - 1] as unknown as D1DigestRow;
		if (lastRawRow) {
			nextCursor = encodeGenericCursor<DigestCursorPayload>({
				digest: lastRawRow.digest,
				lastPostAt: lastRawRow.last_post_at,
				id: lastRawRow.id,
			});
		}
	}

	return new Response(
		JSON.stringify({
			data: threads,
			meta: { timestamp: Date.now(), requestId: crypto.randomUUID(), nextCursor },
		}),
		{ headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
	);
}

/** GET /api/v1/digest/stats - Get digest statistics */
export async function stats(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Get user auth for visibility filtering (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumVisibilityFilter(visCtx);

	// Only count visible threads (sticky >= 0) from visible forums (status = 1)
	const result = await env.DB.prepare(
		`SELECT
			COUNT(*) as total,
			SUM(CASE WHEN t.digest = 1 THEN 1 ELSE 0 END) as level1,
			SUM(CASE WHEN t.digest = 2 THEN 1 ELSE 0 END) as level2,
			SUM(CASE WHEN t.digest = 3 THEN 1 ELSE 0 END) as level3
		 FROM threads t
		 INNER JOIN forums f ON t.forum_id = f.id
		 WHERE t.digest > 0 AND ${threadVisible("t")} AND ${FORUM_ACTIVE.replace("status", "f.status")} AND ${forumFilter}`,
	).first<{ total: number; level1: number; level2: number; level3: number }>();

	return new Response(
		JSON.stringify({
			data: {
				total: result?.total ?? 0,
				level1: result?.level1 ?? 0,
				level2: result?.level2 ?? 0,
				level3: result?.level3 ?? 0,
			},
			meta: { timestamp: Date.now(), requestId: crypto.randomUUID() },
		}),
		{ headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
	);
}

/** GET /api/v1/digest/filters - Get available filter options (years and forums with digest threads) */
export async function filters(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;

	// Get user auth for visibility filtering (verified against DB)
	const user = await optionalAuthVerified(request, env);
	const visCtx = buildVisibilityContext(user);
	const forumFilter = buildForumVisibilityFilter(visCtx);

	// Get distinct years from visible digest threads in visible forums
	const yearsResult = await env.DB.prepare(
		`SELECT DISTINCT strftime('%Y', t.created_at, 'unixepoch') as year
		 FROM threads t
		 INNER JOIN forums f ON t.forum_id = f.id
		 WHERE t.digest > 0 AND ${threadVisible("t")} AND ${FORUM_ACTIVE.replace("status", "f.status")} AND ${forumFilter}
		 ORDER BY year DESC`,
	).all<{ year: string }>();

	const years = yearsResult.results
		.map((r) => Number.parseInt(r.year, 10))
		.filter((y) => !Number.isNaN(y));

	// Get forums that have visible digest threads (with count)
	const forumsResult = await env.DB.prepare(
		`SELECT f.id, f.name, COUNT(t.id) as digest_count
		 FROM threads t
		 INNER JOIN forums f ON t.forum_id = f.id
		 WHERE t.digest > 0 AND ${threadVisible("t")} AND ${FORUM_ACTIVE.replace("status", "f.status")} AND ${forumFilter}
		 GROUP BY f.id, f.name
		 ORDER BY f.name`,
	).all<{ id: number; name: string; digest_count: number }>();

	const forums = forumsResult.results.map((r) => ({
		id: r.id,
		name: r.name,
		digestCount: r.digest_count,
	}));

	return new Response(
		JSON.stringify({
			data: { years, forums },
			meta: { timestamp: Date.now(), requestId: crypto.randomUUID() },
		}),
		{ headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
	);
}
