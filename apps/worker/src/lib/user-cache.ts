// User mini profile KV cache operations
// Used for batch-fetching user info (username, avatar, role, group info) by ID
// Implements the caching strategy from docs/09-user-cache-refactor.md

import {
	flushPendingNow,
	recordDelete,
	recordError,
	recordHit,
	recordMiss,
	recordRead,
	recordWrite,
	scheduleMetricsFlush,
} from "./cache/metrics";
import type { Env } from "./env";

const USER_CACHE_PREFIX = "user:mini:";
const USER_CACHE_TTL = 86400; // 24h
const METRICS_FAMILY = "user:mini:v1";

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
		uniqueIds.map(async (id) => {
			recordRead(METRICS_FAMILY);
			try {
				const data = await env.KV.get<UserMiniProfile>(`${USER_CACHE_PREFIX}${id}`, "json");
				return { id, data, error: false };
			} catch (err) {
				console.warn(`[user-cache] read failed id=${id}`, err);
				return { id, data: null as UserMiniProfile | null, error: true };
			}
		}),
	);

	// Separate hits and misses, recording per-key metrics so the admin
	// monitor sees real hit/miss ratios for the user:mini:v1 family.
	const missedIds: number[] = [];
	for (const { id, data, error } of cacheResults) {
		if (error) {
			recordError(METRICS_FAMILY);
			missedIds.push(id);
		} else if (data) {
			recordHit(METRICS_FAMILY);
			result.set(id, data);
		} else {
			recordMiss(METRICS_FAMILY);
			missedIds.push(id);
		}
	}

	// DB fallback for cache misses (batched for SQLite 999 variable limit)
	if (missedIds.length > 0) {
		const BATCH_SIZE = 500;
		for (let i = 0; i < missedIds.length; i += BATCH_SIZE) {
			const batch = missedIds.slice(i, i + BATCH_SIZE);
			const placeholders = batch.map(() => "?").join(",");
			const dbResult = await env.DB.prepare(
				`SELECT id, username, avatar, avatar_path, role, group_title, group_color, group_stars
       FROM users WHERE id IN (${placeholders})`,
			)
				.bind(...batch)
				.all();

			for (const row of dbResult.results) {
				const profile: UserMiniProfile = {
					id: row.id as number,
					username: row.username as string,
					avatar: row.avatar as string,
					avatarPath: (row.avatar_path as string) ?? "",
					role: row.role as number,
					groupTitle: row.group_title as string,
					groupColor: row.group_color as string,
					groupStars: row.group_stars as number,
				};
				result.set(profile.id, profile);

				// Non-blocking cache population. Flush from inside the
				// put chain so the `write` op recorded after the
				// outer scheduleMetricsFlush has already swapped is
				// still persisted within this request's waitUntil.
				ctx.waitUntil(
					env.KV.put(`${USER_CACHE_PREFIX}${profile.id}`, JSON.stringify(profile), {
						expirationTtl: USER_CACHE_TTL,
					})
						.then(() => {
							recordWrite(METRICS_FAMILY);
						})
						.catch((err) => {
							recordError(METRICS_FAMILY);
							console.warn(`[user-cache] write-back failed id=${profile.id}`, err);
						})
						.finally(() => {
							flushPendingNow(env, ctx);
						}),
				);
			}
		}
	}

	scheduleMetricsFlush(env, ctx);
	return result;
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
	recordDelete(METRICS_FAMILY);
}
