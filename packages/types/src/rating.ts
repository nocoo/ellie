// rating.ts — Post rating (评分) shared types and limit constants
//
// Restores Discuz `pre_forum_ratelog` semantics in the new system:
//   * Per-post rating events transferring `credits` (extcredits1) or
//     `coins` (extcredits2) from rater → post author.
//   * `dupkarmarate=0` — one active rating per (rater, post, dimension).
//   * Soft revoke via `revoked_at` / `revoked_by` so quota auto-refunds.
//
// See docs/22-post-rating.md §4, §5.1, §6 for the full spec. Constants
// are intentionally hardcoded for the MVP (decision #1 in §1); a future
// `settings`-backed override is out of scope.

import { UserRole } from "./types";

// ─── Dimension ──────────────────────────────────────────────

/**
 * Rating dimension — matches Discuz extcredits ids verbatim so the ETL
 * can copy `pre_forum_ratelog.extcredits` straight into `dimension`.
 *
 *   1 = 积分 (credits / extcredits1)
 *   2 = 同钱 (coins / extcredits2)
 */
export enum RatingDimension {
	Credits = 1,
	Coins = 2,
}

/** String form used at the API/UI boundary. */
export type RatingDimensionKey = "credits" | "coins";

/** UI-side dimension toggle (e.g. dialog tab state). */
export const RATING_DIMENSION_KEYS: readonly RatingDimensionKey[] = ["credits", "coins"] as const;

export function ratingDimensionToKey(dim: RatingDimension): RatingDimensionKey {
	return dim === RatingDimension.Credits ? "credits" : "coins";
}

export function ratingKeyToDimension(key: RatingDimensionKey): RatingDimension {
	return key === "credits" ? RatingDimension.Credits : RatingDimension.Coins;
}

// ─── Limits (hardcoded constants — §1 decision #1) ─────────

/**
 * Per-vote score bounds applied to the **absolute** value of `score`.
 * Per-day caps are rolling 24h SUM(ABS(score)) on the active subset
 * (revoked rows refund their quota). See docs/22-post-rating.md §4.
 *
 * `coins.perDay` is the unified 5200/day cap for every authenticated
 * user. `credits.perDay` is role-keyed and rejects role=0 (User) at the
 * permission layer before this table is consulted.
 */
export const RATING_LIMITS = {
	coins: {
		perDay: 5200,
		perVoteMax: 100,
		perVoteMin: 1,
	},
	credits: {
		perVoteMax: 50,
		perVoteMin: 1,
		perDay: {
			[UserRole.Mod]: 100,
			[UserRole.SuperMod]: 200,
			[UserRole.Admin]: 200,
		} as Record<UserRole, number>,
	},
} as const;

/** Hard limit on `reason` length after trim+censor — matches Discuz `char(40)`. */
export const RATING_REASON_MAX_LENGTH = 40;

/** Rolling-quota window length in seconds (24h). */
export const RATING_QUOTA_WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Resolve the rolling-24h cap for a role+dimension pair.
 *
 * Returns 0 when the role is not permitted to rate that dimension — the
 * caller MUST short-circuit on a permission check first; this function
 * is intentionally not a permission gate, just a quota lookup.
 */
export function getRatingPerDayCap(role: UserRole, dimension: RatingDimension): number {
	if (dimension === RatingDimension.Coins) {
		return RATING_LIMITS.coins.perDay;
	}
	// dimension === Credits
	const map = RATING_LIMITS.credits.perDay;
	return map[role] ?? 0;
}

/**
 * Resolve the per-vote |score| bounds for a dimension. The min/max apply
 * to `Math.abs(score)`; both positive and negative scores are accepted
 * within the bound.
 */
export function getRatingPerVoteBounds(dimension: RatingDimension): { min: number; max: number } {
	if (dimension === RatingDimension.Coins) {
		return { min: RATING_LIMITS.coins.perVoteMin, max: RATING_LIMITS.coins.perVoteMax };
	}
	return { min: RATING_LIMITS.credits.perVoteMin, max: RATING_LIMITS.credits.perVoteMax };
}

/**
 * Permission rule: which roles can rate which dimension.
 * Mirrors the §3 permission matrix.
 */
export function canRateDimension(role: UserRole, dimension: RatingDimension): boolean {
	if (dimension === RatingDimension.Coins) {
		// All authenticated, non-special roles can grant coins.
		return (
			role === UserRole.User ||
			role === UserRole.Mod ||
			role === UserRole.SuperMod ||
			role === UserRole.Admin
		);
	}
	// Credits — moderators and above only.
	return role === UserRole.Mod || role === UserRole.SuperMod || role === UserRole.Admin;
}

/**
 * Permission rule: which roles can revoke any rating.
 * Mirrors the §3 permission matrix — Admin and SuperMod only.
 */
export function canRevokeRating(role: UserRole): boolean {
	return role === UserRole.Admin || role === UserRole.SuperMod;
}

// ─── Wire types ─────────────────────────────────────────────

/** One row of `post_ratings` shaped for the JSON API. */
export interface PostRatingRow {
	id: number;
	postId: number;
	threadId: number;
	raterId: number;
	raterName: string;
	dimension: RatingDimensionKey;
	score: number;
	reason: string;
	createdAt: number;
	revokedAt: number;
	/** Server-decided: true iff the current viewer can revoke this row. */
	canRevoke: boolean;
}

/** Per-dimension aggregate over the active (un-revoked) rows for a post. */
export interface PostRatingDimensionAggregate {
	count: number;
	sum: number;
}

/**
 * Compact aggregate attached to each post row in the list/detail
 * response. Always present; both dimensions emit zeroed entries when
 * there are no ratings yet.
 */
export interface PostRatingAggregate {
	total: number;
	credits: PostRatingDimensionAggregate;
	coins: PostRatingDimensionAggregate;
}

/** Full payload returned by `GET /api/v1/posts/:postId/ratings`. */
export interface PostRatingsResponse {
	postId: number;
	threadId: number;
	aggregate: PostRatingAggregate;
	items: PostRatingRow[];
}

/** Request body for `POST /api/v1/posts/:postId/rate`. */
export interface CreatePostRatingRequest {
	dimension: RatingDimensionKey;
	score: number;
	reason: string;
	notifyAuthor: boolean;
}

/** Successful response from `POST /api/v1/posts/:postId/rate`. */
export interface CreatePostRatingResponse {
	rating: PostRatingRow;
	aggregate: PostRatingAggregate;
}

/** Empty zero-state aggregate (helper). */
export const EMPTY_RATING_AGGREGATE: PostRatingAggregate = {
	total: 0,
	credits: { count: 0, sum: 0 },
	coins: { count: 0, sum: 0 },
};
