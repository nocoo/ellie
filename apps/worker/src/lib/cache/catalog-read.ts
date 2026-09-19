import type {
	CacheDescriptor,
	CacheTier,
	ForumThreadType,
	ForumVisibility,
	Thread,
} from "@ellie/types";
import type { Env } from "../env";
import { enrichThreadsWithUserCache, toThread, type ViewerContext } from "../mappers";
import { getUserProfiles } from "../user-cache";
import {
	buildForumFilter,
	buildVisibilityContext,
	canViewForumVisibility,
	threadVisible,
} from "../visibility";
import { getGen } from "./epoch";
import { bucketToVisibilityContext } from "./forum";
import { dataCacheKey, digestGenKey, recommendedGenKey, type VisibilityBucket } from "./keys";
import {
	getThreadRows,
	loadThreadAccessBatch,
	projectCurrentThread,
	threadAccessStatus,
} from "./thread-loaders";
import { cacheGetOrSet } from "./wrap";

const TIERS: Record<string, CacheTier> = {
	"search:threads": "SHORT",
	"digest:list": "LONG",
	"digest:stats": "LONG",
	"digest:filters": "LONG",
	"recommended:threads": "LONG",
	"thread-types": "LONG",
};
const BUCKETS = ["anon", "member", "staff", "admin"];
export interface CatalogMember {
	id: number;
	lastPostAt?: number;
	digest?: number;
	recommendedAt?: number;
}
export interface CatalogPage {
	items: CatalogMember[];
	total?: number;
	hasMore: boolean;
}
export interface DigestGroup {
	forumId: number;
	year: number;
	digest: number;
	count: number;
}
interface CurrentForum {
	id: number;
	name: string;
	status: number;
	visibility: ForumVisibility;
}

function fields(descriptor: CacheDescriptor, names: string[]): void {
	if (Object.keys(descriptor.params).sort().join(",") !== names.sort().join(","))
		throw new TypeError("Unexpected catalog dimensions");
}
function validateAggregateDescriptor(d: CacheDescriptor): void {
	fields(d, []);
	if (d.scope !== "internal") throw new TypeError("Invalid aggregate scope");
}

function validateRecommendationOrThreadTypeDescriptor(d: CacheDescriptor): void {
	fields(d, ["forumId"]);
	const forumId = d.params.forumId;
	if (d.scope !== "internal" || !Number.isSafeInteger(forumId) || Number(forumId) <= 0)
		throw new TypeError("Invalid recommendation scope");
}

function validateSearchDescriptor(d: CacheDescriptor): void {
	fields(d, ["bucket", "q", "limit", "cursorTime", "cursorId"]);
	const q = d.params.q;
	if (typeof q !== "string" || q.length < 2 || q !== q.trim().replace(/\s+/g, " "))
		throw new TypeError("Invalid search");
}

function validateDigestListDescriptor(d: CacheDescriptor): void {
	const p = d.params;
	fields(d, [
		"bucket",
		"forumId",
		"level",
		"year",
		"limit",
		"cursorDigest",
		"cursorTime",
		"cursorId",
	]);
	if (p.level !== null && (!Number.isSafeInteger(p.level) || ![1, 2, 3].includes(Number(p.level))))
		throw new TypeError("Invalid digest level");
	if (
		p.year !== null &&
		(!Number.isSafeInteger(p.year) || Number(p.year) < 1 || Number(p.year) > 9998)
	)
		throw new TypeError("Invalid year");
	if (p.forumId !== null && (!Number.isSafeInteger(p.forumId) || Number(p.forumId) <= 0))
		throw new TypeError("Invalid forum");
	if (
		p.cursorDigest !== null &&
		(!Number.isSafeInteger(p.cursorDigest) || ![1, 2, 3].includes(Number(p.cursorDigest)))
	)
		throw new TypeError("Invalid digest cursor");
}

function validateCatalogCursors(p: Record<string, unknown>, family: string): void {
	for (const name of ["cursorTime", "cursorId"]) {
		if (
			p[name] !== null &&
			(!Number.isSafeInteger(p[name]) || Number(p[name]) < (name === "cursorId" ? 1 : 0))
		)
			throw new TypeError("Invalid cursor");
	}
	if (
		(p.cursorTime === null) !== (p.cursorId === null) ||
		(family === "digest:list" && (p.cursorDigest === null) !== (p.cursorId === null))
	)
		throw new TypeError("Incomplete cursor");
}

export function validateCatalogDescriptor(d: CacheDescriptor): void {
	const p = d.params;
	if (!TIERS[d.family]) throw new TypeError("Unknown catalog cache");
	if (["digest:stats", "digest:filters"].includes(d.family)) {
		validateAggregateDescriptor(d);
		return;
	}
	if (d.family === "recommended:threads" || d.family === "thread-types") {
		validateRecommendationOrThreadTypeDescriptor(d);
		return;
	}
	if (!BUCKETS.includes(String(p.bucket)) || d.scope !== `role:${p.bucket}`)
		throw new TypeError("Invalid catalog audience");
	if (!Number.isSafeInteger(p.limit) || Number(p.limit) < 1 || Number(p.limit) > 50)
		throw new TypeError("Invalid page size");
	if (d.family === "search:threads") {
		validateSearchDescriptor(d);
	} else {
		validateDigestListDescriptor(d);
	}
	validateCatalogCursors(p, d.family);
}

function exactFields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === names.length &&
		names.every((name) => Object.hasOwn(value, name))
	);
}
const positiveId = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) > 0;
const nonnegative = (value: unknown): boolean => Number.isSafeInteger(value) && Number(value) >= 0;

function isCatalogItemValid(
	row: Record<string, unknown>,
	recommended: boolean,
	search: boolean,
	params: Record<string, unknown>,
): boolean {
	if (
		!exactFields(
			row,
			recommended
				? ["id", "recommendedAt"]
				: search
					? ["id", "lastPostAt"]
					: ["id", "lastPostAt", "digest"],
		) ||
		!positiveId(row.id)
	)
		return false;
	if (recommended) return nonnegative(row.recommendedAt);
	if (!nonnegative(row.lastPostAt)) return false;
	if (
		!search &&
		(typeof row.digest !== "number" ||
			![1, 2, 3].includes(row.digest) ||
			(params.level !== null && row.digest !== params.level))
	)
		return false;
	if (params.cursorId === null) return true;
	const beforeTime =
		Number(row.lastPostAt) < Number(params.cursorTime) ||
		(row.lastPostAt === params.cursorTime && Number(row.id) < Number(params.cursorId));
	return search
		? beforeTime
		: Number(row.digest) < Number(params.cursorDigest) ||
				(row.digest === params.cursorDigest && beforeTime);
}

/** Shared online/management validation; no I/O and no requester identity. */
export function isCatalogCacheData(d: CacheDescriptor, value: unknown): boolean {
	try {
		validateCatalogDescriptor(d);
	} catch {
		return false;
	}
	if (d.family === "digest:stats" || d.family === "digest:filters") {
		return (
			Array.isArray(value) &&
			value.every(
				(row) =>
					exactFields(row, ["forumId", "year", "digest", "count"]) &&
					// Imports retain deleted forum 0; current forum gates still decide visibility.
					nonnegative(row.forumId) &&
					Number.isSafeInteger(row.year) &&
					Number(row.year) >= 1 &&
					Number(row.year) <= 9998 &&
					[1, 2, 3].includes(Number(row.digest)) &&
					typeof row.digest === "number" &&
					positiveId(row.count),
			)
		);
	}
	if (d.family === "thread-types") {
		return (
			value === null ||
			(exactFields(value, ["enabled", "required", "listable", "prefix", "types"]) &&
				["enabled", "required", "listable", "prefix"].every(
					(key) => typeof value[key] === "boolean",
				) &&
				Array.isArray(value.types) &&
				value.types.every(
					(row) =>
						exactFields(row, ["id", "name", "displayOrder", "icon", "enabled", "moderatorOnly"]) &&
						positiveId(row.id) &&
						typeof row.name === "string" &&
						Number.isSafeInteger(row.displayOrder) &&
						typeof row.icon === "string" &&
						typeof row.enabled === "boolean" &&
						typeof row.moderatorOnly === "boolean",
				))
		);
	}
	const search = d.family === "search:threads";
	const recommended = d.family === "recommended:threads";
	if (
		!exactFields(value, search ? ["items", "hasMore", "total"] : ["items", "hasMore"]) ||
		!Array.isArray(value.items) ||
		typeof value.hasMore !== "boolean" ||
		(search && !nonnegative(value.total)) ||
		value.items.length > (recommended ? 6 : Number(d.params.limit)) ||
		(recommended && value.hasMore) ||
		new Set(value.items.map((row) => row?.id)).size !== value.items.length
	)
		return false;
	return value.items.every((row) => isCatalogItemValid(row, recommended, search, d.params));
}

export async function catalogCacheKey(env: Env, descriptor: CacheDescriptor): Promise<string> {
	validateCatalogDescriptor(descriptor);
	if (descriptor.family === "thread-types") return `thread-types:${descriptor.params.forumId}`;
	const gens: Record<string, string> = descriptor.family.startsWith("digest:")
		? { digest: await getGen(env, digestGenKey()) }
		: descriptor.family === "recommended:threads"
			? { recommended: await getGen(env, recommendedGenKey(Number(descriptor.params.forumId))) }
			: {};
	const key = await dataCacheKey(descriptor.family, descriptor.params, descriptor.scope, gens);
	return descriptor.family === "search:threads" && String(descriptor.params.q).length > 512
		? `${key}:!unavailable`
		: key;
}

export async function loadCatalogPage(env: Env, d: CacheDescriptor): Promise<CatalogPage> {
	validateCatalogDescriptor(d);
	const p = d.params;
	if (d.family === "recommended:threads") {
		const result = await env.DB.prepare(`SELECT r.thread_id AS id, r.recommended_at AS recommendedAt
   FROM forum_recommended_threads r CROSS JOIN threads t ON t.id = r.thread_id AND t.forum_id = r.forum_id
   WHERE r.forum_id = ? AND ${threadVisible("t")} ORDER BY r.thread_id DESC LIMIT 6`)
			.bind(p.forumId)
			.all<CatalogMember>();
		if (!result.success) throw new Error("Recommendations could not be loaded");
		return { items: result.results, hasMore: false };
	}
	const forum = buildForumFilter(bucketToVisibilityContext(p.bucket as VisibilityBucket), "f");
	const where = [threadVisible("t"), forum];
	const bindings: (string | number)[] = [];
	let join = "";
	let sort = "t.last_post_at DESC, t.id DESC";
	let select = "t.id, t.last_post_at AS lastPostAt";
	if (d.family === "search:threads") {
		join = "JOIN threads_fts fts ON fts.rowid = t.id";
		where.push("threads_fts MATCH ?");
		bindings.push(
			String(p.q)
				.split(/\s+/)
				.map((token) => `"${token.replace(/"/g, '""')}"`)
				.join(" "),
		);
	} else {
		select += ", t.digest";
		sort = `t.digest DESC, ${sort}`;
		where.push("t.digest > 0");
		if (p.forumId !== null) {
			where.push("t.forum_id = ?");
			bindings.push(Number(p.forumId));
		}
		if (p.level !== null) {
			where.push("t.digest = ?");
			bindings.push(Number(p.level));
		}
		if (p.year !== null) {
			const start = Date.parse(`${String(p.year).padStart(4, "0")}-01-01T00:00:00Z`) / 1000;
			const end =
				Date.parse(`${String(Number(p.year) + 1).padStart(4, "0")}-01-01T00:00:00Z`) / 1000;
			where.push("t.created_at >= ? AND t.created_at < ?");
			bindings.push(start, end);
		}
	}
	const digestIndex =
		d.family === "digest:list"
			? `INDEXED BY ${p.forumId === null ? "idx_threads_digest" : "idx_threads_forum_digest"} `
			: "";
	const base = `FROM threads t ${digestIndex}${join} JOIN forums f ON f.id = t.forum_id WHERE ${where.join(" AND ")}`;
	const totalTask =
		d.family === "search:threads" && p.cursorId === null
			? env.DB.prepare(`SELECT COUNT(*) AS count ${base}`)
					.bind(...bindings)
					.first<{ count: number }>()
			: Promise.resolve(null);
	let cursor = "";
	if (p.cursorId !== null) {
		cursor = " AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))";
		if (d.family === "digest:list") {
			cursor =
				" AND (t.digest < ? OR (t.digest = ? AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))))";
			bindings.push(Number(p.cursorDigest), Number(p.cursorDigest));
		}
		bindings.push(Number(p.cursorTime), Number(p.cursorTime), Number(p.cursorId));
	}
	const [result, total] = await Promise.all([
		env.DB.prepare(`SELECT ${select} ${base}${cursor} ORDER BY ${sort} LIMIT ?`)
			.bind(...bindings, Number(p.limit) + 1)
			.all<CatalogMember>(),
		totalTask,
	]);
	if (!result.success) throw new Error("Catalog membership could not be loaded");
	if (d.family === "search:threads" && p.cursorId === null && (!total || !nonnegative(total.count)))
		throw new Error("Search count could not be loaded");
	return {
		items: result.results.slice(0, Number(p.limit)),
		hasMore: result.results.length > Number(p.limit),
		...(d.family === "search:threads" ? { total: total?.count ?? 0 } : {}),
	};
}

/** Per-forum groups allow current ACL projection without re-running aggregates. */
export async function loadDigestGroups(env: Env): Promise<DigestGroup[]> {
	const result =
		await env.DB.prepare(`SELECT t.forum_id AS forumId, CAST(strftime('%Y', t.created_at, 'unixepoch') AS INTEGER) AS year,
  t.digest, COUNT(*) AS count FROM threads t WHERE t.digest > 0 AND ${threadVisible("t")}
  GROUP BY t.forum_id, year, t.digest`).all<DigestGroup>();
	if (!result.success) throw new Error("Digest aggregates could not be loaded");
	return result.results;
}
export async function rebuildCatalogCache(
	env: Env,
	_ctx: ExecutionContext | undefined,
	d: CacheDescriptor,
): Promise<unknown> {
	validateCatalogDescriptor(d);
	if (d.family === "thread-types") return loadThreadTypes(env, Number(d.params.forumId));
	return d.family === "digest:stats" || d.family === "digest:filters"
		? loadDigestGroups(env)
		: loadCatalogPage(env, d);
}
export async function getCatalogPage(
	env: Env,
	ctx: ExecutionContext | undefined,
	d: CacheDescriptor,
): Promise<CatalogPage> {
	return cacheGetOrSet(env, ctx, await catalogCacheKey(env, d), () => loadCatalogPage(env, d), {
		...d,
		tier: TIERS[d.family],
		validator: (v): v is CatalogPage => isCatalogCacheData(d, v),
	});
}
export async function getDigestGroups(
	env: Env,
	ctx: ExecutionContext | undefined,
	_family: "digest:stats" | "digest:filters",
): Promise<DigestGroup[]> {
	// Stats and filters share grouped data; current forum permissions apply on each read.
	const d = { family: "digest:stats", params: {}, scope: "internal" };
	return cacheGetOrSet(env, ctx, await catalogCacheKey(env, d), () => loadDigestGroups(env), {
		...d,
		tier: "LONG",
		validator: (v): v is DigestGroup[] => isCatalogCacheData(d, v),
	});
}
export async function currentCatalogForums(
	env: Env,
	viewer: ViewerContext | null,
): Promise<Map<number, CurrentForum>> {
	const rows = await env.DB.prepare(
		"SELECT id, name, status, visibility FROM forums",
	).all<CurrentForum>();
	if (!rows.success) throw new Error("Current forum access could not be loaded");
	const vis = buildVisibilityContext(viewer);
	return new Map(
		rows.results
			.filter((row) => row.status === 1 && canViewForumVisibility(row.visibility, vis))
			.map((row) => [row.id, row]),
	);
}
export async function currentCatalogThreads(
	env: Env,
	ctx: ExecutionContext | undefined,
	ids: number[],
	viewer: ViewerContext | null,
	forumId?: number,
): Promise<Thread[]> {
	if (!ids.length) return [];
	const access = await loadThreadAccessBatch(env, ids);
	const vis = buildVisibilityContext(viewer);
	const allowed = ids.filter((id) => {
		const row = access.get(id);
		return (
			row &&
			row.sticky >= 0 &&
			threadAccessStatus(row, viewer) === null &&
			canViewForumVisibility(row.visibility as ForumVisibility, vis) &&
			(forumId === undefined || row.forum_id === forumId)
		);
	});
	const entities = await getThreadRows(env, ctx, allowed);
	const threads = allowed.flatMap((id) => {
		const row = entities.get(id);
		const accessRow = access.get(id);
		return row && accessRow ? [toThread(projectCurrentThread(row, accessRow), viewer)] : [];
	});
	const users = [
		...new Set(threads.flatMap((row) => [row.authorId, row.lastPosterId]).filter((id) => id > 0)),
	];
	return enrichThreadsWithUserCache(threads, await getUserProfiles(env, ctx, users));
}

export interface ThreadTypesPayload {
	enabled: boolean;
	required: boolean;
	listable: boolean;
	prefix: boolean;
	types: ForumThreadType[];
}
export async function loadThreadTypes(
	env: Env,
	forumId: number,
): Promise<ThreadTypesPayload | null> {
	const forum = await env.DB.prepare(
		"SELECT status, thread_types_enabled, thread_types_required, thread_types_listable, thread_types_prefix FROM forums WHERE id = ?",
	)
		.bind(forumId)
		.first<{
			status: number;
			thread_types_enabled: number;
			thread_types_required: number;
			thread_types_listable: number;
			thread_types_prefix: number;
		}>();
	if (forum?.status !== 1) return null;
	const rows = await env.DB.prepare(
		"SELECT id, name, display_order, icon, enabled, moderator_only FROM forum_thread_types WHERE forum_id = ? AND enabled = 1 ORDER BY display_order ASC, id ASC",
	)
		.bind(forumId)
		.all<{
			id: number;
			name: string;
			display_order: number;
			icon: string | null;
			enabled: number;
			moderator_only: number;
		}>();
	if (!rows.success) throw new Error("Thread types could not be loaded");
	return {
		enabled: forum.thread_types_enabled === 1,
		required: forum.thread_types_required === 1,
		listable: forum.thread_types_listable === 1,
		prefix: forum.thread_types_prefix === 1,
		types: rows.results.map((row) => ({
			id: row.id,
			name: row.name,
			displayOrder: row.display_order,
			icon: row.icon ?? "",
			enabled: row.enabled === 1,
			moderatorOnly: row.moderator_only === 1,
		})),
	};
}
export async function getCachedThreadTypes(
	env: Env,
	ctx: ExecutionContext | undefined,
	forumId: number,
): Promise<ThreadTypesPayload | null> {
	const descriptor = { family: "thread-types", scope: "internal", params: { forumId } };
	return cacheGetOrSet(
		env,
		ctx,
		await catalogCacheKey(env, descriptor),
		() => loadThreadTypes(env, forumId),
		{
			...descriptor,
			tier: "LONG",
			validator: (v): v is ThreadTypesPayload | null => isCatalogCacheData(descriptor, v),
		},
	);
}
