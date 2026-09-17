// apps/worker/src/lib/user-cache.ts
// User mini profile KV cache operations
// Used for batch-fetching user info (username, avatar, role, group info) by ID
// Conforms to docs/20-worker-kv-reference.md: unified envelope caching with LONG tier,
// core cacheReadMany/cacheGetOrSet/cacheDelete integration, batched missing entity loads <= 80 params.

import { CACHE_TTL_SECONDS } from "@ellie/types";
import { cacheDelete, cacheGetOrSet, cacheReadMany } from "./cache/wrap";
import type { Env } from "./env";

export const USER_CACHE_PREFIX = "user:mini:";
export const USER_CACHE_TTL = CACHE_TTL_SECONDS.LONG; // 24h
export const USER_CACHE_FAMILY = "user:mini:v1";
export const USER_CACHE_TIER = "LONG" as const;
export const USER_CACHE_SCOPE = "public";

const BATCH_SIZE = 80; // Kept under D1 parameter budget of 100

/**
 * Mini user profile cached in KV.
 * Contains only fields needed for display in lists (forums, threads, posts).
 */
export interface UserMiniProfile {
	id: number;
	username: string;
	avatar: string;
	avatarPath: string;
	role: number;
	groupTitle: string;
	groupColor: string;
	groupStars: number;
}

export function userMiniCacheKey(id: number): string {
	return `${USER_CACHE_PREFIX}${id}`;
}

export function isUserMiniProfile(value: unknown): value is UserMiniProfile {
	if (typeof value !== "object" || value === null) return false;
	const p = value as Partial<UserMiniProfile>;
	return (
		Object.keys(value).sort().join(",") ===
			"avatar,avatarPath,groupColor,groupStars,groupTitle,id,role,username" &&
		Number.isSafeInteger(p.id) &&
		Number(p.id) > 0 &&
		typeof p.username === "string" &&
		typeof p.avatar === "string" &&
		typeof p.avatarPath === "string" &&
		Number.isSafeInteger(p.role) &&
		typeof p.groupTitle === "string" &&
		typeof p.groupColor === "string" &&
		Number.isFinite(p.groupStars)
	);
}

/**
 * Authoritative batch loader for user mini profiles directly from D1.
 * Omit non-existent or deleted users from map.
 */
export async function loadUserMiniProfilesFromDb(
	env: Env,
	userIds: number[],
): Promise<Map<number, UserMiniProfile>> {
	const map = new Map<number, UserMiniProfile>();
	const uniqueIds = [...new Set(userIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
	if (uniqueIds.length === 0) return map;

	for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
		const batch = uniqueIds.slice(i, i + BATCH_SIZE);
		const placeholders = batch.map(() => "?").join(",");
		const dbResult = await env.DB.prepare(
			`SELECT id, username, avatar, avatar_path, role, group_title, group_color, group_stars
			 FROM users WHERE id IN (${placeholders})`,
		)
			.bind(...batch)
			.all();
		if (!dbResult.success) throw new Error("User profiles could not be loaded");

		for (const row of dbResult.results) {
			const profile: UserMiniProfile = {
				id: row.id as number,
				username: row.username as string,
				avatar: (row.avatar as string) ?? "",
				avatarPath: (row.avatar_path as string) ?? "",
				role: row.role as number,
				groupTitle: (row.group_title as string) ?? "",
				groupColor: (row.group_color as string) ?? "",
				groupStars: (row.group_stars as number) ?? 0,
			};
			map.set(profile.id, profile);
		}
	}
	return map;
}

/**
 * Batch get user profiles from KV cache, with DB fallback for cache misses.
 * Fully integrates with core cacheReadMany and cacheGetOrSet using schema v3 envelopes.
 *
 * @param env - Worker environment
 * @param ctx - ExecutionContext for background writes (optional)
 * @param userIds - Array of user IDs to fetch
 * @returns Map of userId -> UserMiniProfile
 */
export async function getUserProfiles(
	env: Env,
	ctx: ExecutionContext | undefined,
	userIds: number[],
): Promise<Map<number, UserMiniProfile>> {
	const result = new Map<number, UserMiniProfile>();
	if (userIds.length === 0) return result;

	// Deduplicate and filter invalid IDs
	const uniqueIds = [...new Set(userIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
	if (uniqueIds.length === 0) return result;

	const idToKey = (id: number) => userMiniCacheKey(id);
	const keyToId = (key: string) => Number(key.slice(USER_CACHE_PREFIX.length));

	const keys = uniqueIds.map(idToKey);

	// Core bulk KV read with unified CacheGetOrSetOptions resolver
	const cached = await cacheReadMany<UserMiniProfile | null>(env, keys, (key) => {
		const id = keyToId(key);
		return {
			family: USER_CACHE_FAMILY,
			tier: USER_CACHE_TIER,
			params: { id },
			scope: USER_CACHE_SCOPE,
			validator: (value): value is UserMiniProfile | null =>
				value === null || (isUserMiniProfile(value) && value.id === id),
		};
	});

	// Populate results from cache
	const missedIds: number[] = [];
	for (const id of uniqueIds) {
		const key = idToKey(id);
		const profile = cached.get(key);
		if (cached.has(key)) {
			if (profile) result.set(id, profile);
		} else {
			missedIds.push(id);
		}
	}

	// DB fallback for cache misses: batched query <= 80 params
	if (missedIds.length > 0) {
		let dbLoading: Promise<Map<number, UserMiniProfile>> | undefined;

		for (let offset = 0; offset < missedIds.length; offset += BATCH_SIZE) {
			await Promise.all(
				missedIds.slice(offset, offset + BATCH_SIZE).map(async (id) => {
					const key = idToKey(id);
					const profile = await cacheGetOrSet<UserMiniProfile | null>(
						env,
						ctx,
						key,
						async () => {
							dbLoading ??= loadUserMiniProfilesFromDb(env, missedIds);
							const loadedMap = await dbLoading;
							return loadedMap.get(id) ?? null;
						},
						{
							family: USER_CACHE_FAMILY,
							tier: USER_CACHE_TIER,
							params: { id },
							scope: USER_CACHE_SCOPE,
							validator: (v): v is UserMiniProfile | null =>
								v === null || (isUserMiniProfile(v) && v.id === id),
						},
					);
					if (profile) {
						result.set(id, profile);
					}
				}),
			);
		}
	}

	return result;
}

/**
 * Invalidate user cache when profile changes via core cacheDelete.
 * Call this after admin updates username, avatar, or role.
 *
 * @param env - Worker environment
 * @param userId - User ID whose cache to invalidate
 * @param options - strict throws on error
 */
export async function invalidateUserCache(
	env: Env,
	userId: number,
	options: { strict?: boolean } = {},
): Promise<void> {
	const key = userMiniCacheKey(userId);
	const ok = await cacheDelete(env, key, USER_CACHE_FAMILY);
	if (!ok && options.strict) {
		throw new Error(`Failed to invalidate cache key ${key}`);
	}
}
