import { decodeGenericCursor, encodeGenericCursor } from "@ellie/types";
import { computeVisibilityBucket } from "../lib/cache/bucket";
import { currentCatalogThreads, getCatalogPage } from "../lib/cache/catalog-read";
import type { Env } from "../lib/env";
import { clampLimit } from "../lib/pagination";
import { jsonResponse } from "../lib/response";
import { getSetting } from "../lib/settings";
import { buildVisibilityContext } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";
import { errorResponse } from "../middleware/error";

interface SearchCursor {
	lastPostAt: number;
	id: number;
}
function isSearchCursor(p: Partial<SearchCursor>): boolean {
	return (
		Number.isSafeInteger(p.lastPostAt) &&
		Number(p.lastPostAt) >= 0 &&
		Number.isSafeInteger(p.id) &&
		Number(p.id) > 0
	);
}

export async function searchThreads(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const query = new URL(request.url).searchParams;
	if (!(await getSetting(env, "general.search.enabled", true)))
		return errorResponse(
			"FEATURE_DISABLED",
			503,
			{ message: "Search is currently disabled" },
			origin,
		);
	const q = query.get("q")?.trim().replace(/\s+/g, " ");
	if (!q || q.length < 2)
		return errorResponse(
			"INVALID_REQUEST",
			400,
			{ message: "Search query must be at least 2 characters" },
			origin,
		);
	const limit = clampLimit(query.get("limit"), { defaultLimit: 20, maxLimit: 50 }) || 20;
	const token = query.get("cursor");
	const cursor = token ? decodeGenericCursor<SearchCursor>(token, isSearchCursor) : null;
	if (token && !cursor)
		return errorResponse("INVALID_REQUEST", 400, { message: "Invalid cursor format" }, origin);
	const user = await optionalAuthVerified(request, env);
	const bucket = computeVisibilityBucket(buildVisibilityContext(user));
	const page = await getCatalogPage(env, ctx, {
		family: "search:threads",
		scope: `role:${bucket}`,
		params: {
			bucket,
			q,
			limit,
			cursorTime: cursor?.lastPostAt ?? null,
			cursorId: cursor?.id ?? null,
		},
	});
	const threads = await currentCatalogThreads(
		env,
		ctx,
		page.items.map((item) => item.id),
		user,
	);
	const last = page.items.at(-1);
	const nextCursor =
		page.hasMore && last && last.lastPostAt !== undefined
			? encodeGenericCursor<SearchCursor>({ lastPostAt: last.lastPostAt, id: last.id })
			: null;
	return jsonResponse(threads, origin, { nextCursor, total: page.total ?? 0 });
}
