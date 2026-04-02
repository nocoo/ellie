// User mini profile KV cache operations
// Used for batch-fetching user info (username, avatar, role, group info) by ID
// Implements the caching strategy from docs/09-user-cache-refactor.md

import type { Env } from "./env";

const USER_CACHE_PREFIX = "user:mini:";
const USER_CACHE_TTL = 86400; // 24h

/**
 * Mini user profile cached in KV.
 * Contains only fields needed for display in lists (forums, threads, posts).
 */
export interface UserMiniProfile {
	id: number;
	username: string;
	avatar: string;
	role: number;
	groupTitle: string;
	groupColor: string;
	groupStars: number;
}

/**
 * Batch get user profiles from KV cache, with DB fallback for cache misses.
 * Uses ctx.waitUntil for non-blocking cache population.
 *
 * @param env - Worker environment
 * @param ctx - ExecutionContext for non-blocking KV writes
 * @param userIds - Array of user IDs to fetch
 * @returns Map of userId -> UserMiniProfile
 */
export async function getUserProfiles(
	env: Env,
	ctx: ExecutionContext,
	userIds: number[],
): Promise<Map<number, UserMiniProfile>> {
	const result = new Map<number, UserMiniProfile>();
	if (userIds.length === 0) return result;

	// Deduplicate and filter invalid IDs
	const uniqueIds = [...new Set(userIds)].filter((id) => id > 0);
	if (uniqueIds.length === 0) return result;

	// Parallel KV reads
	const cacheResults = await Promise.all(
		uniqueIds.map(async (id) => ({
			id,
			data: await env.KV.get<UserMiniProfile>(`${USER_CACHE_PREFIX}${id}`, "json"),
		})),
	);

	// Separate hits and misses
	const missedIds: number[] = [];
	for (const { id, data } of cacheResults) {
		if (data) {
			result.set(id, data);
		} else {
			missedIds.push(id);
		}
	}

	// DB fallback for cache misses
	if (missedIds.length > 0) {
		const placeholders = missedIds.map(() => "?").join(",");
		const dbResult = await env.DB.prepare(
			`SELECT id, username, avatar, role, group_title, group_color, group_stars
       FROM users WHERE id IN (${placeholders})`,
		)
			.bind(...missedIds)
			.all();

		for (const row of dbResult.results) {
			const profile: UserMiniProfile = {
				id: row.id as number,
				username: row.username as string,
				avatar: row.avatar as string,
				role: row.role as number,
				groupTitle: row.group_title as string,
				groupColor: row.group_color as string,
				groupStars: row.group_stars as number,
			};
			result.set(profile.id, profile);

			// Non-blocking cache population
			ctx.waitUntil(
				env.KV.put(`${USER_CACHE_PREFIX}${profile.id}`, JSON.stringify(profile), {
					expirationTtl: USER_CACHE_TTL,
				}),
			);
		}
	}

	return result;
}

/**
 * Get a single user profile from KV cache with DB fallback.
 * Convenience wrapper around getUserProfiles for single user lookups.
 *
 * @param env - Worker environment
 * @param ctx - ExecutionContext for non-blocking KV writes
 * @param userId - User ID to fetch
 * @returns UserMiniProfile or undefined if not found
 */
export async function getUserProfile(
	env: Env,
	ctx: ExecutionContext,
	userId: number,
): Promise<UserMiniProfile | undefined> {
	const profiles = await getUserProfiles(env, ctx, [userId]);
	return profiles.get(userId);
}

/**
 * Invalidate user cache when profile changes.
 * Call this after admin updates username, avatar, or role.
 *
 * @param env - Worker environment
 * @param userId - User ID whose cache to invalidate
 */
export async function invalidateUserCache(env: Env, userId: number): Promise<void> {
	await env.KV.delete(`${USER_CACHE_PREFIX}${userId}`);
}

/**
 * Batch invalidate user caches.
 *
 * @param env - Worker environment
 * @param userIds - Array of user IDs whose caches to invalidate
 */
export async function invalidateUserCaches(env: Env, userIds: number[]): Promise<void> {
	await Promise.all(userIds.map((id) => env.KV.delete(`${USER_CACHE_PREFIX}${id}`)));
}
