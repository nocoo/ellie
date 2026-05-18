/**
 * Post-rating ViewModel — predefined-reason constants + submit API.
 *
 * Predefined reason copy comes verbatim from docs/22-post-rating.md §7.2:
 *   - coins  (同钱): 热心助人 / 优秀文章 / 内容详实 / 鼓励原创 / 有理有据
 *   - credits (积分): 内容优秀 / 精华推荐 / 违规扣分 / 灌水 / 重复发帖
 *
 * The reason list is hardcoded for MVP (§1 decision #1 — settings-backed
 * override is out of scope). Worker accepts any string that survives
 * `trim+censor+escape` and fits within `RATING_REASON_MAX_LENGTH`.
 */

import { ApiError, apiClient } from "@/lib/api-client";
import type {
	CreatePostRatingRequest,
	CreatePostRatingResponse,
	RatingDimensionKey,
} from "@ellie/types";

// ---------------------------------------------------------------------------
// Predefined reasons (docs/22 §7.2)
// ---------------------------------------------------------------------------

export const RATING_REASONS_BY_DIMENSION: Record<RatingDimensionKey, readonly string[]> = {
	coins: ["热心助人", "优秀文章", "内容详实", "鼓励原创", "有理有据"] as const,
	credits: ["内容优秀", "精华推荐", "违规扣分", "灌水", "重复发帖"] as const,
};

/**
 * Quick-button score presets per dimension (docs/22 §7.2 — example column).
 * Custom values are still accepted via the manual input within
 * `getRatingPerVoteBounds()`; presets only seed the keyboard-friendly chips.
 *
 * Negative entries always pair with their positive counterpart so reviewers
 * can dock without typing. The dialog filters per role when it renders.
 */
export const RATING_SCORE_PRESETS: Record<RatingDimensionKey, readonly number[]> = {
	coins: [1, 2, 3, 5, 10, -1, -2, -5, -10],
	credits: [10, 20, 50, -10, -20, -50],
};

// ---------------------------------------------------------------------------
// Submit API
// ---------------------------------------------------------------------------

/**
 * Submit a new post rating via the Next proxy → Worker.
 *
 * Returns the freshly-inserted row plus the up-to-date aggregate so the
 * summary popover can refresh without a second round-trip. Errors surface
 * as `ApiError` with the Worker's error code preserved (`SELF_RATING`,
 * `RATING_DUPLICATE`, `RATING_DAILY_LIMIT`, `RATING_SCORE_OUT_OF_RANGE`,
 * `RATING_REASON_TOO_LONG`, `RATING_PERMISSION_DENIED`,
 * `RATING_INVALID_POST`, `EMAIL_NOT_VERIFIED`).
 */
export async function submitPostRating(
	postId: number,
	body: CreatePostRatingRequest,
): Promise<CreatePostRatingResponse> {
	const result = await apiClient.post<CreatePostRatingResponse>(
		`/api/v1/posts/${postId}/rate`,
		body,
	);
	return result.data;
}

export { ApiError };
