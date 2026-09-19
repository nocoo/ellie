import {
	type CacheDescriptor,
	type CacheTier,
	encodeGenericCursor,
	getCheckinLevel,
	type PublicUser,
	type UserCheckinSummary,
} from "@ellie/types";
import type { Env } from "../env";
import { shouldUnmaskAnonymous, toPublicUser, type ViewerContext } from "../mappers";
import {
	buildForumFilter,
	buildVisibilityContext,
	postVisible,
	threadVisible,
	USER_ACTIVE,
} from "../visibility";
import { dataCacheKey, type ViewerBucket } from "./keys";
import { type CacheGetOrSetOptions, cacheGetOrSet, cacheReadMany } from "./wrap";

export interface UserStatsPayload {
	threads: number;
	posts: number;
	credits: number;
	coins: number;
	digestPosts: number;
	olTime: number;
	lastActivity: number;
	checkin: UserCheckinSummary | null;
}
export type StablePublicUser = Omit<PublicUser, keyof UserStatsPayload>;
export interface AvatarPathPayload {
	avatarPath: string;
}
export interface UserSearchResultItem {
	id: number;
	username: string;
}
export interface UserHistoryCursor {
	createdAt: number;
	id: number;
}
export interface HistoryMember {
	id: number;
	createdAt: number;
	threadId?: number;
}
export interface CachedHistoryList {
	items: HistoryMember[];
	nextCursor: string | null;
}
export type UserHistoryFamily = "user:threads" | "user:posts" | "user:digest";
const TIERS: Record<string, CacheTier> = {
	"user:public:v2": "MEDIUM",
	"user:stats": "SHORT",
	"user:avatar-path": "LONG",
	"user:threads": "SHORT",
	"user:posts": "SHORT",
	"user:digest": "SHORT",
	"user:search": "SHORT",
};
const STABLE_COLUMNS =
	"id, username, avatar, avatar_path, role, reg_date, signature, group_title, group_stars, group_color, custom_title, gender, birth_year, birth_month, birth_day, reside_province, reside_city, graduate_school, bio, interest, qq, site, campus";
const STATS_COLUMNS =
	"u.id, u.threads, u.posts, u.credits, u.coins, u.digest_posts, u.ol_time, u.last_activity, c.total_days, c.month_days, c.streak_days, c.last_checkin_at";
function positive(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
/** Validate reusable fields and the original audience before trusting a KV value. */
export function isUserCacheData(d: CacheDescriptor, value: unknown): boolean {
	if (value === null)
		return ["user:public:v2", "user:stats", "user:avatar-path"].includes(d.family);
	if (d.family === "user:search")
		return (
			Array.isArray(value) &&
			value.length <= Number(d.params.limit) &&
			value.every(
				(row) =>
					record(row) &&
					positive(row.id) &&
					typeof row.username === "string" &&
					Object.keys(row).every((key) => key === "id" || key === "username"),
			)
		);
	if (!record(value)) return false;
	if (d.family === "user:public:v2") {
		const fields = Object.keys(stableUser({}, d.scope === "staff"));
		return (
			value.id === d.params.id &&
			typeof value.username === "string" &&
			typeof value.avatarPath === "string" &&
			Number.isFinite(value.role) &&
			Object.keys(value).every((key) => fields.includes(key))
		);
	}
	if (d.family === "user:avatar-path")
		return Object.keys(value).length === 1 && typeof value.avatarPath === "string";
	if (d.family === "user:stats") {
		const numbers = [
			"threads",
			"posts",
			"credits",
			"coins",
			"digestPosts",
			"olTime",
			"lastActivity",
		];
		const checkin = value.checkin;
		return (
			numbers.every((key) => Number.isFinite(value[key])) &&
			Object.keys(value).every((key) => [...numbers, "checkin"].includes(key)) &&
			(checkin === null ||
				(record(checkin) &&
					["totalDays", "monthDays", "streakDays", "lastCheckinAt"].every((key) =>
						Number.isFinite(checkin[key]),
					) &&
					JSON.stringify(checkin.level) ===
						JSON.stringify(getCheckinLevel(Number(checkin.totalDays)))))
		);
	}
	return (
		Array.isArray(value.items) &&
		value.items.length <= Number(d.params.limit) &&
		(value.nextCursor === null || typeof value.nextCursor === "string") &&
		Object.keys(value).every((key) => key === "items" || key === "nextCursor") &&
		value.items.every(
			(row) =>
				record(row) &&
				positive(row.id) &&
				Number.isSafeInteger(row.createdAt) &&
				Number(row.createdAt) >= 0 &&
				(d.family !== "user:posts" || positive(row.threadId)) &&
				Object.keys(row).every((key) => ["id", "createdAt", "threadId"].includes(key)),
		)
	);
}
function dimensions(d: CacheDescriptor, expected: string[]): void {
	if (Object.keys(d.params).sort().join(",") !== expected.sort().join(","))
		throw new TypeError("Invalid user cache dimensions");
}
export function isHistoryCursor(value: Partial<UserHistoryCursor>): boolean {
	return (
		positive(value.id) && Number.isSafeInteger(value.createdAt) && Number(value.createdAt) >= 0
	);
}
export function userHistoryScope(viewer: ViewerContext | null, userId: number): string {
	return viewer ? `role_${viewer.role}_uid_${viewer.userId === userId ? "self" : "other"}` : "anon";
}
function historyViewer(d: CacheDescriptor): ViewerContext | null {
	if (d.scope === "anon") return null;
	const match = /^role_([0-3])_uid_(self|other)$/.exec(d.scope);
	if (!match) throw new TypeError("Invalid history audience");
	return { role: Number(match[1]), userId: match[2] === "self" ? Number(d.params.userId) : 0 };
}
function validateHistoryDescriptor(d: CacheDescriptor): void {
	const p = d.params;
	dimensions(d, ["userId", "limit", "cursorTime", "cursorId"]);
	historyViewer(d);
	if (!positive(p.userId) || !positive(p.limit) || p.limit > 50)
		throw new TypeError("Invalid history page");
	if (
		p.cursorId !== null &&
		(!positive(p.cursorId) || !Number.isSafeInteger(p.cursorTime) || Number(p.cursorTime) < 0)
	)
		throw new TypeError("Invalid history cursor");
	if ((p.cursorId === null) !== (p.cursorTime === null))
		throw new TypeError("Incomplete history cursor");
}

export function validateUserCacheDescriptor(d: CacheDescriptor): void {
	if (!TIERS[d.family]) throw new TypeError("Unknown user cache family");
	const p = d.params;
	if (d.family === "user:search") {
		dimensions(d, ["q", "limit"]);
		if (
			d.scope !== "public" ||
			typeof p.q !== "string" ||
			p.q.length < 2 ||
			p.q !== p.q.trim() ||
			!positive(p.limit) ||
			p.limit > 20
		)
			throw new TypeError("Invalid user search");
	} else if (["user:threads", "user:posts", "user:digest"].includes(d.family)) {
		validateHistoryDescriptor(d);
	} else {
		dimensions(d, d.family === "user:public:v2" ? ["id", "viewerBucket"] : ["id"]);
		if (!positive(p.id)) throw new TypeError("Invalid user ID");
		if (
			d.family === "user:public:v2"
				? !["public", "staff"].includes(d.scope) || p.viewerBucket !== d.scope
				: d.scope !== "public"
		)
			throw new TypeError("Invalid profile audience");
	}
}
export async function userCacheKey(_env: Env, d: CacheDescriptor): Promise<string> {
	validateUserCacheDescriptor(d);
	if (d.family === "user:public:v2") return `user:public:v2:${d.params.id}:${d.scope}`;
	if (d.family === "user:stats" || d.family === "user:avatar-path")
		return `${d.family}:${d.params.id}`;
	const key = await dataCacheKey(d.family, d.params, d.scope);
	return d.family === "user:search" && String(d.params.q).length > 256
		? `${key}:!unavailable`
		: key;
}

async function userRows(
	env: Env,
	ids: readonly number[],
	columns: string,
	join = "",
): Promise<Record<string, unknown>[]> {
	const rows: Record<string, unknown>[] = [];
	for (let offset = 0; offset < ids.length; offset += 80) {
		const part = ids.slice(offset, offset + 80);
		const result = await env.DB.prepare(
			`SELECT ${columns} FROM users u ${join} WHERE u.id IN (${part.map(() => "?").join(",")})`,
		)
			.bind(...part)
			.all<Record<string, unknown>>();
		if (!result.success) throw new Error("User rows could not be loaded");
		rows.push(...result.results);
	}
	return rows;
}
function stableUser(row: Record<string, unknown>, staff: boolean): StablePublicUser {
	const {
		threads: _threads,
		posts: _posts,
		credits: _credits,
		coins: _coins,
		digestPosts: _digest,
		olTime: _ol,
		lastActivity: _activity,
		checkin: _checkin,
		...stable
	} = toPublicUser(row, staff);
	return stable;
}
function statsUser(row: Record<string, unknown>): UserStatsPayload {
	const total = Number(row.total_days ?? 0);
	return {
		threads: Number(row.threads),
		posts: Number(row.posts),
		credits: Number(row.credits),
		coins: Number(row.coins),
		digestPosts: Number(row.digest_posts),
		olTime: Number(row.ol_time),
		lastActivity: Number(row.last_activity),
		checkin:
			total > 0
				? {
						totalDays: total,
						monthDays: Number(row.month_days),
						streakDays: Number(row.streak_days),
						lastCheckinAt: Number(row.last_checkin_at),
						level: getCheckinLevel(total),
					}
				: null,
	};
}
async function loadStableUsers(
	env: Env,
	ids: readonly number[],
	staff: boolean,
): Promise<Map<number, StablePublicUser>> {
	const rows = await userRows(env, ids, STABLE_COLUMNS + (staff ? ", reg_ip, last_ip" : ""));
	return new Map(rows.map((row) => [Number(row.id), stableUser(row, staff)]));
}
async function loadStatsUsers(
	env: Env,
	ids: readonly number[],
): Promise<Map<number, UserStatsPayload>> {
	const rows = await userRows(
		env,
		ids,
		STATS_COLUMNS,
		"LEFT JOIN user_checkins c ON c.user_id = u.id",
	);
	return new Map(rows.map((row) => [Number(row.id), statsUser(row)]));
}
export async function loadUserPublicFromDb(
	env: Env,
	id: number,
	staff: boolean,
): Promise<StablePublicUser | null> {
	return (await loadStableUsers(env, [id], staff)).get(id) ?? null;
}
export async function loadUserStatsFromDb(env: Env, id: number): Promise<UserStatsPayload | null> {
	return (await loadStatsUsers(env, [id])).get(id) ?? null;
}
export async function loadAvatarPathFromDb(
	env: Env,
	id: number,
): Promise<AvatarPathPayload | null> {
	const row = await env.DB.prepare("SELECT avatar_path FROM users WHERE id = ?")
		.bind(id)
		.first<{ avatar_path: string | null }>();
	return row ? { avatarPath: row.avatar_path ?? "" } : null;
}

/** Each family reads KV in bulk and shares one lazy SQL batch for its missing IDs. */
async function getUserParts<T>(
	env: Env,
	ctx: ExecutionContext | undefined,
	ids: readonly number[],
	descriptor: (id: number) => CacheDescriptor,
	loader: (ids: number[]) => Promise<Map<number, T>>,
): Promise<Map<number, T | null>> {
	const unique = [...new Set(ids)];
	const entries = await Promise.all(
		unique.map(async (id) => {
			const d = descriptor(id);
			return { id, d, key: await userCacheKey(env, d) };
		}),
	);
	const byKey = new Map(entries.map((entry) => [entry.key, entry]));
	const options = (key: string): CacheGetOrSetOptions<T | null> => {
		const entry = byKey.get(key);
		if (!entry) {
			throw new Error("Missing descriptor for bulk entry");
		}
		const d = entry.d;
		return {
			...d,
			tier: TIERS[d.family],
			validator: (value): value is T | null => isUserCacheData(d, value),
		};
	};
	const hits = await cacheReadMany<T | null>(
		env,
		entries.map((entry) => entry.key),
		options,
	);
	const missing = entries.filter((entry) => !hits.has(entry.key));
	let load: Promise<Map<number, T>> | undefined;
	const result = new Map<number, T | null>(
		entries
			.filter((entry) => hits.has(entry.key))
			.map((entry) => [entry.id, hits.get(entry.key) ?? null]),
	);
	for (let offset = 0; offset < missing.length; offset += 100) {
		await Promise.all(
			missing.slice(offset, offset + 100).map(async (entry) => {
				const value = await cacheGetOrSet(
					env,
					// Drain earlier batches so background fills cannot exhaust the pending budget.
					offset + 100 >= missing.length ? ctx : undefined,
					entry.key,
					async () => {
						load ??= loader(missing.map((item) => item.id));
						return (await load).get(entry.id) ?? null;
					},
					options(entry.key),
				);
				result.set(entry.id, value);
			}),
		);
	}
	return result;
}
export async function getPublicUsers(
	env: Env,
	ctx: ExecutionContext | undefined,
	ids: readonly number[],
	bucket: ViewerBucket,
): Promise<Map<number, PublicUser>> {
	const [stable, stats] = await Promise.all([
		getUserParts(
			env,
			ctx,
			ids,
			(id) => ({ family: "user:public:v2", params: { id, viewerBucket: bucket }, scope: bucket }),
			(missing) => loadStableUsers(env, missing, bucket === "staff"),
		),
		getUserParts(
			env,
			ctx,
			ids,
			(id) => ({ family: "user:stats", params: { id }, scope: "public" }),
			(missing) => loadStatsUsers(env, missing),
		),
	]);
	const result = new Map<number, PublicUser>();
	for (const id of ids) {
		const profile = stable.get(id);
		const counters = stats.get(id);
		if (profile && counters) result.set(id, { ...profile, ...counters });
	}
	return result;
}
export async function getAvatarPathCached(
	env: Env,
	ctx: ExecutionContext | undefined,
	id: number,
): Promise<AvatarPathPayload | null> {
	const d = { family: "user:avatar-path", params: { id }, scope: "public" };
	return cacheGetOrSet(env, ctx, await userCacheKey(env, d), () => loadAvatarPathFromDb(env, id), {
		...d,
		tier: "LONG",
		validator: (value): value is AvatarPathPayload | null => isUserCacheData(d, value),
	});
}
export async function loadUserHistory(env: Env, d: CacheDescriptor): Promise<CachedHistoryList> {
	validateUserCacheDescriptor(d);
	const p = d.params;
	const post = d.family === "user:posts";
	const alias = post ? "p" : "t";
	const viewer = historyViewer(d);
	const anon = post ? "p.anonymous" : "t.anonymous_author";
	const conditions = [
		`${alias}.author_id = ?`,
		threadVisible("t"),
		buildForumFilter(buildVisibilityContext(viewer), "f"),
	];
	if (!shouldUnmaskAnonymous(Number(p.userId), viewer)) conditions.push(`${anon} = 0`);
	if (post) conditions.push("p.is_first = 0", postVisible("p"));
	if (d.family === "user:digest") conditions.push("t.digest > 0");
	const bindings = [Number(p.userId)];
	if (p.cursorId !== null) {
		conditions.push(`(${alias}.created_at, ${alias}.id) < (?, ?)`);
		bindings.push(Number(p.cursorTime), Number(p.cursorId));
	}
	const result = await env.DB.prepare(
		`SELECT ${alias}.id, ${alias}.created_at AS createdAt${post ? ", p.thread_id AS threadId" : ""} FROM ${post ? "posts p JOIN threads t ON t.id = p.thread_id" : "threads t"} JOIN forums f ON f.id = t.forum_id WHERE ${conditions.join(" AND ")} ORDER BY ${alias}.created_at DESC, ${alias}.id DESC LIMIT ?`,
	)
		.bind(...bindings, Number(p.limit) + 1)
		.all<HistoryMember>();
	if (!result.success) throw new Error("User history could not be loaded");
	const items = result.results.slice(0, Number(p.limit));
	const last = items.at(-1);
	return {
		items,
		nextCursor:
			result.results.length > Number(p.limit) && last
				? encodeGenericCursor<UserHistoryCursor>({ createdAt: last.createdAt, id: last.id })
				: null,
	};
}
export async function getUserHistory(
	env: Env,
	ctx: ExecutionContext | undefined,
	d: CacheDescriptor,
): Promise<CachedHistoryList> {
	return cacheGetOrSet(env, ctx, await userCacheKey(env, d), () => loadUserHistory(env, d), {
		...d,
		tier: "SHORT",
		validator: (value): value is CachedHistoryList => isUserCacheData(d, value),
	});
}
export async function loadUserSearchFromDb(
	env: Env,
	q: string,
	limit: number,
): Promise<UserSearchResultItem[]> {
	const escaped = q.replace(/[%_\\]/g, "\\$&");
	const rows = await env.DB.prepare(
		`SELECT id, username FROM users WHERE username LIKE ? ESCAPE '\\' AND ${USER_ACTIVE} ORDER BY username LIMIT ?`,
	)
		.bind(`${escaped}%`, limit)
		.all<UserSearchResultItem>();
	if (!rows.success) throw new Error("User search could not be loaded");
	return rows.results;
}
export async function getUserSearchCached(
	env: Env,
	ctx: ExecutionContext | undefined,
	q: string,
	limit: number,
): Promise<UserSearchResultItem[]> {
	const d = {
		family: "user:search",
		params: { q: q.replace(/[A-Z]/g, (character) => character.toLowerCase()), limit },
		scope: "public",
	};
	return cacheGetOrSet(
		env,
		ctx,
		await userCacheKey(env, d),
		() => loadUserSearchFromDb(env, d.params.q, limit),
		{
			...d,
			tier: "SHORT",
			validator: (value): value is UserSearchResultItem[] => isUserCacheData(d, value),
		},
	);
}
export async function rebuildUserCache(
	env: Env,
	_ctx: ExecutionContext | undefined,
	d: CacheDescriptor,
): Promise<unknown> {
	validateUserCacheDescriptor(d);
	if (d.family === "user:public:v2")
		return loadUserPublicFromDb(env, Number(d.params.id), d.scope === "staff");
	if (d.family === "user:stats") return loadUserStatsFromDb(env, Number(d.params.id));
	if (d.family === "user:avatar-path") return loadAvatarPathFromDb(env, Number(d.params.id));
	if (d.family === "user:search")
		return loadUserSearchFromDb(env, String(d.params.q), Number(d.params.limit));
	return loadUserHistory(env, d);
}
