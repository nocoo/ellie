// @vitest-environment happy-dom
// Tests for PostRatingDialog — submit happy path, dimension lock, score
// validation, reason length cap, error code → user-copy mapping.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockSubmit = vi.fn();
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
		submitPostRating: (...args: any[]) => mockSubmit(...args),
		fetchPostRatings: vi.fn(),
		revokePostRating: vi.fn(),
	};
});

// Reach into the mocked module to grab the ApiError class for assertions
async function getFakeApiError(): Promise<typeof Error> {
	const mod = (await import("@/viewmodels/forum/rating-reasons")) as { ApiError: typeof Error };
	return mod.ApiError;
}

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostRatingDialog } from "@/components/forum/post-rating-dialog";
import { RatingDimension } from "@ellie/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderDialog(props: Partial<Parameters<typeof PostRatingDialog>[0]> = {}) {
	const onOpenChange = vi.fn();
	const onSuccess = vi.fn();
	return {
		onOpenChange,
		onSuccess,
		...render(
			createElement(
				ForumToastProvider,
				null,
				createElement(PostRatingDialog, {
					open: true,
					onOpenChange,
					postId: 42,
					defaultDimension: RatingDimension.Coins,
					canRateCredits: true,
					onSuccess,
					...props,
				}),
			),
		),
	};
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PostRatingDialog", () => {
	beforeEach(() => {
		mockSubmit.mockReset();
	});
	afterEach(cleanup);

	it("renders coins dimension by default and shows preset chips", () => {
		renderDialog();
		// The dimension tab "同钱" should be selected (button text)
		expect(screen.getByText("同钱")).toBeTruthy();
		expect(screen.getByText("积分")).toBeTruthy();
		// Coins preset 1 should be visible as a chip (+1)
		expect(screen.getByText("+1")).toBeTruthy();
		expect(screen.getByText("+5")).toBeTruthy();
	});

	it("submits with score + reason + notifyAuthor=true by default", async () => {
		mockSubmit.mockResolvedValue({
			rating: { id: 1, score: 5, dimension: "coins" },
			aggregate: { total: 1, credits: { count: 0, sum: 0 }, coins: { count: 1, sum: 5 } },
		});
		const { onSuccess, onOpenChange } = renderDialog();

		fireEvent.click(screen.getByText("+5"));
		const textarea = screen.getByPlaceholderText(/请输入评分理由/);
		fireEvent.change(textarea, { target: { value: "优秀文章" } });

		fireEvent.click(screen.getByText("提交评分"));

		await waitFor(() => {
			expect(mockSubmit).toHaveBeenCalledWith(42, {
				dimension: "coins",
				score: 5,
				reason: "优秀文章",
				notifyAuthor: true,
			});
		});
		await waitFor(() => {
			expect(onSuccess).toHaveBeenCalled();
			expect(onOpenChange).toHaveBeenCalledWith(false);
		});
	});

	it("locks credits tab when canRateCredits=false", () => {
		renderDialog({ canRateCredits: false, defaultDimension: RatingDimension.Coins });
		const creditsBtn = screen.getByText("积分").closest("button");
		expect(creditsBtn?.hasAttribute("disabled")).toBe(true);
	});

	it("falls back to coins dimension when defaultDimension=credits but viewer can't rate credits", () => {
		renderDialog({ canRateCredits: false, defaultDimension: RatingDimension.Credits });
		// The coins tab should be the active one
		const coinsBtn = screen.getByText("同钱").closest("button");
		expect(coinsBtn?.getAttribute("aria-selected")).toBe("true");
	});

	it("disables submit until score AND reason are both valid", () => {
		renderDialog();
		const submit = screen.getByText("提交评分").closest("button") as HTMLButtonElement;
		expect(submit.disabled).toBe(true);

		fireEvent.click(screen.getByText("+5"));
		expect(submit.disabled).toBe(true); // still no reason

		const textarea = screen.getByPlaceholderText(/请输入评分理由/);
		fireEvent.change(textarea, { target: { value: "ok" } });
		expect(submit.disabled).toBe(false);
	});

	it("rejects score=0 even if typed in custom input", () => {
		renderDialog();
		const customInput = screen.getByPlaceholderText(/自定义分值/);
		fireEvent.change(customInput, { target: { value: "0" } });
		const textarea = screen.getByPlaceholderText(/请输入评分理由/);
		fireEvent.change(textarea, { target: { value: "test" } });
		const submit = screen.getByText("提交评分").closest("button") as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
	});

	it("surfaces RATING_DUPLICATE error code as user copy", async () => {
		const FakeApiError = (await getFakeApiError()) as unknown as new (
			s: number,
			c: string,
			m: string,
		) => Error;
		mockSubmit.mockRejectedValue(new FakeApiError(409, "RATING_DUPLICATE", "duplicate"));
		renderDialog();

		fireEvent.click(screen.getByText("+5"));
		const textarea = screen.getByPlaceholderText(/请输入评分理由/);
		fireEvent.change(textarea, { target: { value: "test" } });
		fireEvent.click(screen.getByText("提交评分"));

		await waitFor(() => {
			expect(screen.getAllByText("您已经评过这个维度了").length).toBeGreaterThan(0);
		});
	});

	it("surfaces RATING_DAILY_LIMIT error code as user copy", async () => {
		const FakeApiError = (await getFakeApiError()) as unknown as new (
			s: number,
			c: string,
			m: string,
		) => Error;
		mockSubmit.mockRejectedValue(new FakeApiError(429, "RATING_DAILY_LIMIT", "too many"));
		renderDialog();

		fireEvent.click(screen.getByText("+5"));
		const textarea = screen.getByPlaceholderText(/请输入评分理由/);
		fireEvent.change(textarea, { target: { value: "test" } });
		fireEvent.click(screen.getByText("提交评分"));

		await waitFor(() => {
			expect(screen.getAllByText("今日额度已耗尽").length).toBeGreaterThan(0);
		});
	});

	it("predefined reason dropdown fills the textarea", () => {
		renderDialog();
		const dropdown = screen.getByLabelText("选择预设理由") as HTMLSelectElement;
		fireEvent.change(dropdown, { target: { value: "优秀文章" } });
		const textarea = screen.getByPlaceholderText(/请输入评分理由/) as HTMLTextAreaElement;
		expect(textarea.value).toBe("优秀文章");
	});
});
