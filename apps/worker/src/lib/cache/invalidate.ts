// Cache invalidation primitives.
//
// Helpers grouped by domain (forum, user, …). Composite helpers like
// `invalidateForumStructureV2` bundle the gen bumps documented in
// docs/20 §5 for a given write category, so handlers call one named
// helper instead of re-listing keys at each callsite.
//
// All helpers are best-effort: KV write/delete failures are swallowed so
// they cannot block the underlying mutation. Correctness for missed
// invalidations falls back to TTL.

import type { Env } from "../env";
import { invalidateReadingConfig, invalidateReadingRecommendations } from "../reading-snapshots";
import { markStatisticsForums } from "../recent-activity";
import { userMiniCacheKey } from "../user-cache";
import { bumpGen } from "./epoch";
import {
	dataCacheKey,
	digestGenKey,
	forumTreeGenKey,
	pmUserGenKey,
	postAttachmentsGenKey,
	postEntityGenKey,
	postListGenKey,
	recommendedGenKey,
	statsReportsGenKey,
	threadListGenAllKey,
	threadListGenKey,
	threadMetaGenKey,
	userPublicKey,
} from "./keys";
import { cacheDelete } from "./wrap";

async function bumpResource(env: Env, key: string, family: string): Promise<string> {
	try {
		const value = await bumpGen(env, key);
		return value;
	} catch {
		console.warn(`[cache] invalidation failed family=${family}`);
		return "!unavailable";
	}
}

export function bumpPostEntityGen(env: Env, postId: number): Promise<string> {
	return bumpResource(env, postEntityGenKey(postId), "post:entity");
}

export function bumpPostAttachmentsGen(env: Env, postId: number): Promise<string> {
	return bumpResource(env, postAttachmentsGenKey(postId), "post:attachments");
}

export async function bumpRecommendedGen(env: Env, forumId: number): Promise<string> {
	const [generation] = await Promise.all([
		bumpResource(env, recommendedGenKey(forumId), "recommended:threads"),
		invalidateReadingRecommendations(env, forumId),
	]);
	return generation;
}

// ─── Single-key delete helpers ─────────────────────────────────────

/**
 * Delete the `user:mini:<id>` cache entry. Safe even when no value
 * exists.
 */
export async function deleteUserMini(env: Env, userId: number): Promise<void> {
	const key = userMiniCacheKey(userId);
	await cacheDelete(env, key, "user:mini:v1");
}

/**
 * Delete BOTH viewer-bucket variants of `user:public:v2:<id>` in parallel.
 * KV has no wildcard delete, so we enumerate the two known buckets every
 * time.
 */
export async function deleteUserPublicVariants(env: Env, userId: number): Promise<void> {
	await Promise.all(
		["public", "staff"].map((bucket) =>
			cacheDelete(env, userPublicKey(userId, bucket as "public" | "staff"), "user:public:v2"),
		),
	);
}

/**
 * Convenience: delete every per-user cache entry that depends on the given
 * userId (mini, public, self, counters and posting previews). Use for admin user CRUD / nuke /
 * purge / ban / batch-status / batch-role / batch-recalc-counters / single
 * recalcCounters / `me.updateProfile` (avatar) / email verify / admin
 * statistics recalc-users.
 */
export async function invalidateUserCaches(env: Env, userId: number): Promise<void> {
	await Promise.all([
		deleteUserMini(env, userId),
		deleteUserPublicVariants(env, userId),
		cacheDelete(env, `user:avatar-path:${userId}`, "user:avatar-path"),
		cacheDelete(env, `user:stats:${userId}`, "user:stats"),
		cacheDelete(env, `user:self:${userId}`, "user:self"),
		cacheDelete(env, `user:checkin:${userId}`, "user:checkin"),
		...["thread", "reply", "message"].map(async (action) =>
			cacheDelete(
				env,
				await dataCacheKey("user:posting-preview", { userId, action }, `user:${userId}`),
				"user:posting-preview",
			),
		),
	]);
}

// ─── Generation bump helpers (per docs/20 §5) ──────────────────────

export async function bumpForumTreeGen(env: Env): Promise<string> {
	const [generation] = await Promise.all([
		bumpResource(env, forumTreeGenKey(), "forum:tree:v2"),
		invalidateReadingConfig(env),
	]);
	return generation;
}

export async function bumpThreadListGen(env: Env, forumId: number): Promise<string> {
	const [generation] = await Promise.all([
		bumpResource(env, threadListGenKey(forumId), "thread:list"),
		markStatisticsForums(env, [forumId]),
	]);
	return generation;
}

/**
 * Bump the global thread-list generation `thread:list:gen:all`. Embedded
 * in every `thread:list` descriptor key, so a single
 * write here invalidates EVERY per-forum thread-list cache without
 * scanning per-forum gens.
 *
 * Used for global-announcement changes and explicit group invalidation.
 *
 * Per-forum mutations MUST use `bumpThreadListGen(env, forumId)` instead.
 * See docs/20 §5 for the mutation matrix.
 */
export async function bumpThreadListGenAll(env: Env): Promise<string> {
	return bumpResource(env, threadListGenAllKey(), "thread:list");
}

/**
 * Bump per-forum `thread:list:gen` for a set of forumIds in parallel.
 * Used by admin write paths that touch multiple forums in one operation
 * (batch move, nuke, batch delete) so the matrix is enforced in one call.
 * Empty input is a no-op.
 */
export async function invalidateThreadListForForums(
	env: Env,
	forumIds: readonly number[],
): Promise<void> {
	if (forumIds.length === 0) return;
	const unique = [...new Set(forumIds.filter((id) => Number.isSafeInteger(id) && id >= 0))];
	for (let start = 0; start < unique.length; start += 50) {
		await Promise.all(unique.slice(start, start + 50).map((id) => bumpThreadListGen(env, id)));
	}
}

export async function bumpThreadMetaGen(env: Env, threadId: number): Promise<string> {
	return bumpResource(env, threadMetaGenKey(threadId), "thread:entity");
}

export async function bumpPostListGen(env: Env, threadId: number): Promise<string> {
	return bumpResource(env, postListGenKey(threadId), "post:page");
}

/** Bound KV concurrency for bulk delete, restore, merge and user-content cleanup. */
export async function invalidateThreadReading(
	env: Env,
	threadIds: readonly number[],
	options: { posts?: boolean } = {},
): Promise<void> {
	const ids = [...new Set(threadIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
	for (let start = 0; start < ids.length; start += 50) {
		await Promise.all(
			ids.slice(start, start + 50).map(async (id) => {
				await bumpThreadMetaGen(env, id);
				if (options.posts) await bumpPostListGen(env, id);
			}),
		);
	}
}

export async function bumpDigestGen(env: Env): Promise<string> {
	return bumpResource(env, digestGenKey(), "digest:list");
}

// ─── Composite domain helpers ──────────────────────────────────────
//
// These bundle the bumps documented in docs/20 §5 for the most common
// write categories. Handlers call a single helper instead of re-listing
// the gen keys, so the matrix is enforced in code rather than per-call.

/** Bump the per-forum thread-list generation after a confirmed edit or delete. */
export async function invalidateForumVolatileV2(env: Env, forumId: number): Promise<void> {
	await bumpThreadListGen(env, forumId);
}

/**
 * Bump every gen affected by a forum create / delete / merge: the
 * structural tree and the digest
 * gen because the set of forums visible to digest filters changes when
 * a forum is added or removed. For `update`, callers must use
 * `invalidateForumUpdateV2` which decides per-field whether digest is
 * affected. For `reorder`, use `invalidateForumReorderV2` (tree, NOT digest).
 */
export async function invalidateForumStructureV2(env: Env): Promise<void> {
	await Promise.all([bumpForumTreeGen(env), bumpDigestGen(env)]);
}

/**
 * Bump tree, and conditionally digest, for a forum update.
 * Digest gen is bumped only when one of the digest-filter-affecting
 * fields changed: `name`, `status`, `visibility`, `parent_id`, `type`.
 * Other field changes (description, icon, moderators, display_order…)
 * do not change which threads digest queries can see, so we leave
 * digest gen alone to avoid invalidating unrelated digest caches.
 */
export async function invalidateForumUpdateV2(
	env: Env,
	changes: { affectsDigest: boolean },
): Promise<void> {
	const ops: Promise<unknown>[] = [bumpForumTreeGen(env)];
	if (changes.affectsDigest) ops.push(bumpDigestGen(env));
	await Promise.all(ops);
}

/**
 * Snake-case `forums` columns whose change affects digest filter
 * visibility. Single source of truth shared by:
 *   - `admin/forum.ts` afterUpdate (deciding whether to bump digest gen)
 *   - any future caller that needs to know which forum updates flip
 *     digest visibility.
 *
 * Other columns (description, icon, moderators, display_order…) are
 * deliberately excluded — see docs/20 §5 for the mutation matrix.
 */
export const FORUM_DIGEST_AFFECTING_COLUMNS = [
	"name",
	"status",
	"visibility",
	"parent_id",
	"type",
] as const;

/**
 * Returns true when at least one of `FORUM_DIGEST_AFFECTING_COLUMNS` is
 * present in the update payload (snake-case, as collected by
 * `validateAndCollectFields`).
 */
export function affectsForumDigest(data: Record<string, unknown>): boolean {
	for (const col of FORUM_DIGEST_AFFECTING_COLUMNS) {
		if (data[col] !== undefined) return true;
	}
	return false;
}

/**
 * Bump tree for a `display_order` reorder. Digest filters are
 * untouched by reorder so we deliberately do NOT bump digest gen.
 */
export async function invalidateForumReorderV2(env: Env): Promise<void> {
	await bumpForumTreeGen(env);
}

export async function invalidateMessageUsers(env: Env, userIds: readonly number[]): Promise<void> {
	const ids = [...new Set(userIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
	for (let start = 0; start < ids.length; start += 50)
		await Promise.all(
			ids.slice(start, start + 50).map((id) => bumpResource(env, pmUserGenKey(id), "pm:list")),
		);
}
export function invalidateStatisticsReports(env: Env): Promise<string> {
	return bumpResource(env, statsReportsGenKey(), "admin:analytics");
}
