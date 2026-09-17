// Cache membership, never viewer projections or copies of thread/user entities.
import type { CacheDescriptor } from "@ellie/types";
import type { Env } from "../env";
import { buildNextCursor } from "../pagination";
import { STICKY_GLOBAL } from "../visibility";
import { getGen } from "./epoch";
import { dataCacheKey, threadListGenAllKey, threadListGenKey } from "./keys";
import { cacheGetOrSet } from "./wrap";

export interface ThreadCursor {
	sticky: number;
	lastPostAt: number;
	id: number;
}

export interface ThreadListQuery {
	forumId: number;
	limit: number;
	page: number;
	cursor: ThreadCursor | null;
	typeId: number | null;
}

export interface ThreadListMember {
	id: number;
	sticky: number;
	last_post_at: number;
}

export interface ThreadListItems {
	items: ThreadListMember[];
}

export interface ThreadListCount {
	total: number;
}

export interface ThreadListMembership extends ThreadListItems, ThreadListCount {}

export type ThreadListCacheData = ThreadListItems | ThreadListCount;

export function isThreadCursor(value: Partial<ThreadCursor>): boolean {
	return (
		Number.isSafeInteger(value.sticky) &&
		(value.sticky as number) >= 0 &&
		(value.sticky as number) <= 4 &&
		Number.isSafeInteger(value.lastPostAt) &&
		(value.lastPostAt as number) >= 0 &&
		Number.isSafeInteger(value.id) &&
		(value.id as number) > 0
	);
}

function isCount(value: unknown): value is ThreadListCount {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const v = value as ThreadListCount;
	return Object.hasOwn(v, "total") && Number.isSafeInteger(v.total) && v.total >= 0;
}

function isItems(value: unknown): value is ThreadListItems {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const v = value as ThreadListItems;
	return (
		Object.hasOwn(v, "items") &&
		Array.isArray(v.items) &&
		v.items.every(
			(row) =>
				typeof row === "object" &&
				row !== null &&
				Number.isSafeInteger(row.id) &&
				row.id > 0 &&
				Number.isSafeInteger(row.sticky) &&
				row.sticky >= 0 &&
				Number.isSafeInteger(row.last_post_at),
		)
	);
}

function stickyRank(sticky: number): number {
	return sticky === STICKY_GLOBAL ? 4 : sticky;
}

function followsCursor(row: ThreadListMember, cursor: ThreadCursor): boolean {
	const rank = stickyRank(row.sticky);
	return (
		rank < cursor.sticky ||
		(rank === cursor.sticky &&
			(row.last_post_at < cursor.lastPostAt ||
				(row.last_post_at === cursor.lastPostAt && row.id < cursor.id)))
	);
}

/** Validate persisted parameters again before a management rebuild. */
export function validateThreadListDescriptor(descriptor: CacheDescriptor): void {
	const p = descriptor.params;
	if (descriptor.family !== "thread:list" || descriptor.scope !== "internal") {
		throw new Error("Unsupported thread-list cache descriptor");
	}
	if (typeof p !== "object" || p === null || Array.isArray(p))
		throw new Error("Invalid thread-list cache parameters");
	if (p.kind === "announcements" && Object.hasOwn(p, "kind") && Object.keys(p).length === 1) return;
	const keys =
		p.kind === "count"
			? ["kind", "forumId", "typeId"]
			: ["kind", "forumId", "typeId", "limit", "offset", "cursorSticky", "cursorTime", "cursorId"];
	if (
		Object.keys(p).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(p, key)) ||
		(p.kind !== "local" && p.kind !== "count") ||
		!Number.isSafeInteger(p.forumId) ||
		Number(p.forumId) <= 0 ||
		(p.typeId !== null && (!Number.isSafeInteger(p.typeId) || Number(p.typeId) <= 0))
	) {
		throw new Error("Invalid thread-list cache parameters");
	}
	if (p.kind === "count") return;
	if (
		!Number.isSafeInteger(p.limit) ||
		Number(p.limit) < 1 ||
		Number(p.limit) > 100 ||
		!Number.isSafeInteger(p.offset) ||
		Number(p.offset) < 0
	) {
		throw new Error("Invalid thread-list cache parameters");
	}
	if (p.cursorSticky === null && p.cursorTime === null && p.cursorId === null) return;
	if (
		Number(p.offset) !== 0 ||
		!isThreadCursor({
			sticky: p.cursorSticky as number,
			lastPostAt: p.cursorTime as number,
			id: p.cursorId as number,
		})
	)
		throw new Error("Invalid thread-list cursor");
}

/** The same snapshot validation is used by live reads and management. */
export function isThreadListCacheData(
	descriptor: CacheDescriptor,
	value: unknown,
): value is ThreadListCacheData {
	try {
		validateThreadListDescriptor(descriptor);
	} catch {
		return false;
	}
	const p = descriptor.params;
	if (p.kind === "count") return isCount(value) && Object.keys(value).length === 1;
	if (!isItems(value)) return false;
	if (new Set(value.items.map((row) => row.id)).size !== value.items.length) return false;
	if (p.kind === "announcements") {
		return (
			isCount(value) &&
			Object.keys(value).length === 2 &&
			value.total === value.items.length &&
			value.items.every((row) => row.sticky === STICKY_GLOBAL)
		);
	}
	// Reject old combined pages so a page fill can never carry forward a stale count.
	if (Object.keys(value).length !== 1 || value.items.length > Number(p.limit)) return false;
	return value.items.every(
		(row) =>
			(p.typeId !== null || row.sticky !== STICKY_GLOBAL) &&
			(p.cursorId === null ||
				followsCursor(row, {
					sticky: p.cursorSticky as number,
					lastPostAt: p.cursorTime as number,
					id: p.cursorId as number,
				})),
	);
}

/** Authoritative and side-effect-free: safe for the management dispatcher. */
export async function rebuildThreadListCache(
	env: Env,
	_ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
): Promise<ThreadListCacheData> {
	validateThreadListDescriptor(descriptor);
	const p = descriptor.params;
	if (p.kind === "announcements") {
		const result = await env.DB.prepare(
			`SELECT t.id, t.sticky, t.last_post_at FROM threads t
			 JOIN forums f ON f.id = t.forum_id
			 WHERE t.sticky = ${STICKY_GLOBAL} AND f.status = 1
			 ORDER BY t.last_post_at DESC, t.id DESC`,
		).all<ThreadListMember>();
		if (!result.success) throw new Error("Announcement query failed");
		const data = { items: result.results, total: result.results.length };
		if (!isThreadListCacheData(descriptor, data)) throw new Error("Invalid announcement result");
		return data;
	}
	// Type-filtered lists never merge announcements from other forums.
	const where =
		p.typeId === null
			? `t.forum_id = ? AND t.sticky >= 0 AND t.sticky != ${STICKY_GLOBAL}`
			: "t.forum_id = ? AND t.type_id = ? AND t.sticky >= 0";
	const bindings = p.typeId === null ? [p.forumId] : [p.forumId, p.typeId];
	if (p.kind === "count") {
		const result = await env.DB.prepare(`SELECT COUNT(*) as total FROM threads t WHERE ${where}`)
			.bind(...bindings)
			.all<ThreadListCount>();
		const count = result.results[0];
		if (!result.success || result.results.length !== 1 || !isThreadListCacheData(descriptor, count))
			throw new Error("Thread-list count query failed");
		return count;
	}
	// Untyped membership excludes global pins. Native order stops after the
	// needed timestamp groups; tuple cursors also seek past earlier groups.
	const rank =
		p.typeId === null
			? "t.sticky"
			: `CASE WHEN t.sticky = ${STICKY_GLOBAL} THEN 4 ELSE t.sticky END`;
	const cursor =
		p.cursorId === null
			? ""
			: p.typeId === null
				? " AND (t.sticky, t.last_post_at, t.id) < (?, ?, ?)"
				: ` AND (${rank} < ? OR (${rank} = ? AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))))`;
	const cursorBindings =
		p.cursorId === null
			? []
			: p.typeId === null
				? [p.cursorSticky, p.cursorTime, p.cursorId]
				: [p.cursorSticky, p.cursorSticky, p.cursorTime, p.cursorTime, p.cursorId];
	const rows = await env.DB.prepare(`SELECT t.id, t.sticky, t.last_post_at FROM threads t
			WHERE ${where}${cursor}
			ORDER BY ${rank} DESC, t.last_post_at DESC, t.id DESC LIMIT ? OFFSET ?`)
		.bind(...bindings, ...cursorBindings, p.limit, p.offset)
		.all<ThreadListMember>();
	if (!rows.success) throw new Error("Thread-list query failed");
	const data = { items: rows.results };
	if (!isThreadListCacheData(descriptor, data)) throw new Error("Invalid thread-list result");
	return data;
}

/** KV-only current-version check, shared by live reads and management. */
export async function threadListCacheKey(env: Env, descriptor: CacheDescriptor): Promise<string> {
	validateThreadListDescriptor(descriptor);
	const forumId = descriptor.params.forumId;
	const [all, forum] = await Promise.all([
		getGen(env, threadListGenAllKey()),
		typeof forumId === "number" ? getGen(env, threadListGenKey(forumId)) : Promise.resolve("0"),
	]);
	return dataCacheKey(descriptor.family, descriptor.params, descriptor.scope, { all, forum });
}

async function readSnapshot(
	env: Env,
	ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
	gens: { all: string; forum: string },
): Promise<ThreadListCacheData> {
	validateThreadListDescriptor(descriptor);
	const key = await dataCacheKey(descriptor.family, descriptor.params, descriptor.scope, {
		all: gens.all,
		forum: typeof descriptor.params.forumId === "number" ? gens.forum : "0",
	});
	return cacheGetOrSet(env, ctx, key, () => rebuildThreadListCache(env, ctx, descriptor), {
		...descriptor,
		tier: "SHORT",
		validator: (value): value is ThreadListCacheData => isThreadListCacheData(descriptor, value),
	});
}

/** All legal limits, filters, keyset cursors and offset pages are cached. */
export async function getThreadListPage(
	env: Env,
	ctx: ExecutionContext | undefined,
	query: ThreadListQuery,
	fresh = false,
): Promise<ThreadListMembership & { nextCursor: string | null }> {
	const { forumId, limit, typeId, cursor, page } = query;
	if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * limit)) {
		throw new Error("Invalid thread-list page");
	}
	// Capture versions once for this response; later calls read them again.
	const gens = fresh
		? null
		: await Promise.all([
				getGen(env, threadListGenAllKey()),
				getGen(env, threadListGenKey(forumId)),
			]);
	const read = (descriptor: CacheDescriptor) =>
		gens
			? readSnapshot(env, ctx, descriptor, { all: gens[0], forum: gens[1] })
			: rebuildThreadListCache(env, ctx, descriptor);
	// Global membership is shared between forums. Nothing from this snapshot
	// is copied into the local cache, so composition cannot renew its lifetime.
	const announcements =
		typeId === null
			? await read({
					family: "thread:list",
					scope: "internal",
					params: { kind: "announcements" },
				})
			: { items: [], total: 0 };
	if (!isItems(announcements) || !isCount(announcements))
		throw new Error("Invalid announcement snapshot");
	const offset = cursor ? 0 : (page - 1) * limit;
	const globals = cursor
		? announcements.items.filter((row) => followsCursor(row, cursor))
		: announcements.items.slice(offset);
	const descriptor: CacheDescriptor = {
		family: "thread:list",
		scope: "internal",
		params: {
			kind: "local",
			forumId,
			typeId,
			limit,
			offset: Math.max(0, offset - announcements.total),
			cursorSticky: cursor?.sticky ?? null,
			cursorTime: cursor?.lastPostAt ?? null,
			cursorId: cursor?.id ?? null,
		},
	};
	// Counts are shared by every page/cursor/limit and expire independently.
	// Only this response combines them; neither snapshot copies the other.
	const [local, count] = await Promise.all([
		read(descriptor),
		read({
			family: "thread:list",
			scope: "internal",
			params: { kind: "count", forumId, typeId },
		}),
	]);
	if (!isItems(local) || !isCount(count)) throw new Error("Invalid thread-list snapshot");
	const items = [...globals, ...local.items].slice(0, limit);
	const nextCursor = buildNextCursor(items, limit, (row) => ({
		sticky: stickyRank(row.sticky),
		lastPostAt: row.last_post_at,
		id: row.id,
	}));
	return { items, total: announcements.total + count.total, nextCursor };
}
