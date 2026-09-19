// Reusable reading data. Authorization and view/read side effects belong to
// handlers; management rebuilds only call the authoritative functions here.
import type {
	CacheDescriptor,
	CacheTier,
	ForumVisibility,
	PostRatingAggregate,
} from "@ellie/types";
import { EMPTY_RATING_AGGREGATE } from "@ellie/types";
import type { Env } from "../env";
import type { ViewerContext } from "../mappers";
import {
	buildVisibilityContext,
	canReadThreadContent,
	canViewModeratedThread,
	STICKY_MODERATED,
} from "../visibility";
import { getGen, getGens } from "./epoch";
import {
	dataCacheKey,
	postAttachmentsGenKey,
	postEntityGenKey,
	postListGenKey,
	threadMetaGenKey,
} from "./keys";
import {
	isThreadListCacheData,
	rebuildThreadListCache,
	threadListCacheKey,
	validateThreadListDescriptor,
} from "./thread-list-read";
import { cacheGetOrSet, cacheReadMany } from "./wrap";

export type ReadingRow = Record<string, unknown>;
const SCOPE = "internal";
const BATCH_SIZE = 100;

export function validReadingId(id: unknown): id is number {
	return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

function uniqueIds(ids: readonly number[]): number[] {
	return [...new Set(ids)].filter(validReadingId);
}

function isRow(value: unknown): value is ReadingRow {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		validReadingId((value as ReadingRow).id)
	);
}

const THREAD_COLUMNS = `t.id, t.forum_id, t.author_id, t.author_name, t.subject, t.created_at,
	t.closed, t.sticky, t.digest, t.special, t.highlight, t.type_id, t.type_name, t.anonymous_author,
	EXISTS(SELECT 1 FROM forum_recommended_threads r
		WHERE r.forum_id = t.forum_id AND r.thread_id = t.id) AS is_recommended`;
const THREAD_STATS_COLUMNS = `t.id, t.replies, t.views, t.last_post_at, t.last_poster,
	t.last_poster_id, t.anonymous_last_poster, t.recommends`;
const POST_COLUMNS = `id, thread_id, forum_id, author_id, author_name, content, created_at,
	is_first, position, anonymous`;
const ATTACHMENT_COLUMNS = `id, thread_id, post_id, author_id, filename, file_path,
	file_size, is_image, width, has_thumb, downloads, created_at`;
const COMMENT_COLUMNS = `id, thread_id, post_id, author_id, author_name, content,
	score, reply_post_id, created_at`;
const RATING_COLUMNS = `id, post_id, thread_id, rater_id, rater_name, dimension,
	score, reason, created_at, revoked_at`;
const AGGREGATE_COLUMNS = `COUNT(*) AS total,
	COALESCE(SUM(CASE WHEN dimension = 1 THEN 1 ELSE 0 END), 0) AS credits_count,
	COALESCE(SUM(CASE WHEN dimension = 1 THEN score ELSE 0 END), 0) AS credits_sum,
	COALESCE(SUM(CASE WHEN dimension = 2 THEN 1 ELSE 0 END), 0) AS coins_count,
	COALESCE(SUM(CASE WHEN dimension = 2 THEN score ELSE 0 END), 0) AS coins_sum`;

async function selectIds(
	env: Env,
	ids: number[],
	sql: (placeholders: string) => string,
	trailingBindings: number[] = [],
): Promise<ReadingRow[]> {
	const rows: ReadingRow[] = [];
	const size = BATCH_SIZE - trailingBindings.length;
	for (let i = 0; i < ids.length; i += size) {
		const batch = ids.slice(i, i + size);
		const result = await env.DB.prepare(sql(batch.map(() => "?").join(",")))
			.bind(...batch, ...trailingBindings)
			.all<ReadingRow>();
		if (!result.success) throw new Error("Reading data query failed");
		rows.push(...result.results);
	}
	return rows;
}

/** Batch only missing entities; core owns I/O, time validation and coalescing. */
async function readEntities<T>(
	env: Env,
	ctx: ExecutionContext | undefined,
	ids: readonly number[],
	options: {
		family: string;
		tier: CacheTier;
		params: (id: number) => CacheDescriptor["params"];
		batchSize?: number;
		load: (ids: number[]) => Promise<Map<number, T>>;
		empty: () => T;
		cacheKey?: (id: number) => Promise<string>;
	},
): Promise<Map<number, T>> {
	const result = new Map<number, T>();
	const unique = uniqueIds(ids);
	const size = options.batchSize ?? BATCH_SIZE;
	for (let start = 0; start < unique.length; start += size) {
		const batch = unique.slice(start, start + size);
		const entries = await Promise.all(
			batch.map(async (id) => {
				const params = options.params(id);
				const descriptor = { family: options.family, params, scope: SCOPE };
				const key = options.cacheKey
					? await options.cacheKey(id)
					: await readingCacheKey(env, descriptor);
				return {
					id,
					key,
					options: {
						family: options.family,
						tier: options.tier,
						params,
						scope: SCOPE,
						validator: (value: unknown): value is T => isThreadCacheData(descriptor, value),
					},
				};
			}),
		);
		const byKey = new Map(entries.map((entry) => [entry.key, entry.options]));
		const cached = await cacheReadMany<T>(
			env,
			entries.map((entry) => entry.key),
			(key) => byKey.get(key) as (typeof entries)[number]["options"],
		);
		const missing = entries.filter((entry) => !cached.has(entry.key));
		// Lazy: 100 concurrent callers share the core's per-key tasks; only a
		// winning task starts this batch, including during a slow KV refill.
		let loading: Promise<Map<number, T>> | undefined;
		await Promise.all(
			entries.map(async (entry) => {
				if (cached.has(entry.key)) {
					result.set(entry.id, cached.get(entry.key) as T);
					return;
				}
				const value = await cacheGetOrSet(
					env,
					ctx,
					entry.key,
					async () => {
						loading ??= options.load(missing.map((item) => item.id));
						return (await loading).get(entry.id) ?? options.empty();
					},
					{ ...entry.options, knownMiss: true },
				);
				result.set(entry.id, value);
			}),
		);
	}
	return result;
}

function byId(rows: ReadingRow[]): Map<number, ReadingRow | null> {
	return new Map(rows.map((row) => [row.id as number, row]));
}

export async function loadThreadEntities(
	env: Env,
	ids: number[],
): Promise<Map<number, ReadingRow | null>> {
	return byId(
		await selectIds(
			env,
			ids,
			(p) => `SELECT ${THREAD_COLUMNS} FROM threads t WHERE t.id IN (${p})`,
		),
	);
}

export async function loadThreadStats(
	env: Env,
	ids: number[],
): Promise<Map<number, ReadingRow | null>> {
	return byId(
		await selectIds(
			env,
			ids,
			(p) => `SELECT ${THREAD_STATS_COLUMNS} FROM threads t WHERE t.id IN (${p})`,
		),
	);
}

export async function loadPostEntities(
	env: Env,
	ids: number[],
	threadId: number,
): Promise<Map<number, ReadingRow | null>> {
	return byId(
		await selectIds(
			env,
			ids,
			(p) => `SELECT ${POST_COLUMNS} FROM posts WHERE id IN (${p}) AND thread_id = ?`,
			[threadId],
		),
	);
}

async function threadMetaGens(env: Env, ids: readonly number[]): Promise<Map<number, string>> {
	const unique = uniqueIds(ids);
	const tokens = await getGens(env, unique.map(threadMetaGenKey));
	return new Map(unique.map((id) => [id, tokens.get(threadMetaGenKey(id)) as string]));
}

async function threadResourceCacheKey(
	family: "thread:entity" | "thread:stats",
	threadId: number,
	gen: string,
): Promise<string> {
	const descriptor = { family, params: { threadId }, scope: SCOPE };
	validateThreadCacheDescriptor(descriptor);
	return dataCacheKey(family, { threadId }, SCOPE, { resource: gen });
}

export async function getThreadRows(
	env: Env,
	ctx: ExecutionContext | undefined,
	ids: readonly number[],
): Promise<Map<number, ReadingRow>> {
	const gens = await threadMetaGens(env, ids);
	const cacheKey = (family: "thread:entity" | "thread:stats") => (id: number) =>
		threadResourceCacheKey(family, id, gens.get(id) as string);
	const [entities, stats] = await Promise.all([
		readEntities(env, ctx, ids, {
			family: "thread:entity",
			tier: "MEDIUM",
			params: (threadId) => ({ threadId }),
			load: (missing) => loadThreadEntities(env, missing),
			empty: () => null,
			cacheKey: cacheKey("thread:entity"),
		}),
		readEntities(env, ctx, ids, {
			family: "thread:stats",
			tier: "SHORT",
			params: (threadId) => ({ threadId }),
			load: (missing) => loadThreadStats(env, missing),
			empty: () => null,
			cacheKey: cacheKey("thread:stats"),
		}),
	]);
	const rows = new Map<number, ReadingRow>();
	for (const [id, entity] of entities) {
		if (entity) rows.set(id, { ...entity, ...stats.get(id) });
	}
	return rows;
}

export async function getPostRows(
	env: Env,
	ctx: ExecutionContext | undefined,
	ids: readonly number[],
	threadId: number,
): Promise<Map<number, ReadingRow>> {
	const values = await readEntities(env, ctx, ids, {
		family: "post:entity",
		tier: "MEDIUM",
		params: (postId) => ({ postId, threadId }),
		batchSize: 99,
		load: (missing) => loadPostEntities(env, missing, threadId),
		empty: () => null,
	});
	const rows = new Map<number, ReadingRow>();
	for (const [id, row] of values) if (row) rows.set(id, { ...row });
	return rows;
}

/** Cross-thread pages share body keys while loading only missing post IDs. */
export async function getPostRowsBatch(
	env: Env,
	ctx: ExecutionContext | undefined,
	members: readonly { postId: number; threadId: number }[],
): Promise<Map<number, ReadingRow>> {
	const threadIds = new Map<number, number>();
	for (const { postId, threadId } of members) {
		if (!validReadingId(postId) || !validReadingId(threadId)) {
			throw new Error("Invalid post cache member");
		}
		if (threadIds.has(postId) && threadIds.get(postId) !== threadId) {
			throw new Error("Conflicting post thread association");
		}
		threadIds.set(postId, threadId);
	}
	const values = await readEntities(env, ctx, [...threadIds.keys()], {
		family: "post:entity",
		tier: "MEDIUM",
		params: (postId) => ({ postId, threadId: threadIds.get(postId) as number }),
		load: async (missing) => {
			const rows = await selectIds(
				env,
				missing,
				(p) => `SELECT ${POST_COLUMNS} FROM posts WHERE id IN (${p})`,
			);
			return byId(rows.filter((row) => row.thread_id === threadIds.get(row.id as number)));
		},
		empty: () => null,
	});
	const rows = new Map<number, ReadingRow>();
	for (const [id, row] of values) if (row) rows.set(id, { ...row });
	return rows;
}

export interface PostPageQuery {
	threadId: number;
	limit: number;
	cursorPosition: number | null;
	last: boolean;
}
export interface PostPageMember {
	id: number;
	position: number;
}

export async function loadPostPage(env: Env, query: PostPageQuery): Promise<PostPageMember[]> {
	const { threadId, limit, cursorPosition, last } = query;
	const where = !last && cursorPosition !== null ? " AND position > ?" : "";
	const bindings =
		!last && cursorPosition !== null ? [threadId, cursorPosition, limit] : [threadId, limit];
	const result = await env.DB.prepare(`SELECT id, position FROM posts
		WHERE thread_id = ? AND invisible = 0${where} ORDER BY position${last ? " DESC" : ""} LIMIT ?`)
		.bind(...bindings)
		.all<PostPageMember>();
	if (!result.success) throw new Error("Post page query failed");
	return last ? result.results.reverse() : result.results;
}

export async function getPostPage(
	env: Env,
	ctx: ExecutionContext | undefined,
	query: PostPageQuery,
): Promise<PostPageMember[]> {
	const params = { ...query, cursorPosition: query.last ? null : query.cursorPosition };
	const descriptor = { family: "post:page", params, scope: SCOPE };
	const key = await readingCacheKey(env, descriptor);
	return cacheGetOrSet(env, ctx, key, () => loadPostPage(env, params), {
		...descriptor,
		tier: "SHORT",
		validator: (v): v is PostPageMember[] => isThreadCacheData(descriptor, v),
	});
}

function groupRows(ids: number[], rows: ReadingRow[], column: string): Map<number, ReadingRow[]> {
	const grouped = new Map(ids.map((id) => [id, [] as ReadingRow[]]));
	for (const row of rows) grouped.get(row[column] as number)?.push(row);
	return grouped;
}

export async function loadPostAttachments(
	env: Env,
	ids: number[],
	threadId: number,
): Promise<Map<number, ReadingRow[]>> {
	return groupRows(
		ids,
		await selectIds(
			env,
			ids,
			(p) =>
				`SELECT ${ATTACHMENT_COLUMNS} FROM attachments WHERE post_id IN (${p})
		 AND EXISTS (SELECT 1 FROM posts p WHERE p.id = attachments.post_id AND p.thread_id = ?)
		 ORDER BY post_id, id`,
			[threadId],
		),
		"post_id",
	);
}

export async function getPostAttachments(
	env: Env,
	ctx: ExecutionContext | undefined,
	ids: readonly number[],
	threadId: number,
): Promise<Map<number, ReadingRow[]>> {
	return readEntities(env, ctx, ids, {
		family: "post:attachments",
		tier: "LONG",
		params: (postId) => ({ postId, threadId }),
		batchSize: 99,
		load: (missing) => loadPostAttachments(env, missing, threadId),
		empty: () => [],
	});
}

export async function loadPostComments(
	env: Env,
	ids: number[],
	limit: number | null,
): Promise<Map<number, ReadingRow[]>> {
	// Numeric limit was validated before construction. Windowing keeps one
	// query per batch while matching each post's individual LIMIT semantics.
	const rows = await selectIds(env, ids, (p) =>
		limit === null
			? `SELECT ${COMMENT_COLUMNS} FROM post_comments WHERE post_id IN (${p}) ORDER BY post_id, created_at, id`
			: `SELECT ${COMMENT_COLUMNS} FROM (SELECT ${COMMENT_COLUMNS},
			ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY created_at, id) AS rn
			FROM post_comments WHERE post_id IN (${p})) WHERE rn <= ${limit} ORDER BY post_id, created_at, id`,
	);
	return groupRows(ids, rows, "post_id");
}

export async function getPostComments(
	env: Env,
	ctx: ExecutionContext | undefined,
	ids: readonly number[],
	limit: number | null,
): Promise<Map<number, ReadingRow[]>> {
	if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 100))
		throw new Error("Invalid comment limit");
	return readEntities(env, ctx, ids, {
		family: "post:comments",
		tier: "MEDIUM",
		params: (postId) => ({ postId, limit }),
		load: (missing) => loadPostComments(env, missing, limit),
		empty: () => [],
	});
}

export async function loadRatingAggregates(
	env: Env,
	ids: number[],
): Promise<Map<number, PostRatingAggregate>> {
	const rows = await selectIds(
		env,
		ids,
		(p) => `SELECT post_id, ${AGGREGATE_COLUMNS}
		FROM post_ratings WHERE revoked_at = 0 AND post_id IN (${p}) GROUP BY post_id`,
	);
	return new Map(
		rows.map((row) => [
			row.post_id as number,
			{
				total: row.total as number,
				credits: { count: row.credits_count as number, sum: row.credits_sum as number },
				coins: { count: row.coins_count as number, sum: row.coins_sum as number },
			},
		]),
	);
}

export async function getRatingAggregates(
	env: Env,
	ctx: ExecutionContext | undefined,
	ids: readonly number[],
): Promise<Map<number, PostRatingAggregate>> {
	return readEntities(env, ctx, ids, {
		family: "post:ratings",
		tier: "MEDIUM",
		params: (postId) => ({ postId }),
		load: (missing) => loadRatingAggregates(env, missing),
		empty: () => ({ ...EMPTY_RATING_AGGREGATE }),
	});
}

export async function loadRatingRows(env: Env, postId: number): Promise<ReadingRow[]> {
	const result = await env.DB.prepare(`SELECT ${RATING_COLUMNS} FROM post_ratings
		WHERE post_id = ? AND revoked_at = 0 ORDER BY created_at DESC LIMIT 200`)
		.bind(postId)
		.all<ReadingRow>();
	if (!result.success) throw new Error("Rating query failed");
	return result.results;
}

export async function getRatingRows(
	env: Env,
	ctx: ExecutionContext | undefined,
	postId: number,
): Promise<ReadingRow[]> {
	const descriptor = { family: "post:rating-rows", params: { postId }, scope: SCOPE };
	const key = await readingCacheKey(env, descriptor);
	return cacheGetOrSet(env, ctx, key, () => loadRatingRows(env, postId), {
		...descriptor,
		tier: "MEDIUM",
		validator: (v): v is ReadingRow[] => isThreadCacheData(descriptor, v),
	});
}

export interface ThreadAccess extends ReadingRow {
	id: number;
	forum_id: number;
	sticky: number;
	author_id: number;
	anonymous_author: number;
	last_poster_id: number;
	anonymous_last_poster: number;
	status: number;
	visibility: string;
	moderator_ids: string;
}

const ACCESS_COLUMNS = `t.id, t.forum_id, t.sticky, t.author_id, t.anonymous_author,
	t.last_poster_id, t.anonymous_last_poster, t.closed, t.type_id,
	f.status, f.visibility, f.moderator_ids`;

/** Always authoritative. Never use entity snapshots to approve access. */
export async function loadThreadAccess(env: Env, threadId: number): Promise<ThreadAccess | null> {
	return env.DB.prepare(`SELECT ${ACCESS_COLUMNS} FROM threads t
		JOIN forums f ON f.id = t.forum_id WHERE t.id = ?`)
		.bind(threadId)
		.first<ThreadAccess>();
}

export async function loadThreadAccessBatch(
	env: Env,
	ids: number[],
): Promise<Map<number, ThreadAccess>> {
	const rows = await selectIds(
		env,
		uniqueIds(ids),
		(p) => `SELECT ${ACCESS_COLUMNS}
		FROM threads t JOIN forums f ON f.id = t.forum_id WHERE t.id IN (${p})`,
	);
	return new Map(rows.map((row) => [row.id as number, row as ThreadAccess]));
}

export function threadAccessStatus(
	row:
		| Pick<ThreadAccess, "status" | "sticky" | "author_id" | "visibility" | "moderator_ids">
		| null
		| undefined,
	user: ViewerContext | null,
): 403 | 404 | null {
	if (row?.status !== 1 || (row.sticky < 0 && row.sticky !== STICKY_MODERATED)) return 404;
	const canRead = canReadThreadContent({
		sticky: row.sticky,
		forumVisibility: row.visibility as ForumVisibility,
		visCtx: buildVisibilityContext(user),
	});
	if (row.sticky === STICKY_MODERATED) {
		// Authorship/moderation never grants access to an unreadable source forum.
		if (!canRead) return 404;
		return canViewModeratedThread({
			authorId: row.author_id,
			forumModeratorIds: row.moderator_ids ?? "",
			user,
		})
			? null
			: 404;
	}
	return canRead ? null : 403;
}

/** No cached author identity may bypass a changed anonymous/ownership flag. */
export function projectCurrentThread(row: ReadingRow, access: ThreadAccess): ReadingRow {
	return {
		...row,
		forum_id: access.forum_id,
		sticky: access.sticky,
		closed: access.closed,
		author_id: access.author_id,
		anonymous_author: access.anonymous_author,
		...(row.last_poster_id === access.last_poster_id
			? { anonymous_last_poster: access.anonymous_last_poster }
			: {}),
	};
}

export interface PostAccess extends ReadingRow {
	id: number;
	thread_id: number;
	invisible: number;
	anonymous: number;
	author_id: number;
}

export async function loadPostAccess(env: Env, postId: number): Promise<PostAccess | null> {
	return env.DB.prepare(
		"SELECT id, thread_id, invisible, anonymous, author_id FROM posts WHERE id = ?",
	)
		.bind(postId)
		.first<PostAccess>();
}

export async function loadPostAccessBatch(
	env: Env,
	ids: readonly number[],
	threadId: number,
): Promise<Map<number, PostAccess>> {
	const unique = uniqueIds(ids);
	const rows = new Map<number, PostAccess>();
	// Reserve one of D1's 100 bindings for thread_id.
	for (let start = 0; start < unique.length; start += 99) {
		const batch = unique.slice(start, start + 99);
		const result =
			await env.DB.prepare(`SELECT id, thread_id, invisible, anonymous, author_id FROM posts
			WHERE id IN (${batch.map(() => "?").join(",")}) AND thread_id = ? AND invisible = 0`)
				.bind(...batch, threadId)
				.all<PostAccess>();
		if (!result.success) throw new Error("Post access query failed");
		for (const row of result.results) rows.set(row.id, row);
	}
	return rows;
}

function validatePostPageParams(p: CacheDescriptor["params"]): void {
	if (
		!hasExactParams(p, ["threadId", "limit", "cursorPosition", "last"]) ||
		!validReadingId(p.threadId) ||
		!Number.isSafeInteger(p.limit) ||
		Number(p.limit) < 1 ||
		Number(p.limit) > 100 ||
		typeof p.last !== "boolean" ||
		(p.cursorPosition !== null &&
			(!Number.isSafeInteger(p.cursorPosition) || Number(p.cursorPosition) < 0)) ||
		(p.last && p.cursorPosition !== null)
	)
		throw new Error("Invalid post page parameters");
}

function hasExactParams(params: CacheDescriptor["params"], fields: string[]): boolean {
	return (
		Object.keys(params).length === fields.length &&
		fields.every((field) => Object.hasOwn(params, field))
	);
}

export function validateThreadCacheDescriptor(descriptor: CacheDescriptor): void {
	if (descriptor.family === "thread:list" || descriptor.family === "thread:count") {
		validateThreadListDescriptor(descriptor);
		return;
	}
	if (descriptor.scope !== SCOPE) throw new Error("Invalid reading cache scope");
	const p = descriptor.params;
	if (typeof p !== "object" || p === null || Array.isArray(p))
		throw new Error("Invalid reading cache parameters");
	const threadFamily =
		descriptor.family === "thread:entity" || descriptor.family === "thread:stats";
	if (descriptor.family === "post:page") {
		validatePostPageParams(p);
		return;
	}
	const postThreadFamily =
		descriptor.family === "post:entity" || descriptor.family === "post:attachments";
	if (
		!threadFamily &&
		!postThreadFamily &&
		!["post:comments", "post:ratings", "post:rating-rows"].includes(descriptor.family)
	) {
		throw new Error("Unsupported reading cache family");
	}
	const fields = threadFamily
		? ["threadId"]
		: postThreadFamily
			? ["postId", "threadId"]
			: descriptor.family === "post:comments"
				? ["postId", "limit"]
				: ["postId"];
	if (!hasExactParams(p, fields) || !validReadingId(p[threadFamily ? "threadId" : "postId"])) {
		throw new Error("Invalid reading cache parameters");
	}
	if (postThreadFamily && !validReadingId(p.threadId))
		throw new Error("Invalid reading thread parameter");
	if (
		descriptor.family === "post:comments" &&
		p.limit !== null &&
		(!Number.isSafeInteger(p.limit) || Number(p.limit) < 1 || Number(p.limit) > 100)
	) {
		throw new Error("Invalid comment limit");
	}
}

/** Side-effect-free value validation, including descriptor/resource association. */
export function isThreadCacheData(descriptor: CacheDescriptor, value: unknown): boolean {
	try {
		validateThreadCacheDescriptor(descriptor);
	} catch {
		return false;
	}
	const p = descriptor.params;
	switch (descriptor.family) {
		case "thread:count":
		case "thread:list":
			return isThreadListCacheData(descriptor, value);
		case "thread:entity":
			return (
				value === null ||
				(isRow(value) && value.id === p.threadId && typeof value.subject === "string")
			);
		case "thread:stats":
			return (
				value === null ||
				(isRow(value) &&
					value.id === p.threadId &&
					Number.isFinite(value.replies) &&
					Number.isFinite(value.views))
			);
		case "post:entity":
			return (
				value === null ||
				(isRow(value) &&
					value.id === p.postId &&
					value.thread_id === p.threadId &&
					typeof value.content === "string")
			);
		case "post:page":
			return (
				Array.isArray(value) &&
				value.length <= Number(p.limit) &&
				value.every(
					(row) =>
						isRow(row) &&
						Number.isSafeInteger(row.position) &&
						(p.cursorPosition === null || Number(row.position) > Number(p.cursorPosition)),
				)
			);
		case "post:attachments":
			return (
				Array.isArray(value) &&
				value.every(
					(row) =>
						isRow(row) &&
						row.post_id === p.postId &&
						row.thread_id === p.threadId &&
						typeof row.filename === "string",
				)
			);
		case "post:comments":
			return (
				Array.isArray(value) &&
				(p.limit === null || value.length <= Number(p.limit)) &&
				value.every(
					(row) => isRow(row) && row.post_id === p.postId && typeof row.content === "string",
				)
			);
		case "post:rating-rows":
			return (
				Array.isArray(value) &&
				value.length <= 200 &&
				value.every(
					(row) => isRow(row) && row.post_id === p.postId && typeof row.reason === "string",
				)
			);
		case "post:ratings": {
			const aggregate = value as PostRatingAggregate | null;
			return (
				aggregate !== null &&
				typeof aggregate === "object" &&
				Number.isFinite(aggregate.total) &&
				Number.isFinite(aggregate.credits?.count) &&
				Number.isFinite(aggregate.credits?.sum) &&
				Number.isFinite(aggregate.coins?.count) &&
				Number.isFinite(aggregate.coins?.sum)
			);
		}
		default:
			return false;
	}
}

/** Same KV-only key derivation for live reads and management version checks. */
export async function readingCacheKey(env: Env, descriptor: CacheDescriptor): Promise<string> {
	validateThreadCacheDescriptor(descriptor);
	if (descriptor.family === "thread:list" || descriptor.family === "thread:count")
		return threadListCacheKey(env, descriptor);
	const { family, params, scope } = descriptor;
	const gens: Record<string, string> = {};
	if (family === "thread:entity" || family === "thread:stats") {
		gens.resource = await getGen(env, threadMetaGenKey(params.threadId as number));
	} else if (family === "post:page") {
		gens.thread = await getGen(env, postListGenKey(params.threadId as number));
	} else if (family === "post:entity" || family === "post:attachments") {
		[gens.resource, gens.thread] = await Promise.all([
			getGen(
				env,
				(family === "post:entity" ? postEntityGenKey : postAttachmentsGenKey)(
					params.postId as number,
				),
			),
			getGen(env, postListGenKey(params.threadId as number)),
		]);
	}
	return dataCacheKey(family, params, scope, gens);
}

/** Static dispatch: no request closures, credentials, cache writes, or views. */
export async function rebuildThreadCache(
	env: Env,
	ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
): Promise<unknown> {
	if (descriptor.family === "thread:list" || descriptor.family === "thread:count")
		return rebuildThreadListCache(env, ctx, descriptor);
	validateThreadCacheDescriptor(descriptor);
	const p = descriptor.params;
	const postId = p.postId as number;
	const threadId = p.threadId as number;
	switch (descriptor.family) {
		case "thread:entity":
			return (await loadThreadEntities(env, [threadId])).get(threadId) ?? null;
		case "thread:stats":
			return (await loadThreadStats(env, [threadId])).get(threadId) ?? null;
		case "post:entity":
			return (await loadPostEntities(env, [postId], threadId)).get(postId) ?? null;
		case "post:page":
			return loadPostPage(env, {
				threadId,
				limit: p.limit as number,
				cursorPosition: p.cursorPosition as number | null,
				last: p.last as boolean,
			});
		case "post:attachments":
			return (await loadPostAttachments(env, [postId], threadId)).get(postId) ?? [];
		case "post:comments":
			return (await loadPostComments(env, [postId], p.limit as number | null)).get(postId) ?? [];
		case "post:ratings":
			return (
				(await loadRatingAggregates(env, [postId])).get(postId) ?? { ...EMPTY_RATING_AGGREGATE }
			);
		case "post:rating-rows":
			return loadRatingRows(env, postId);
		default:
			throw new Error("Unsupported reading cache family");
	}
}
