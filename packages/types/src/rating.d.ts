import { UserRole } from "./types";
/**
 * Rating dimension — matches Discuz extcredits ids verbatim so the ETL
 * can copy `pre_forum_ratelog.extcredits` straight into `dimension`.
 *
 *   1 = 积分 (credits / extcredits1)
 *   2 = 同钱 (coins / extcredits2)
 */
export declare enum RatingDimension {
    Credits = 1,
    Coins = 2
}
/** String form used at the API/UI boundary. */
export type RatingDimensionKey = "credits" | "coins";
/** UI-side dimension toggle (e.g. dialog tab state). */
export declare const RATING_DIMENSION_KEYS: readonly RatingDimensionKey[];
export declare function ratingDimensionToKey(dim: RatingDimension): RatingDimensionKey;
export declare function ratingKeyToDimension(key: RatingDimensionKey): RatingDimension;
/**
 * Per-vote score bounds applied to the **absolute** value of `score`.
 * Per-day caps are rolling 24h SUM(ABS(score)) on the active subset
 * (revoked rows refund their quota). See docs/22-post-rating.md §4.
 *
 * `coins.perDay` is the unified 5200/day cap for every authenticated
 * user. `credits.perDay` is role-keyed and rejects role=0 (User) at the
 * permission layer before this table is consulted.
 */
export declare const RATING_LIMITS: {
    readonly coins: {
        readonly perDay: 5200;
        readonly perVoteMax: 100;
        readonly perVoteMin: 1;
    };
    readonly credits: {
        readonly perVoteMax: 50;
        readonly perVoteMin: 1;
        readonly perDay: Record<UserRole, number>;
    };
};
/** Hard limit on `reason` length after trim+censor — matches Discuz `char(40)`. */
export declare const RATING_REASON_MAX_LENGTH = 40;
/** Rolling-quota window length in seconds (24h). */
export declare const RATING_QUOTA_WINDOW_SECONDS: number;
/**
 * Resolve the rolling-24h cap for a role+dimension pair.
 *
 * Returns 0 when the role is not permitted to rate that dimension — the
 * caller MUST short-circuit on a permission check first; this function
 * is intentionally not a permission gate, just a quota lookup.
 */
export declare function getRatingPerDayCap(role: UserRole, dimension: RatingDimension): number;
/**
 * Resolve the per-vote |score| bounds for a dimension. The min/max apply
 * to `Math.abs(score)`; both positive and negative scores are accepted
 * within the bound.
 */
export declare function getRatingPerVoteBounds(dimension: RatingDimension): {
    min: number;
    max: number;
};
/**
 * Permission rule: which roles can rate which dimension.
 * Mirrors the §3 permission matrix.
 */
export declare function canRateDimension(role: UserRole, dimension: RatingDimension): boolean;
/**
 * Permission rule: which roles can revoke any rating.
 * Mirrors the §3 permission matrix — Admin and SuperMod only.
 */
export declare function canRevokeRating(role: UserRole): boolean;
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
export declare const EMPTY_RATING_AGGREGATE: PostRatingAggregate;
