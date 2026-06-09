// @vitest-environment happy-dom
// Integration test for the post-rating UI flow (docs/22 §7.2 §7.3, Phase 6).
//
// Mounts a small harness that mirrors how post-card wires PostRatingDialog
// and PostRatingSummary together: dialog's onSuccess updates the shared
// aggregate state, summary re-renders with the new totals. We assert:
//
//   1. The action-bar entry-point (PostRatingDialog) submits and resolves.
//   2. The success callback bumps the aggregate in the parent.
//   3. The summary row re-renders with the new total + dimension sums.
//   4. Opening the summary popover lazy-fetches the detail list (mock
//      called exactly once on first open), and the list renders the
//      rater + reason text.
//
// Reviewer guidance (msg=965f4862): integration test must assert aggregate
// refresh and lazy popover detail fetch, not just button rendering. This
// harness exercises both — the dialog→summary state lift and the
// summary→viewmodel detail load.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const submitMock = vi.fn();
const fetchMock = vi.fn();
const revokeMock = vi.fn();

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
		RATING_REASONS_BY_DIMENSION: {
			coins: ["热心助人", "优秀文章"],
			credits: ["内容优秀", "灌水"],
		},
		RATING_SCORE_PRESETS: {
			coins: [1, 2, 5, -1, -2],
			credits: [10, 20, -10],
		},
		submitPostRating: (...args: any[]) => submitMock(...args),
		fetchPostRatings: (...args: any[]) => fetchMock(...args),
		revokePostRating: (...args: any[]) => revokeMock(...args),
	};
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import {
	EMPTY_RATING_AGGREGATE,
	type PostRatingAggregate,
	type PostRatingsResponse,
	RatingDimension,
} from "@ellie/types";
import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostRatingDialog } from "@/components/forum/post-rating-dialog";
import { PostRatingSummary } from "@/components/forum/post-rating-summary";

// ─── Test harness — mirrors PostCard's wiring ────────────────────────────────

function Harness({
	initialAggregate = EMPTY_RATING_AGGREGATE,
	defaultDimension = RatingDimension.Coins,
}: {
	initialAggregate?: PostRatingAggregate;
	defaultDimension?: RatingDimension;
}) {
	// Mirrors PostCard's `ratingAggregate` state lift. PostCard renders the
	// summary only when `total > 0` — we replicate that exact gate so the
	// test exercises the same "render on success" path that production uses.
	const [aggregate, setAggregate] = useState<PostRatingAggregate>(initialAggregate);
	const [open, setOpen] = useState(true);
	return createElement(ForumToastProvider, null, [
		createElement(PostRatingDialog, {
			key: "dialog",
			open,
			onOpenChange: setOpen,
			postId: 42,
			defaultDimension,
			canRateCredits: true,
			onSuccess: (response) => {
				// PostCard sets the aggregate from the create response and
				// closes the dialog.
				setAggregate(response.aggregate);
			},
		}),
		aggregate.total > 0
			? createElement(PostRatingSummary, {
					key: "summary",
					postId: 42,
					aggregate,
				})
			: null,
	]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PostRatingDialog → PostRatingSummary integration", () => {
	beforeEach(() => {
		submitMock.mockReset();
		fetchMock.mockReset();
		revokeMock.mockReset();
	});
	afterEach(cleanup);

	it("submits a coins rating, lifts the aggregate to the summary, and lazy-loads the detail list", async () => {
		// Step 1: configure the submit response — Worker returns the fresh
		// aggregate so callers don't need a second round-trip.
		submitMock.mockResolvedValue({
			rating: { id: 11, score: 5, dimension: "coins" },
			aggregate: {
				total: 1,
				credits: { count: 0, sum: 0 },
				coins: { count: 1, sum: 5 },
			} satisfies PostRatingAggregate,
		});

		render(createElement(Harness, {}));

		// Sanity: summary is hidden because aggregate.total === 0.
		expect(screen.queryByTestId("post-rating-summary")).toBeNull();

		// Step 2: pick the +5 preset chip, fill the reason, submit.
		fireEvent.click(screen.getByText("+5"));
		const textarea = screen.getByPlaceholderText(/请输入评分理由/);
		fireEvent.change(textarea, { target: { value: "优秀文章" } });
		fireEvent.click(screen.getByText("提交评分"));

		// Step 3: dialog submitted with the expected payload — same shape the
		// browser-facing /rate proxy expects.
		await waitFor(() => {
			expect(submitMock).toHaveBeenCalledWith(42, {
				dimension: "coins",
				score: 5,
				reason: "优秀文章",
				notifyAuthor: true,
			});
		});

		// Step 4: aggregate now flowed to the summary — verify it actually
		// re-rendered with the new totals (not just present in props).
		await waitFor(() => {
			expect(screen.getByTestId("post-rating-summary")).toBeTruthy();
		});
		expect(screen.getByTestId("post-rating-summary-total").textContent).toBe("1");
		expect(screen.getByTestId("post-rating-summary-coins").textContent).toContain("+5");

		// Step 5: clicking the toggle must lazy-fetch the detail list. Before
		// the click, fetchPostRatings has NOT been called.
		expect(fetchMock).not.toHaveBeenCalled();

		const detailResponse: PostRatingsResponse = {
			postId: 42,
			threadId: 7,
			aggregate: {
				total: 1,
				credits: { count: 0, sum: 0 },
				coins: { count: 1, sum: 5 },
			},
			items: [
				{
					id: 11,
					postId: 42,
					threadId: 7,
					raterId: 100,
					raterName: "alice",
					dimension: "coins",
					score: 5,
					reason: "优秀文章",
					createdAt: 1700000000,
					revokedAt: 0,
					canRevoke: false,
				},
			],
		};
		fetchMock.mockResolvedValue(detailResponse);

		fireEvent.click(screen.getByTestId("post-rating-summary-toggle"));

		// Step 6: detail endpoint hit exactly once on first open.
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect(fetchMock).toHaveBeenCalledWith(42);
		});
		await waitFor(() => {
			expect(screen.getByTestId("post-rating-summary-list")).toBeTruthy();
		});
		// Step 7: list rendered the rater name + the reason text from the
		// detail response (not from the SSR aggregate).
		expect(screen.getByText("alice")).toBeTruthy();
		expect(screen.getByText(/优秀文章/)).toBeTruthy();
	});

	it("preserves existing aggregate then updates it after a second create response", async () => {
		// Start with a non-zero aggregate (simulating server-rendered enrichment).
		const initial: PostRatingAggregate = {
			total: 1,
			credits: { count: 0, sum: 0 },
			coins: { count: 1, sum: 2 },
		};
		submitMock.mockResolvedValue({
			rating: { id: 12, score: 10, dimension: "credits" },
			aggregate: {
				total: 2,
				credits: { count: 1, sum: 10 },
				coins: { count: 1, sum: 2 },
			} satisfies PostRatingAggregate,
		});

		render(
			createElement(Harness, {
				initialAggregate: initial,
				defaultDimension: RatingDimension.Credits,
			}),
		);

		// Summary visible from the start with initial totals.
		expect(screen.getByTestId("post-rating-summary-total").textContent).toBe("1");
		expect(screen.getByTestId("post-rating-summary-coins").textContent).toContain("+2");

		// Pick +10 (credits preset) and submit.
		fireEvent.click(screen.getByText("+10"));
		fireEvent.click(screen.getByText("提交评分"));

		await waitFor(() => {
			expect(submitMock).toHaveBeenCalledWith(42, {
				dimension: "credits",
				score: 10,
				reason: "",
				notifyAuthor: true,
			});
		});

		// Aggregate replaces (not adds) — Worker is authoritative.
		await waitFor(() => {
			expect(screen.getByTestId("post-rating-summary-total").textContent).toBe("2");
		});
		expect(screen.getByTestId("post-rating-summary-credits").textContent).toContain("+10");
		expect(screen.getByTestId("post-rating-summary-coins").textContent).toContain("+2");
	});
});
