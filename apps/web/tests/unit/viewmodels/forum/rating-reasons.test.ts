import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/lib/api-client";
import {
	fetchPostRatings,
	RATING_REASONS_BY_DIMENSION,
	RATING_SCORE_PRESETS,
	revokePostRating,
	submitPostRating,
} from "@/viewmodels/forum/rating-reasons";

describe("rating-reasons constants", () => {
	it("provides non-empty reasons and presets for coins and credits", () => {
		expect(RATING_REASONS_BY_DIMENSION.coins.length).toBeGreaterThan(0);
		expect(RATING_REASONS_BY_DIMENSION.credits.length).toBeGreaterThan(0);
		expect(RATING_SCORE_PRESETS.coins).toContain(1);
		expect(RATING_SCORE_PRESETS.coins).toContain(-1);
		expect(RATING_SCORE_PRESETS.credits).toContain(10);
		expect(RATING_SCORE_PRESETS.credits).toContain(-10);
	});
});

describe("rating-reasons API wrappers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("submitPostRating posts body to /api/v1/posts/:id/rate and returns data", async () => {
		const payload = { dimension: "coins" as const, score: 5, reason: "热心助人" };
		const responseData = { rating: { id: 1 }, aggregate: { total: 1 } };
		const spy = vi
			.spyOn(apiClient, "post")
			.mockResolvedValue({ data: responseData, meta: { timestamp: 1, requestId: "r1" } });

		const result = await submitPostRating(42, payload);
		expect(spy).toHaveBeenCalledWith("/api/v1/posts/42/rate", payload);
		expect(result).toEqual(responseData);
	});

	it("fetchPostRatings gets /api/v1/posts/:id/ratings and returns data", async () => {
		const responseData = { items: [], aggregate: { total: 0 } };
		const spy = vi
			.spyOn(apiClient, "get")
			.mockResolvedValue({ data: responseData, meta: { timestamp: 1, requestId: "r2" } });

		const result = await fetchPostRatings(42);
		expect(spy).toHaveBeenCalledWith("/api/v1/posts/42/ratings");
		expect(result).toEqual(responseData);
	});

	it("revokePostRating posts to /api/v1/posts/:postId/ratings/:ratingId/revoke", async () => {
		const spy = vi
			.spyOn(apiClient, "post")
			.mockResolvedValue({ data: {}, meta: { timestamp: 1, requestId: "r3" } });

		await expect(revokePostRating(42, 7)).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalledWith("/api/v1/posts/42/ratings/7/revoke");
	});
});
