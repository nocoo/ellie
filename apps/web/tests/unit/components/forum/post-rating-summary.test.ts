// @vitest-environment happy-dom
// Tests for PostRatingSummary — aggregate row, lazy detail-popover load,
// optimistic revoke, error mapping. Reviewer constraint (msg=3d726d71):
// the detail list must be reachable via keyboard/focus — verified by
// clicking the popover trigger (no hover events) and asserting list content.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
const mockRevoke = vi.fn();
vi.mock("@/viewmodels/forum/rating-reasons", () => {
	class FakeApiError extends Error {
		code?: string;
		status?: number;
		constructor(status: number, code: string, message: string) {
			super(message);
			this.status = status;
			this.code = code;
			this.message = message;
		}
	}
	return {
		ApiError: FakeApiError,
		fetchPostRatings: (...args: any[]) => mockFetch(...args),
		revokePostRating: (...args: any[]) => mockRevoke(...args),
		submitPostRating: vi.fn(),
		RATING_REASONS_BY_DIMENSION: { coins: [], credits: [] },
		RATING_SCORE_PRESETS: { coins: [], credits: [] },
	};
});

async function getFakeApiError(): Promise<typeof Error> {
	const mod = (await import("@/viewmodels/forum/rating-reasons")) as { ApiError: typeof Error };
	return mod.ApiError;
}

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostRatingSummary } from "@/components/forum/post-rating-summary";
import type { PostRatingAggregate, PostRatingRow, PostRatingsResponse } from "@ellie/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const zeroAggregate: PostRatingAggregate = {
	total: 0,
	credits: { count: 0, sum: 0 },
	coins: { count: 0, sum: 0 },
};

const sampleAggregate: PostRatingAggregate = {
	total: 2,
	credits: { count: 1, sum: 20 },
	coins: { count: 1, sum: 5 },
};

function makeRow(overrides: Partial<PostRatingRow> = {}): PostRatingRow {
	return {
		id: 1,
		postId: 42,
		threadId: 7,
		raterId: 100,
		raterName: "alice",
		dimension: "coins",
		score: 5,
		reason: "优秀文章",
		createdAt: Date.now(),
		revokedAt: 0,
		canRevoke: false,
		...overrides,
	};
}

function renderSummary(aggregate: PostRatingAggregate = sampleAggregate) {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(PostRatingSummary, { postId: 42, aggregate }),
		),
	);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PostRatingSummary", () => {
	beforeEach(() => {
		mockFetch.mockReset();
		mockRevoke.mockReset();
	});
	afterEach(cleanup);

	it("renders nothing when aggregate.total is 0", () => {
		const { container } = renderSummary(zeroAggregate);
		expect(container.querySelector('[data-testid="post-rating-summary"]')).toBeNull();
	});

	it("renders the aggregate row with both dimensions", () => {
		renderSummary();
		expect(screen.getByTestId("post-rating-summary")).toBeTruthy();
		expect(screen.getByTestId("post-rating-summary-total").textContent).toBe("2");
		expect(screen.getByTestId("post-rating-summary-credits").textContent).toContain("+20");
		expect(screen.getByTestId("post-rating-summary-coins").textContent).toContain("+5");
	});

	it("lazy-fetches detail on first popover open and renders the list", async () => {
		const response: PostRatingsResponse = {
			postId: 42,
			threadId: 7,
			aggregate: sampleAggregate,
			items: [makeRow({ id: 11, raterName: "alice", reason: "优秀文章" })],
		};
		mockFetch.mockResolvedValue(response);
		renderSummary();
		expect(mockFetch).not.toHaveBeenCalled();

		fireEvent.click(screen.getByTestId("post-rating-summary-toggle"));

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(42);
		});
		await waitFor(() => {
			expect(screen.getByTestId("post-rating-summary-list")).toBeTruthy();
		});
		expect(screen.getByText("alice")).toBeTruthy();
		expect(screen.getByText(/优秀文章/)).toBeTruthy();
	});

	it("shows revoke button only when row.canRevoke is true", async () => {
		const response: PostRatingsResponse = {
			postId: 42,
			threadId: 7,
			aggregate: sampleAggregate,
			items: [
				makeRow({ id: 11, canRevoke: false }),
				makeRow({ id: 12, canRevoke: true, raterName: "bob" }),
			],
		};
		mockFetch.mockResolvedValue(response);
		renderSummary();
		fireEvent.click(screen.getByTestId("post-rating-summary-toggle"));

		await waitFor(() => {
			expect(screen.getByTestId("post-rating-summary-list")).toBeTruthy();
		});
		expect(screen.queryByTestId("post-rating-summary-revoke-11")).toBeNull();
		expect(screen.getByTestId("post-rating-summary-revoke-12")).toBeTruthy();
	});

	it("optimistically removes the row after a successful revoke", async () => {
		const response: PostRatingsResponse = {
			postId: 42,
			threadId: 7,
			aggregate: sampleAggregate,
			items: [makeRow({ id: 12, canRevoke: true, dimension: "coins", score: 5 })],
		};
		mockFetch.mockResolvedValue(response);
		mockRevoke.mockResolvedValue(undefined);

		renderSummary();
		fireEvent.click(screen.getByTestId("post-rating-summary-toggle"));

		await waitFor(() => {
			expect(screen.getByTestId("post-rating-summary-revoke-12")).toBeTruthy();
		});
		fireEvent.click(screen.getByTestId("post-rating-summary-revoke-12"));

		await waitFor(() => {
			expect(mockRevoke).toHaveBeenCalledWith(42, 12);
		});
		await waitFor(() => {
			expect(screen.queryByTestId("post-rating-summary-revoke-12")).toBeNull();
		});
	});

	it("maps NOT_FOUND error to user copy and keeps the row visible", async () => {
		const FakeApiError = (await getFakeApiError()) as unknown as new (
			s: number,
			c: string,
			m: string,
		) => Error;
		const response: PostRatingsResponse = {
			postId: 42,
			threadId: 7,
			aggregate: sampleAggregate,
			items: [makeRow({ id: 12, canRevoke: true })],
		};
		mockFetch.mockResolvedValue(response);
		mockRevoke.mockRejectedValue(new FakeApiError(404, "NOT_FOUND", "gone"));

		renderSummary();
		fireEvent.click(screen.getByTestId("post-rating-summary-toggle"));

		await waitFor(() => {
			expect(screen.getByTestId("post-rating-summary-revoke-12")).toBeTruthy();
		});
		fireEvent.click(screen.getByTestId("post-rating-summary-revoke-12"));

		await waitFor(() => {
			expect(screen.getAllByText("该评分已被撤销或不存在").length).toBeGreaterThan(0);
		});
		// Row stays visible since the optimistic remove only happens on success.
		expect(screen.getByTestId("post-rating-summary-revoke-12")).toBeTruthy();
	});
});
