// Forum v2 KV cache payload contracts + bucket-aware filters + pure
// builders / validators (docs/19 §4 / §5).
//
// This module is intentionally **pure**: no IO, no env, no KV/D1 access.
// It is consumed by the read handlers (Phase 2 commit 2) and by tests.
//
// Layering rule (recap):
//   - `forum:tree:v2`    — long TTL (24h), structural fields only
//   - `forum:summary:v2` — short TTL (5–10min), aggregate fields including
//                          last-poster avatar/avatarPath (eats up to TTL of
//                          stale avatar to keep cache hits SQL-free)
//   - `forum:meta:v2`    — 10min, single-forum view (structural + summary
//                          + moderatorList of just this forum)
//
// Bucket filtering uses lazy expansion (commit 1 contract):
//   - cache miss for bucket `b` builds the payload only for bucket `b`
//   - other buckets stay cold until they themselves miss
//
// `isForumActive` (status === 1) is enforced inside every builder. Inactive
// forums are dropped from every bucket — including `admin` — to match the
// existing public `/api/v1/forums*` semantics, where inactive forums are
// 404 for everyone.

import type {
	Forum,
	ForumType,
	ForumVisibility,
	ModeratorInfo,
	VisibilityContext,
} from "@ellie/types";
import { canViewForumVisibility } from "@ellie/types";
import { UserRole } from "@ellie/types";
import type { VisibilityBucket } from "./keys";

// ─── Bucket → VisibilityContext ────────────────────────────────────

/**
 * Materialize a `VisibilityContext` that the existing visibility helpers
 * (`canViewForumVisibility`, etc.) will agree with for a given bucket.
 *
 * - `anon`   → not logged in
 * - `member` → ordinary logged-in user (UserRole.User)
 * - `staff`  → Mod / SuperMod (Admin is its own bucket — see below)
 * - `admin`  → Admin only
 *
 * `admin` is intentionally NOT folded into `staff` so admin-only forums
 * never bleed into the `staff` payload.
 */
export function bucketToVisibilityContext(bucket: VisibilityBucket): VisibilityContext {
	switch (bucket) {
		case "anon":
			return { isLoggedIn: false, role: UserRole.User };
		case "member":
			return { isLoggedIn: true, role: UserRole.User };
		case "staff":
			return { isLoggedIn: true, role: UserRole.Mod };
		case "admin":
			return { isLoggedIn: true, role: UserRole.Admin };
	}
}

// ─── Payload contracts ─────────────────────────────────────────────

/**
 * Structural fields of a forum, cached in `forum:tree:v2`. No aggregates,
 * no last-post info — those live in `forum:summary:v2` (different gen,
 * different TTL).
 */
export interface ForumTreeNodeV2 {
	id: number;
	parentId: number;
	name: string;
	description: string;
	icon: string;
	displayOrder: number;
	type: ForumType;
	status: number;
	visibility: ForumVisibility;
	/** Comma-separated moderator usernames (used by canModerate permission check). */
	moderators: string;
	/**
	 * Comma-separated moderator user IDs. Required by `GET /api/v1/forums/:id/ancestors`
	 * (`ForumContext.moderatorIds`) which reuses this tree payload — keeping it
	 * here means ancestors hits never have to fall back to D1 for moderator IDs.
	 */
	moderatorIds: string;
	moderatorList: ModeratorInfo[];
}

/**
 * Per-forum aggregate fields cached in `forum:summary:v2`. Includes the
 * last-poster avatar fields so cache hits do NOT have to round-trip to
 * `user:mini` or D1; the trade-off is up to `forum:summary` TTL of stale
 * avatar/username after a user update. This is accepted on the forum
 * index view — user-affecting writes do NOT bump `forum:summary:gen`,
 * the avatar simply refreshes when the summary entry naturally expires.
 */
export interface ForumAggregateV2 {
	threads: number;
	posts: number;
	todayThreads: number;
	lastThreadId: number;
	lastThreadSubject: string;
	lastPostAt: number;
	lastPoster: string;
	lastPosterId: number;
	lastPosterAvatar: string;
	lastPosterAvatarPath: string;
}

export interface ForumTreePayloadV2 {
	bucket: VisibilityBucket;
	forums: ForumTreeNodeV2[];
}

export interface ForumSummaryPayloadV2 {
	bucket: VisibilityBucket;
	/** Keyed by forumId; only contains forums the bucket can see. */
	aggregates: Record<number, ForumAggregateV2>;
}

/**
 * Single-forum payload cached in `forum:meta:v2:<forumId>:<bucket>`.
 * Mirrors the public `Forum` response so the read handler can return it
 * verbatim. Builder only emits this when the forum is active AND visible
 * to the bucket — invisible / inactive cases must not write KV.
 */
export interface ForumMetaPayloadV2 {
	bucket: VisibilityBucket;
	forum: Forum;
}

// ─── Bucket filter ─────────────────────────────────────────────────

/**
 * Drop forums that are either inactive (status !== 1) or not visible to
 * `bucket`. Order is preserved.
 */
export function filterForumsForBucket<T extends { status: number; visibility: ForumVisibility }>(
	forums: T[],
	bucket: VisibilityBucket,
): T[] {
	const ctx = bucketToVisibilityContext(bucket);
	return forums.filter((f) => f.status === 1 && canViewForumVisibility(f.visibility, ctx));
}

/**
 * `true` iff `forum` is active AND visible to `bucket`. Used by the meta
 * builder to decide whether to write a payload at all.
 */
export function isForumVisibleToBucket(
	forum: { status: number; visibility: ForumVisibility } | null | undefined,
	bucket: VisibilityBucket,
): boolean {
	if (forum == null) return false;
	if (forum.status !== 1) return false;
	const ctx = bucketToVisibilityContext(bucket);
	return canViewForumVisibility(forum.visibility, ctx);
}

// ─── Payload builders ──────────────────────────────────────────────

/**
 * Build `forum:tree:v2:<bucket>` payload from the full forum row set.
 * Caller is responsible for providing the *raw* full forum list (no
 * pre-filter) — the builder applies `active + visibility` itself so the
 * filtering is centralized.
 */
export function buildForumTreePayload(
	allForums: Array<Forum & { moderatorIds: string }>,
	bucket: VisibilityBucket,
): ForumTreePayloadV2 {
	const visible = filterForumsForBucket(allForums, bucket);
	const forums: ForumTreeNodeV2[] = visible.map((f) => ({
		id: f.id,
		parentId: f.parentId,
		name: f.name,
		description: f.description,
		icon: f.icon,
		displayOrder: f.displayOrder,
		type: f.type,
		status: f.status,
		visibility: f.visibility,
		moderators: f.moderators,
		moderatorIds: f.moderatorIds,
		moderatorList: f.moderatorList,
	}));
	return { bucket, forums };
}

/**
 * Build `forum:summary:v2:<bucket>` payload. Aggregates are keyed by
 * forumId — keys are restricted to forums the bucket can see. Caller
 * must pass already-enriched aggregates (last-poster avatar fields
 * resolved); this builder does not fetch them.
 */
export function buildForumSummaryPayload(
	allForums: Array<Forum & { todayThreads?: number }>,
	bucket: VisibilityBucket,
): ForumSummaryPayloadV2 {
	const visible = filterForumsForBucket(allForums, bucket);
	const aggregates: Record<number, ForumAggregateV2> = {};
	for (const f of visible) {
		aggregates[f.id] = {
			threads: f.threads,
			posts: f.posts,
			todayThreads: f.todayThreads ?? 0,
			lastThreadId: f.lastThreadId,
			lastThreadSubject: f.lastThreadSubject,
			lastPostAt: f.lastPostAt,
			lastPoster: f.lastPoster,
			lastPosterId: f.lastPosterId,
			lastPosterAvatar: f.lastPosterAvatar,
			lastPosterAvatarPath: f.lastPosterAvatarPath,
		};
	}
	return { bucket, aggregates };
}

/**
 * Build `forum:meta:v2:<forumId>:<bucket>` payload. Returns `null` when
 * the forum is inactive or not visible to `bucket` — callers must NOT
 * write KV in that case (`forum:meta:v2` only caches 200 responses, never
 * 403/404).
 */
export function buildForumMetaPayload(
	forum: Forum,
	bucket: VisibilityBucket,
): ForumMetaPayloadV2 | null {
	if (!isForumVisibleToBucket(forum, bucket)) return null;
	return { bucket, forum };
}

// ─── Validators (post-cache-read shape guards) ─────────────────────
//
// These are intentionally narrow — they verify the top-level shape only.
// The KV payload is JSON we wrote ourselves in the same release, so deep
// validation would be paranoia; the goal is to guard against a stale
// payload from a previous schema slipping through (e.g. someone forgot
// to bump `forum:tree:gen` on a payload-shape change).

export function isForumTreePayload(value: unknown): value is ForumTreePayloadV2 {
	if (!value || typeof value !== "object") return false;
	const v = value as Partial<ForumTreePayloadV2>;
	return typeof v.bucket === "string" && Array.isArray(v.forums);
}

export function isForumSummaryPayload(value: unknown): value is ForumSummaryPayloadV2 {
	if (!value || typeof value !== "object") return false;
	const v = value as Partial<ForumSummaryPayloadV2>;
	return typeof v.bucket === "string" && v.aggregates != null && typeof v.aggregates === "object";
}

export function isForumMetaPayload(value: unknown): value is ForumMetaPayloadV2 {
	if (!value || typeof value !== "object") return false;
	const v = value as Partial<ForumMetaPayloadV2>;
	return typeof v.bucket === "string" && v.forum != null && typeof v.forum === "object";
}
