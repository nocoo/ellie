// Cache invalidation primitives.
//
// Phase 1 only ships small, primitive helpers. Domain-grouped invalidators
// for thread / post / digest are deliberately NOT wired into business
// handlers in this commit — they will be added alongside their respective
// v2 caches in later phases. See docs/19 §6 for the authoritative
// write→invalidation matrix.
//
// All helpers are best-effort: KV write/delete failures are swallowed so
// they cannot block the underlying mutation. Correctness for missed
// invalidations falls back to TTL.

import type { Env } from "../env";
import { bumpGen } from "./epoch";
import {
	digestGenKey,
	forumSummaryGenKey,
	forumTreeGenKey,
	postListGenKey,
	threadListGenKey,
	threadMetaGenKey,
	userMiniKey,
	userPublicKey,
} from "./keys";

// ─── Single-key delete helpers ─────────────────────────────────────

/**
 * Delete the `user:mini:v2:<id>` cache entry. Safe even when no value
 * exists.
 */
export async function deleteUserMini(env: Env, userId: number): Promise<void> {
	const key = userMiniKey(userId);
	try {
		await env.KV.delete(key);
	} catch (err) {
		// best-effort
		console.warn(`[cache] delete failed key=${key}`, err);
	}
}

/**
 * Delete BOTH viewer-bucket variants of `user:public:v2:<id>` in parallel.
 * KV has no wildcard delete, so we enumerate the two known buckets every
 * time.
 */
export async function deleteUserPublicVariants(env: Env, userId: number): Promise<void> {
	const publicKey = userPublicKey(userId, "public");
	const staffKey = userPublicKey(userId, "staff");
	await Promise.all([
		env.KV.delete(publicKey).catch((err) => {
			console.warn(`[cache] delete failed key=${publicKey}`, err);
		}),
		env.KV.delete(staffKey).catch((err) => {
			console.warn(`[cache] delete failed key=${staffKey}`, err);
		}),
	]);
}

/**
 * Convenience: delete every per-user cache entry that depends on the given
 * userId (mini + both public variants). Use for admin user CRUD / nuke /
 * purge / ban / batch-status / batch-role / batch-recalc-counters / single
 * recalcCounters / `me.updateProfile` (avatar) / email verify / admin
 * statistics recalc-users.
 */
export async function invalidateUserCaches(env: Env, userId: number): Promise<void> {
	await Promise.all([deleteUserMini(env, userId), deleteUserPublicVariants(env, userId)]);
}

// ─── Generation bump helpers (per docs/19 §3.3) ────────────────────

export async function bumpForumTreeGen(env: Env): Promise<string> {
	return bumpGen(env, forumTreeGenKey());
}

export async function bumpForumSummaryGen(env: Env): Promise<string> {
	return bumpGen(env, forumSummaryGenKey());
}

export async function bumpThreadListGen(env: Env, forumId: number): Promise<string> {
	return bumpGen(env, threadListGenKey(forumId));
}

export async function bumpThreadMetaGen(env: Env, threadId: number): Promise<string> {
	return bumpGen(env, threadMetaGenKey(threadId));
}

export async function bumpPostListGen(env: Env, threadId: number): Promise<string> {
	return bumpGen(env, postListGenKey(threadId));
}

export async function bumpDigestGen(env: Env): Promise<string> {
	return bumpGen(env, digestGenKey());
}

// ─── Composite domain helpers ──────────────────────────────────────
//
// These bundle the bumps documented in docs/19 §6 for the most common
// write categories. They are exported so that future commits in Phase 1
// can call a single helper from each handler instead of re-listing the
// gen keys, and so that the matrix is enforced in code instead of
// per-call. Phase 1 wires only the gaps explicitly listed in docs/19 §9.

/**
 * Bump only `forum:summary:gen` — the safe parity for legacy callsites
 * whose mutation changes counts / last-post / today-thread metadata for
 * forums but does not have a precise forumId in scope (or where the
 * thread-list cache is not yet active in this phase). Use this whenever
 * the legacy code calls `invalidateForumVolatile(env)` without a
 * forumId-keyed thread-list invalidation.
 */
export async function invalidateForumSummaryV2(env: Env): Promise<void> {
	await bumpForumSummaryGen(env);
}

/**
 * Bump everything that depends on the forum-summary aggregates after a
 * volatile thread/post change in `forumId`. Mirrors the
 * `POST /api/v1/threads` row in §6 (forum:summary:gen + thread:list:gen for
 * the affected forum). Use ONLY at callsites that already had an exact
 * `forumId` and where thread-list:v2 is wired (Phase 3+).
 */
export async function invalidateForumVolatileV2(env: Env, forumId: number): Promise<void> {
	await Promise.all([bumpForumSummaryGen(env), bumpThreadListGen(env, forumId)]);
}

/**
 * Bump every gen affected by a forum create / delete / merge: the
 * structural tree, the per-bucket summary aggregates, AND the digest
 * gen because the set of forums visible to digest filters changes when
 * a forum is added or removed. For `update`, callers must use
 * `invalidateForumUpdateV2` which decides per-field whether digest is
 * affected. For `reorder`, use `invalidateForumReorderV2` (tree +
 * summary, NOT digest).
 */
export async function invalidateForumStructureV2(env: Env): Promise<void> {
	await Promise.all([bumpForumTreeGen(env), bumpForumSummaryGen(env), bumpDigestGen(env)]);
}

/**
 * Bump tree + summary, and conditionally digest, for a forum update.
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
	const ops: Promise<unknown>[] = [bumpForumTreeGen(env), bumpForumSummaryGen(env)];
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
 * deliberately excluded — see docs/19 §6 for the rationale.
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
 * Bump tree + summary for a `display_order` reorder. Digest filters are
 * untouched by reorder so we deliberately do NOT bump digest gen.
 */
export async function invalidateForumReorderV2(env: Env): Promise<void> {
	await Promise.all([bumpForumTreeGen(env), bumpForumSummaryGen(env)]);
}
