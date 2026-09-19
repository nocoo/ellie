import type { CacheDescriptor } from "@ellie/types";
import {
	type EntityConfig,
	type FilterDef,
	loadEntityCount,
	loadEntityDetail,
	loadEntityList,
} from "../crud";
import type { Env } from "../env";
import { bumpGen, getGen } from "./epoch";
import { adminEntityGenKey, dataCacheKey } from "./keys";
import { cacheGetOrSet, cacheReadMany } from "./wrap";

const imports = {
	forums: () => import("../../handlers/admin/forum"),
	threads: () => import("../../handlers/admin/thread"),
	posts: () => import("../../handlers/admin/post"),
	attachments: () => import("../../handlers/admin/attachment"),
	users: () => import("../../handlers/admin/user"),
	censor_words: () => import("../../handlers/admin/censorWord"),
	ip_bans: () => import("../../handlers/admin/ipBan"),
	admin_logs: () => import("../../handlers/admin/adminLog"),
	announcements: () => import("../../handlers/admin/announcement"),
};
// These are immutable application configs, never request/user closures.
const configs = new Map<string, EntityConfig>();

export function registerAdminEntity(config: EntityConfig): boolean {
	if (!Object.hasOwn(imports, config.table)) return false;
	configs.set(config.table, config);
	return true;
}

async function configuration(entity: unknown): Promise<EntityConfig> {
	if (typeof entity !== "string" || !Object.hasOwn(imports, entity))
		throw new TypeError("Unknown admin entity");
	if (!configs.has(entity)) await imports[entity as keyof typeof imports]();
	const config = configs.get(entity);
	if (!config) throw new TypeError("Admin entity reader is not registered");
	return config;
}

type FieldValidator = (value: unknown) => boolean;

function isRecord(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
	typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const isCount = (value: unknown): value is number =>
	Number.isSafeInteger(value) && Number(value) >= 0;
const nullableNumber = (value: unknown) => value === null || isNumber(value);
const nullableString = (value: unknown) => value === null || isString(value);

function fields(names: string, validator: FieldValidator): Record<string, FieldValidator> {
	return Object.fromEntries(names.split(" ").map((name) => [name, validator]));
}

/** Require the complete loader projection, with no additional or untyped fields. */
function shape(rules: Record<string, FieldValidator>) {
	const names = Object.keys(rules);
	return (value: unknown): value is Record<string, unknown> =>
		isRecord(value) &&
		Object.keys(value).length === names.length &&
		names.every((name) => Object.hasOwn(value, name) && rules[name](value[name]));
}

function entityArray(
	value: unknown,
	validator: FieldValidator,
): value is Record<string, unknown>[] {
	if (!Array.isArray(value)) return false;
	const ids = new Set<unknown>();
	for (const row of value) {
		if (!isRecord(row) || !validator(row) || ids.has(row.id)) return false;
		ids.add(row.id);
	}
	return true;
}

const threadTypeConfig = shape(fields("enabled required listable prefix", isBoolean));
const moderator = shape({ id: isId, name: isString });
const checkinLevel = shape({ ...fields("minDays level", isNumber), label: isString });
const checkinSummary = shape({
	...fields("totalDays monthDays streakDays lastCheckinAt", isNumber),
	level: (value) => value === null || checkinLevel(value),
});
const ratingDimension = shape({ count: isCount, sum: isNumber });
const ratingAggregate = shape({ total: isCount, credits: ratingDimension, coins: ratingDimension });

// These are the actual Admin mapper projections. Joined latest-thread/post
// columns can be null; settings JSON remains a raw string in SettingEntry.
// Online user overlays are added by the handler and never belong in this cache.
const userFields = {
	id: isId,
	...fields(
		"username email avatar avatarPath signature groupTitle groupColor customTitle resideProvince resideCity graduateSchool bio interest qq site campus emailNormalized regIp lastIp",
		isString,
	),
	...fields(
		"status role regDate lastLogin threads posts credits coins groupStars digestPosts olTime gender birthYear birthMonth birthDay lastActivity emailVerifiedAt emailChangedAt purgedAt purgedBy",
		isNumber,
	),
	hasAvatar: isBoolean,
	checkin: (value: unknown) => value === null || checkinSummary(value),
};
const userListRow = shape(userFields);
const entityValidators: Record<keyof typeof imports, FieldValidator> = {
	users: shape(userFields),
	forums: shape({
		// Historical imports retain a deleted-forum placeholder at id 0.
		id: (value) => value === 0 || isId(value),
		...fields("parentId displayOrder threads posts status todayThreads lastPosterId", isNumber),
		...fields(
			"name description announcement icon type visibility moderators lastPosterAvatar lastPosterAvatarPath",
			isString,
		),
		...fields("lastThreadId lastPostAt", nullableNumber),
		...fields("lastPoster lastThreadSubject", nullableString),
		moderatorList: (value) => entityArray(value, moderator),
		threadTypes: threadTypeConfig,
	}),
	threads: shape({
		id: isId,
		...fields(
			"forumId authorId createdAt lastPosterId replies views closed sticky digest special highlight recommends anonymousAuthor anonymousLastPoster",
			isNumber,
		),
		...fields(
			"authorName authorAvatar authorAvatarPath subject lastPosterAvatar lastPosterAvatarPath typeName",
			isString,
		),
		lastPostAt: nullableNumber,
		lastPoster: nullableString,
		...fields("isAuthorFirstThread isRecommended", isBoolean),
	}),
	posts: shape({
		id: isId,
		...fields("threadId forumId authorId createdAt position anonymous", isNumber),
		...fields("authorName content", isString),
		isFirst: isBoolean,
		ratingAggregate,
	}),
	attachments: shape({
		id: isId,
		...fields("threadId postId authorId fileSize width downloads createdAt", isNumber),
		...fields("filename filePath", isString),
		...fields("isImage hasThumb", isBoolean),
	}),
	ip_bans: shape({
		id: isId,
		...fields("adminId createdAt", isNumber),
		...fields("ip adminName reason", isString),
		expiresAt: nullableNumber,
	}),
	censor_words: shape({
		id: isId,
		...fields("adminId createdAt", isNumber),
		...fields("find replacement adminName", isString),
		action: (value) => value === "ban" || value === "replace",
	}),
	admin_logs: shape({
		id: isId,
		...fields("adminId createdAt", isNumber),
		...fields("adminName action targetType details ip", isString),
		targetId: nullableNumber,
	}),
	announcements: shape({
		id: isId,
		...fields("sticky status authorId createdAt updatedAt", isNumber),
		...fields("title content forumIds authorName", isString),
		...fields("startAt endAt", nullableNumber),
	}),
};
const settingEntry = shape({
	value: isString,
	type: (value) =>
		value === "string" || value === "number" || value === "boolean" || value === "json",
	updatedAt: isNumber,
});
const threadType = shape({
	id: isId,
	forumId: isId,
	...fields("sourceTypeid displayOrder", isNumber),
	...fields("name icon", isString),
	...fields("enabled moderatorOnly", isBoolean),
});
const threadTypeList = shape({
	forumId: isId,
	config: threadTypeConfig,
	types: (value) => entityArray(value, threadType),
});
const listShape = shape({
	items: Array.isArray,
	total: isCount,
	page: isId,
	limit: isId,
	paginated: isBoolean,
});

function normalizedFilterValue(filter: FilterDef, raw: string): string | undefined {
	if (filter.type === "range" || filter.parse === "int" || filter.parse === "float") {
		const value = filter.parse === "float" ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
		return Number.isFinite(value) ? String(value) : undefined;
	}
	if (filter.parse === "boolean" || filter.type === "positive" || filter.type === "expr") {
		if (raw === "true" || raw === "1") return "1";
		if (raw === "false" || raw === "0") return "0";
		return undefined;
	}
	return raw;
}

function adminFilterValues(filters: readonly FilterDef[], input: URLSearchParams) {
	const values: Record<string, string> = {};
	for (const filter of filters) {
		const names =
			filter.type === "range"
				? [filter.minParam ?? `${filter.param}Min`, filter.maxParam ?? `${filter.param}Max`]
				: [filter.param];
		for (const name of names) {
			const raw = input.get(name);
			if (raw === null || raw === "") continue;
			const value = normalizedFilterValue(filter, raw);
			if (value !== undefined) values[name] = value;
		}
	}
	return values;
}

/** Only query dimensions understood by the existing CRUD filter declarations. */
export function adminListQuery(config: EntityConfig, input: URLSearchParams): string {
	const values: Record<string, string> = {};
	if (config.listPaginated !== false) {
		const page = Number.parseInt(input.get("page") ?? "1", 10);
		const rawLimit = Number.parseInt(input.get("limit") ?? "20", 10);
		if (!Number.isSafeInteger(page) || page < 1 || !Number.isFinite(rawLimit))
			throw new RangeError("Invalid pagination");
		values.page = String(page);
		values.limit = String(Math.min(Math.max(rawLimit, 1), 100));
	}
	const sort = input.get("sort");
	if (sort && Object.hasOwn(config.allowedSorts ?? {}, sort)) values.sort = sort;
	Object.assign(values, adminFilterValues(config.filters ?? [], input));
	if (config.table === "announcements") {
		if (["true", "1"].includes(input.get("active") ?? "")) values.active = "1";
		const forumId = Number.parseInt(input.get("forumId") ?? "", 10);
		if (Number.isSafeInteger(forumId) && forumId > 0) values.forumId = String(forumId);
	}
	return new URLSearchParams(
		Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
	).toString();
}

/** Count identity excludes pagination and sorting, sharing totals across all pages. */
export function adminCountQuery(config: EntityConfig, input: URLSearchParams): string {
	const values = new URLSearchParams(adminListQuery(config, input));
	for (const field of ["page", "limit", "sort"]) values.delete(field);
	return values.toString();
}

function validateParameters(
	descriptor: CacheDescriptor,
	config: EntityConfig | null,
	allowLongQuery = false,
): void {
	if (!isRecord(descriptor) || descriptor.scope !== "admin")
		throw new TypeError("Admin scope is required");
	if (!isRecord(descriptor.params)) throw new TypeError("Invalid admin parameters");
	if (["admin:settings", "admin:users:staff", "admin:thread-types"].includes(descriptor.family)) {
		const fields = Object.keys(descriptor.params).sort().join(",");
		if (
			descriptor.family === "admin:thread-types"
				? fields !== "forumId" || !isId(descriptor.params.forumId)
				: fields !== ""
		)
			throw new TypeError("Invalid admin display parameters");
		return;
	}
	if (
		typeof descriptor.params.entity !== "string" ||
		!Object.hasOwn(imports, descriptor.params.entity)
	)
		throw new TypeError("Unknown admin entity");
	const fields = Object.keys(descriptor.params).sort().join(",");
	if (["admin:entity:list", "admin:entity:count"].includes(descriptor.family)) {
		if (
			!config ||
			config.table !== descriptor.params.entity ||
			fields !== "entity,query" ||
			typeof descriptor.params.query !== "string" ||
			(!allowLongQuery && descriptor.params.query.length > 4096) ||
			(descriptor.family === "admin:entity:count" ? adminCountQuery : adminListQuery)(
				config,
				new URLSearchParams(descriptor.params.query),
			) !== descriptor.params.query
		) {
			throw new TypeError("Invalid admin list parameters");
		}
	} else if (descriptor.family === "admin:entity:detail") {
		if (fields !== "entity,id" || !isId(descriptor.params.id))
			throw new TypeError("Invalid admin entity ID");
	} else throw new TypeError("Unknown admin entity family");
}

async function validate(
	descriptor: CacheDescriptor,
	allowLongQuery = false,
): Promise<EntityConfig | null> {
	const config =
		descriptor?.scope === "admin" &&
		["admin:entity:list", "admin:entity:count", "admin:entity:detail"].includes(descriptor.family)
			? await configuration(descriptor.params?.entity)
			: null;
	validateParameters(descriptor, config, allowLongQuery);
	return config;
}

function adminDescriptorResource(descriptor: CacheDescriptor): string {
	if (descriptor.family === "admin:users:staff") return "users";
	if (descriptor.family === "admin:settings") return "settings";
	if (descriptor.family === "admin:thread-types") return "forum_thread_types";
	return String(descriptor.params?.entity ?? "");
}

export async function adminEntityCacheKey(env: Env, descriptor: CacheDescriptor): Promise<string> {
	await validate(descriptor);
	const resource = adminDescriptorResource(descriptor);
	const gen = resource ? await getGen(env, adminEntityGenKey(resource)) : "0";
	return dataCacheKey(
		descriptor.family,
		descriptor.params,
		descriptor.scope,
		resource ? { [adminEntityGenKey(resource)]: gen } : {},
	);
}

const INVALIDATABLE_RESOURCES = new Set<string>([
	...Object.keys(imports),
	"settings",
	"forum_thread_types",
]);

export async function invalidateAdminEntityCache(env: Env, resource: string): Promise<void> {
	if (!resource || typeof resource !== "string" || !INVALIDATABLE_RESOURCES.has(resource)) return;
	try {
		await bumpGen(env, adminEntityGenKey(resource));
	} catch {
		// KV-only best-effort invalidation
	}
}

async function loadAdminEntity(
	env: Env,
	descriptor: CacheDescriptor,
	config: EntityConfig | null,
): Promise<unknown> {
	if (descriptor.family === "admin:entity:list" && config?.table === "announcements")
		return (await import("../../handlers/admin/announcement")).loadAdminAnnouncements(
			env,
			String(descriptor.params.query),
		);
	if (descriptor.family === "admin:settings")
		return (await import("../../handlers/admin/settings")).loadAdminSettings(env);
	if (descriptor.family === "admin:thread-types")
		return (await import("../../handlers/admin/forumThreadType")).loadAdminThreadTypes(
			env,
			Number(descriptor.params.forumId),
		);
	if (descriptor.family === "admin:users:staff") {
		const users = await configuration("users");
		const rows = await env.DB.prepare(
			`SELECT ${users.columns} FROM users WHERE role > 0 ORDER BY role ASC, username ASC`,
		).all<Record<string, unknown>>();
		if (!rows.success) throw new Error("Admin staff could not be loaded");
		return rows.results.map(users.mapper);
	}
	if (!config) throw new TypeError("Admin entity reader is not registered");
	if (descriptor.family === "admin:entity:count")
		return loadEntityCount(config, env, String(descriptor.params.query));
	return descriptor.family === "admin:entity:list"
		? loadEntityList(config, env, String(descriptor.params.query))
		: loadEntityDetail(config, env, Number(descriptor.params.id));
}

export async function rebuildAdminEntityCache(
	env: Env,
	_ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
): Promise<unknown> {
	return loadAdminEntity(env, descriptor, await validate(descriptor));
}

function isAdminEntityData(d: CacheDescriptor, value: unknown, allowLongQuery = false): boolean {
	const config = configs.get(String(d?.params?.entity)) ?? null;
	try {
		validateParameters(d, config, allowLongQuery);
	} catch {
		return false;
	}
	if (d.family === "admin:entity:count") return isCount(value);
	if (value === null)
		return d.family === "admin:entity:detail" || d.family === "admin:thread-types";
	if (d.family === "admin:users:staff")
		return entityArray(value, entityValidators.users) && value.every((row) => Number(row.role) > 0);
	if (!isRecord(value)) return false;
	if (d.family === "admin:settings") return Object.values(value).every(settingEntry);
	if (d.family === "admin:thread-types")
		return (
			threadTypeList(value) &&
			value.forumId === d.params.forumId &&
			Array.isArray(value.types) &&
			value.types.every((row) => row.forumId === d.params.forumId)
		);
	const safeEntity = entityValidators[d.params.entity as keyof typeof imports];
	if (d.family === "admin:entity:detail") return safeEntity(value) && value.id === d.params.id;
	return (
		!!config && validListData(d, value, config, config.table === "users" ? userListRow : safeEntity)
	);
}

export function isAdminEntityCacheData(d: CacheDescriptor, value: unknown): boolean {
	return isAdminEntityData(d, value);
}

function validListData(
	d: CacheDescriptor,
	row: Record<string, unknown>,
	config: EntityConfig,
	safeEntity: FieldValidator,
): boolean {
	if (!listShape(row) || !entityArray(row.items, safeEntity)) return false;
	const query = new URLSearchParams(String(d.params.query));
	const paginated = config.listPaginated !== false;
	const page = Number(query.get("page") ?? 1);
	const limit = Number(query.get("limit") ?? 20);
	return (
		row.paginated === paginated &&
		row.page === page &&
		row.limit === limit &&
		(paginated ? row.items.length <= limit : row.total === row.items.length)
	);
}

export async function readAdminEntity<T>(
	env: Env,
	ctx: ExecutionContext | undefined,
	descriptor: CacheDescriptor,
	loader?: () => Promise<T>,
): Promise<T> {
	const longQuery =
		["admin:entity:list", "admin:entity:count"].includes(descriptor.family) &&
		typeof descriptor.params.query === "string" &&
		descriptor.params.query.length > 4096;
	const config = longQuery ? await validate(descriptor, true) : null;
	const key = longQuery
		? `${await dataCacheKey(descriptor.family, descriptor.params, descriptor.scope)}:!unavailable`
		: await adminEntityCacheKey(env, descriptor);
	return cacheGetOrSet(
		env,
		ctx,
		key,
		loader ??
			(() =>
				(longQuery
					? loadAdminEntity(env, descriptor, config)
					: rebuildAdminEntityCache(env, ctx, descriptor)) as Promise<T>),
		{
			...descriptor,
			tier: descriptor.family === "admin:entity:count" ? "HOUR" : "SHORT",
			source: "admin",
			validator: (value): value is T => isAdminEntityData(descriptor, value, longQuery),
		},
	);
}

/** Batch callers share the exact detail entries, loading only missing IDs. */
export async function getAdminEntities<T>(
	env: Env,
	ctx: ExecutionContext | undefined,
	entity: string,
	ids: readonly number[],
): Promise<Map<number, T>> {
	const config = await configuration(entity);
	const entries = await Promise.all(
		[...new Set(ids)].map(async (id) => {
			const d = { family: "admin:entity:detail", params: { entity, id }, scope: "admin" };
			return { id, d, key: await adminEntityCacheKey(env, d) };
		}),
	);
	const options = new Map(
		entries.map((entry) => [
			entry.key,
			{
				...entry.d,
				tier: "SHORT" as const,
				source: "admin" as const,
				validator: (value: unknown): value is T | null => isAdminEntityCacheData(entry.d, value),
			},
		]),
	);
	const optionsForKey = (key: string) => {
		const option = options.get(key);
		if (!option) throw new TypeError("Missing admin entity cache options");
		return option;
	};
	const hits = await cacheReadMany<T | null>(
		env,
		entries.map((entry) => entry.key),
		optionsForKey,
	);
	const misses = entries.filter((entry) => !hits.has(entry.key));
	let task: Promise<Map<number, T>> | undefined;
	const load = async () => {
		const result = new Map<number, T>();
		for (let offset = 0; offset < misses.length; offset += 100) {
			const part = misses.slice(offset, offset + 100);
			const rows = await env.DB.prepare(
				`SELECT ${config.columns} FROM ${config.table} WHERE id IN (${part.map(() => "?").join(",")})`,
			)
				.bind(...part.map((entry) => entry.id))
				.all<Record<string, unknown>>();
			if (!rows.success) throw new Error("Admin entities could not be loaded");
			for (const row of rows.results) result.set(Number(row.id), config.mapper(row) as T);
		}
		return result;
	};
	for (let offset = 0; offset < misses.length; offset += 100) {
		await Promise.all(
			misses.slice(offset, offset + 100).map(async (entry) => {
				const value = await cacheGetOrSet(
					env,
					ctx,
					entry.key,
					async () => {
						task ??= load();
						return (await task).get(entry.id) ?? null;
					},
					optionsForKey(entry.key),
				);
				hits.set(entry.key, value);
			}),
		);
	}
	return new Map(
		entries.flatMap((entry) => {
			const value = hits.get(entry.key);
			return value == null ? [] : [[entry.id, value] as const];
		}),
	);
}
