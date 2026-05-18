// @vitest-environment happy-dom
// Tests for PostRatingDialog — submit happy path, dimension lock, score
// validation, reason length cap, error code → user-copy mapping.
//
// Mock strategy (reviewer guidance msg=e91ac78e + msg=90aecd8e):
// We avoid any module-level `vi.mock` so this file does not share a
// `vi.mock` factory cache slot with sibling tests under vitest
// `isolate: false` (the monorepo's root `bun run test`). Both the
// previous `vi.mock("@/viewmodels/forum/rating-reasons", ...)` and a
// would-be `vi.mock("@/lib/api-client", ...)` would interleave with
// other test files in the same worker (`post-rating-flow`,
// `post-rating-summary`, `write-gate`, every `*-toast` test) — leading
// to "mock function called 0 times" failures even though the click
// fired and the real submit path ran.
//
// Instead we stub the global `fetch` so the real `apiClient.post` runs
// and the real `submitPostRating` viewmodel runs, and we assert on the
// observable HTTP request (URL + JSON body) and on rendered output.
// Production behaviour is identical: `apiClient` is the only network
// surface for browser code, and its envelope shape (`{ data, meta }`)
// is exactly what we hand back here.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Fetch stub ──────────────────────────────────────────────────────────────

const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	cleanup();
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { PostRatingDialog } from "@/components/forum/post-rating-dialog";
import { RatingDimension } from "@ellie/types";

// Build a `Response` for the `{ data, meta }` envelope `apiClient` expects.
function envelopeResponse(data: unknown, status = 200): Response {
	const body = JSON.stringify({ data, meta: { timestamp: 0, requestId: "test" } });
	return new Response(body, {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// Build an error `Response` matching the Worker's wrapped error envelope:
//   { error: { code, message } }
// `throwForErrorBody` in `apiClient` turns this into `new ApiError(status, code, message)`.
function errorResponse(status: number, code: string, message: string): Response {
	const body = JSON.stringify({ error: { code, message } });
	return new Response(body, {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// Extract the JSON body sent by `apiClient.post`. Test asserts on this
// instead of the deprecated mockSubmit args.
function postedBody(call: [string, RequestInit | undefined]): unknown {
	const init = call[1];
	if (!init?.body) return undefined;
	return JSON.parse(init.body as string);
}

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
		fetchMock.mockResolvedValue(
			envelopeResponse({
				rating: { id: 1, score: 5, dimension: "coins" },
				aggregate: { total: 1, credits: { count: 0, sum: 0 }, coins: { count: 1, sum: 5 } },
			}),
		);
		const { onSuccess, onOpenChange } = renderDialog();

		fireEvent.click(screen.getByText("+5"));
		const textarea = screen.getByPlaceholderText(/请输入评分理由/);
		fireEvent.change(textarea, { target: { value: "优秀文章" } });

		fireEvent.click(screen.getByText("提交评分"));

		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalled();
		});
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/v1/posts/42/rate");
		expect(init.method).toBe("POST");
		expect(postedBody([url, init])).toEqual({
			dimension: "coins",
			score: 5,
			reason: "优秀文章",
			notifyAuthor: true,
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

	it("disables submit until a valid score is picked (reason is optional)", () => {
		renderDialog();
		const submit = screen.getByText("提交评分").closest("button") as HTMLButtonElement;
		expect(submit.disabled).toBe(true);

		fireEvent.click(screen.getByText("+5"));
		// reason is optional — submit becomes enabled as soon as score is valid
		expect(submit.disabled).toBe(false);
	});

	it("allows submit with empty reason and posts reason='' to the API", async () => {
		fetchMock.mockResolvedValue(
			envelopeResponse({
				rating: { id: 2, score: 2, dimension: "coins" },
				aggregate: { total: 1, credits: { count: 0, sum: 0 }, coins: { count: 1, sum: 2 } },
			}),
		);
		renderDialog();
		fireEvent.click(screen.getByText("+2"));
		fireEvent.click(screen.getByText("提交评分"));
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalled();
		});
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toContain("/api/v1/posts/42/rate");
		expect(postedBody([url, init])).toEqual({
			dimension: "coins",
			score: 2,
			reason: "",
			notifyAuthor: true,
		});
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
		fetchMock.mockResolvedValue(errorResponse(409, "RATING_DUPLICATE", "duplicate"));
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
		fetchMock.mockResolvedValue(errorResponse(429, "RATING_DAILY_LIMIT", "too many"));
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
