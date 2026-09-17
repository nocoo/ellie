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

export interface ThreadListMembership {
	items: ThreadListMember[];
	total: number;
}

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

function isMembership(value: unknown): value is ThreadListMembership {
	if (typeof value !== "object" || value === null) return false;
	const v = value as ThreadListMembership;
	return (
		Number.isSafeInteger(v.total) &&
		v.total >= 0 &&
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
	const keys = [
		"kind",
		"forumId",
		"typeId",
		"limit",
		"offset",
		"cursorSticky",
		"cursorTime",
		"cursorId",
	];
	if (
		Object.keys(p).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(p, key)) ||
		p.kind !== "local" ||
		!Number.isSafeInteger(p.forumId) ||
		Number(p.forumId) <= 0 ||
		!Number.isSafeInteger(p.limit) ||
		Number(p.limit) < 1 ||
		Number(p.limit) > 100 ||
		!Number.isSafeInteger(p.offset) ||
		Number(p.offset) < 0 ||
		(p.typeId !== null && (!Number.isSafeInteger(p.typeId) || Number(p.typeId) <= 0))
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

/** The same membership validation is used by live reads and management. */
export function isThreadListCacheData(
	descriptor: CacheDescriptor,
	value: unknown,
): value is ThreadListMembership {
	try {
		validateThreadListDescriptor(descriptor);
	} catch {
		return false;
	}
	if (!isMembership(value) || value.items.length > value.total) return false;
	if (new Set(value.items.map((row) => row.id)).size !== value.items.length) return false;
	const p = descriptor.params;
	if (p.kind === "announcements") {
		return (
			value.total === value.items.length && value.items.every((row) => row.sticky === STICKY_GLOBAL)
		);
	}
	if (value.items.length > Number(p.limit)) return false;
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
): Promise<ThreadListMembership> {
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
		return { items: result.results, total: result.results.length };
	}
	// Type-filtered lists never merge announcements from other forums.
	const where =
		p.typeId === null
			? `t.forum_id = ? AND t.sticky >= 0 AND t.sticky != ${STICKY_GLOBAL}`
			: "t.forum_id = ? AND t.type_id = ? AND t.sticky >= 0";
	const bindings = p.typeId === null ? [p.forumId] : [p.forumId, p.typeId];
	const rank = `CASE WHEN t.sticky = ${STICKY_GLOBAL} THEN 4 ELSE t.sticky END`;
	const cursor =
		p.cursorId === null
			? ""
			: ` AND (${rank} < ? OR (${rank} = ? AND (t.last_post_at < ? OR (t.last_post_at = ? AND t.id < ?))))`;
	const cursorBindings =
		p.cursorId === null
			? []
			: [p.cursorSticky, p.cursorSticky, p.cursorTime, p.cursorTime, p.cursorId];
	const [count, rows] = await Promise.all([
		env.DB.prepare(`SELECT COUNT(*) as total FROM threads t WHERE ${where}`)
			.bind(...bindings)
			.first<{ total: number }>(),
		env.DB.prepare(`SELECT t.id, t.sticky, t.last_post_at FROM threads t
			WHERE ${where}${cursor}
			ORDER BY ${rank} DESC, t.last_post_at DESC, t.id DESC LIMIT ? OFFSET ?`)
			.bind(...bindings, ...cursorBindings, p.limit, p.offset)
			.all<ThreadListMember>(),
	]);
	if (!rows.success) throw new Error("Thread-list query failed");
	return { items: rows.results, total: count?.total ?? 0 };
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

async function readMembership(
	env: Env,
	ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
): Promise<ThreadListMembership> {
	const key = await threadListCacheKey(env, descriptor);
	return cacheGetOrSet(env, ctx, key, () => rebuildThreadListCache(env, ctx, descriptor), {
		...descriptor,
		tier: "SHORT",
		validator: (value): value is ThreadListMembership => isThreadListCacheData(descriptor, value),
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
	// Global membership is shared between forums. Nothing from this snapshot
	// is copied into the local cache, so composition cannot renew its lifetime.
	const read = fresh ? rebuildThreadListCache : readMembership;
	const announcements =
		typeId === null
			? await read(env, ctx, {
					family: "thread:list",
					scope: "internal",
					params: { kind: "announcements" },
				})
			: { items: [], total: 0 };
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
	const local = await read(env, ctx, descriptor);
	const items = [...globals, ...local.items].slice(0, limit);
	const nextCursor = buildNextCursor(items, limit, (row) => ({
		sticky: stickyRank(row.sticky),
		lastPostAt: row.last_post_at,
		id: row.id,
	}));
	return { items, total: announcements.total + local.total, nextCursor };
}
