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
	try {
		await env.KV.delete(userMiniKey(userId));
	} catch {
		// best-effort
	}
}

/**
 * Delete BOTH viewer-bucket variants of `user:public:v2:<id>` in parallel.
 * KV has no wildcard delete, so we enumerate the two known buckets every
 * time.
 */
export async function deleteUserPublicVariants(env: Env, userId: number): Promise<void> {
	await Promise.all([
		env.KV.delete(userPublicKey(userId, "public")).catch(() => {}),
		env.KV.delete(userPublicKey(userId, "staff")).catch(() => {}),
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
 * Bump everything that depends on the forum-summary aggregates after a
 * volatile thread/post change in `forumId`. Mirrors the
 * `POST /api/v1/threads` row in §6 (forum:summary:gen + thread:list:gen for
 * the affected forum).
 */
export async function invalidateForumVolatileV2(env: Env, forumId: number): Promise<void> {
	await Promise.all([bumpForumSummaryGen(env), bumpThreadListGen(env, forumId)]);
}
