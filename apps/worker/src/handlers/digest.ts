import { decodeGenericCursor, encodeGenericCursor } from "@ellie/types";
import { computeVisibilityBucket } from "../lib/cache/bucket";
import {
	currentCatalogForums,
	currentCatalogThreads,
	getCatalogPage,
	getDigestGroups,
} from "../lib/cache/catalog-read";
import type { Env } from "../lib/env";
import { clampLimit } from "../lib/pagination";
import { jsonResponse } from "../lib/response";
import { buildVisibilityContext } from "../lib/visibility";
import { optionalAuthVerified } from "../middleware/auth";

interface DigestCursor {
	digest: number;
	lastPostAt: number;
	id: number;
}
function isDigestCursor(p: Partial<DigestCursor>): boolean {
	return (
		[1, 2, 3].includes(p.digest ?? 0) &&
		Number.isSafeInteger(p.id) &&
		Number(p.id) > 0 &&
		Number.isSafeInteger(p.lastPostAt) &&
		Number(p.lastPostAt) >= 0
	);
}
function optionalInteger(value: string | null, max = Number.MAX_SAFE_INTEGER): number | null {
	const n = Number(value);
	return Number.isSafeInteger(n) && n > 0 && n <= max ? n : null;
}

/** Cache membership and compose current entities, counters and audience projection. */
export async function list(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const query = new URL(request.url).searchParams;
	const user = await optionalAuthVerified(request, env);
	const bucket = computeVisibilityBucket(buildVisibilityContext(user));
	const limit = clampLimit(query.get("limit"), { defaultLimit: 20, maxLimit: 50 }) || 20;
	const token = query.get("cursor");
	const cursor = token ? decodeGenericCursor<DigestCursor>(token, isDigestCursor) : null;
	const page = await getCatalogPage(env, ctx, {
		family: "digest:list",
		scope: `role:${bucket}`,
		params: {
			bucket,
			limit,
			forumId: optionalInteger(query.get("forumId")),
			level: optionalInteger(query.get("level"), 3),
			year: optionalInteger(query.get("year"), 9998),
			cursorDigest: cursor?.digest ?? null,
			cursorTime: cursor?.lastPostAt ?? null,
			cursorId: cursor?.id ?? null,
		},
	});
	const rows = await currentCatalogThreads(
		env,
		ctx,
		page.items.map((item) => item.id),
		user,
	);
	const last = page.items.at(-1);
	const nextCursor =
		page.hasMore && last && last.digest !== undefined && last.lastPostAt !== undefined
			? encodeGenericCursor<DigestCursor>({
					digest: last.digest,
					lastPostAt: last.lastPostAt,
					id: last.id,
				})
			: null;
	return jsonResponse(
		rows.filter((row) => row.digest > 0),
		origin,
		{ nextCursor },
	);
}

export async function stats(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const user = await optionalAuthVerified(request, env);
	const [groups, forums] = await Promise.all([
		getDigestGroups(env, ctx, "digest:stats"),
		currentCatalogForums(env, user),
	]);
	const data = { total: 0, level1: 0, level2: 0, level3: 0 };
	for (const group of groups) {
		if (!forums.has(group.forumId)) continue;
		data.total += group.count;
		if (group.digest === 1) data.level1 += group.count;
		if (group.digest === 2) data.level2 += group.count;
		if (group.digest === 3) data.level3 += group.count;
	}
	return jsonResponse(data, origin);
}

export async function filters(
	request: Request,
	env: Env,
	ctx?: ExecutionContext,
): Promise<Response> {
	const origin = request.headers.get("Origin") ?? undefined;
	const user = await optionalAuthVerified(request, env);
	const [groups, current] = await Promise.all([
		getDigestGroups(env, ctx, "digest:filters"),
		currentCatalogForums(env, user),
	]);
	const years = new Set<number>();
	const counts = new Map<number, number>();
	for (const group of groups) {
		if (!current.has(group.forumId)) continue;
		years.add(group.year);
		counts.set(group.forumId, (counts.get(group.forumId) ?? 0) + group.count);
	}
	const forums = [...counts]
		.flatMap(([id, digestCount]) => {
			const forum = current.get(id);
			return forum ? [{ id, name: forum.name, digestCount }] : [];
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	return jsonResponse({ years: [...years].sort((a, b) => b - a), forums }, origin);
}
