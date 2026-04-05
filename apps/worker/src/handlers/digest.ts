// Digest (featured threads) handlers for Cloudflare Worker
import type { Env } from "../lib/env";
import { toThread } from "../lib/mappers";
import { corsHeaders } from "../middleware/cors";

/** Digest cursor payload for keyset pagination */
interface DigestCursorPayload {
	digest: number;
	lastPostAt: number;
	id: number;
}

/** Encode digest cursor to base64 */
function encodeDigestCursor(payload: DigestCursorPayload): string {
	return btoa(JSON.stringify(payload));
}

/** Decode digest cursor from base64 */
function decodeDigestCursor(cursor: string): DigestCursorPayload | null {
	try {
		const json = atob(cursor);
		const parsed = JSON.parse(json) as unknown;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"digest" in parsed &&
			"lastPostAt" in parsed &&
			"id" in parsed &&
			typeof (parsed as DigestCursorPayload).digest === "number" &&
			typeof (parsed as DigestCursorPayload).lastPostAt === "number" &&
			typeof (parsed as DigestCursorPayload).id === "number"
		) {
			return parsed as DigestCursorPayload;
		}
		return null;
	} catch {
		return null;
	}
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

/** Build WHERE clause conditions for digest query */
function buildDigestConditions(params: {
	forumId: number | null;
	level: number | null;
	year: number | null;
}): { conditions: string[]; bindings: (string | number)[] } {
	const conditions: string[] = ["digest > 0"];
	const bindings: (string | number)[] = [];

	if (params.forumId && !Number.isNaN(params.forumId)) {
		conditions.push("forum_id = ?");
		bindings.push(params.forumId);
	}

	if (params.level && params.level >= 1 && params.level <= 3) {
		conditions.push("digest = ?");
		bindings.push(params.level);
	}

	if (params.year && !Number.isNaN(params.year)) {
		// Filter by year based on created_at timestamp
		const startOfYear = Math.floor(new Date(`${params.year}-01-01T00:00:00Z`).getTime() / 1000);
		const endOfYear = Math.floor(new Date(`${params.year + 1}-01-01T00:00:00Z`).getTime() / 1000);
		conditions.push("created_at >= ? AND created_at < ?");
		bindings.push(startOfYear, endOfYear);
	}

	return { conditions, bindings };
}

/** GET /api/v1/digest - List digest threads (all forums, keyset pagination) */
export async function list(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const url = new URL(request.url);

	const clampedLimit = clampLimit(url.searchParams.get("limit"));
	const cursorStr = url.searchParams.get("cursor");
	const cursor = cursorStr ? decodeDigestCursor(cursorStr) : null;

	// Optional filters
	const forumIdParam = url.searchParams.get("forumId");
	const forumId = forumIdParam ? Number.parseInt(forumIdParam, 10) : null;

	const levelParam = url.searchParams.get("level");
	const level = levelParam ? Number.parseInt(levelParam, 10) : null;

	const yearParam = url.searchParams.get("year");
	const year = yearParam ? Number.parseInt(yearParam, 10) : null;

	const { conditions, bindings } = buildDigestConditions({ forumId, level, year });

	let result: D1Result;
	if (cursor) {
		// Keyset pagination: ORDER BY digest DESC, last_post_at DESC, id DESC
		const cursorCondition =
			"(digest < ? OR (digest = ? AND (last_post_at < ? OR (last_post_at = ? AND id < ?))))";
		const whereClause = [...conditions, cursorCondition].join(" AND ");
		const cursorBindings = [
			cursor.digest,
			cursor.digest,
			cursor.lastPostAt,
			cursor.lastPostAt,
			cursor.id,
		];

		result = await env.DB.prepare(
			`SELECT * FROM threads WHERE ${whereClause}
			 ORDER BY digest DESC, last_post_at DESC, id DESC LIMIT ?`,
		)
			.bind(...bindings, ...cursorBindings, clampedLimit)
			.all();
	} else {
		// First page
		const whereClause = conditions.join(" AND ");
		result = await env.DB.prepare(
			`SELECT * FROM threads WHERE ${whereClause}
			 ORDER BY digest DESC, last_post_at DESC, id DESC LIMIT ?`,
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
			nextCursor = encodeDigestCursor({
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

	const result = await env.DB.prepare(
		`SELECT
			COUNT(*) as total,
			SUM(CASE WHEN digest = 1 THEN 1 ELSE 0 END) as level1,
			SUM(CASE WHEN digest = 2 THEN 1 ELSE 0 END) as level2,
			SUM(CASE WHEN digest = 3 THEN 1 ELSE 0 END) as level3
		 FROM threads WHERE digest > 0`,
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

	// Get distinct years from digest threads
	const yearsResult = await env.DB.prepare(
		`SELECT DISTINCT strftime('%Y', created_at, 'unixepoch') as year
		 FROM threads WHERE digest > 0
		 ORDER BY year DESC`,
	).all<{ year: string }>();

	const years = yearsResult.results.map((r) => Number.parseInt(r.year, 10)).filter((y) => !Number.isNaN(y));

	// Get forums that have digest threads (with count)
	const forumsResult = await env.DB.prepare(
		`SELECT f.id, f.name, COUNT(t.id) as digest_count
		 FROM threads t
		 JOIN forums f ON t.forum_id = f.id
		 WHERE t.digest > 0
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
