// @vitest-environment happy-dom
// Tests for ReportDialog toast integration (submit success/failure only)
//
// CAP_API_ENDPOINT is a module-level constant — we set the env then
// dynamically import ReportDialog so the constant is initialized to a
// non-empty value. CapWidget is mocked to auto-solve on mount so the
// fail-closed CAPTCHA gate clears and the reason picker appears.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useEffect } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_CAP_ENV = process.env.NEXT_PUBLIC_CAP_API_ENDPOINT;

beforeAll(() => {
	process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
});

afterAll(() => {
	if (ORIGINAL_CAP_ENV === undefined) {
		Reflect.deleteProperty(process.env, "NEXT_PUBLIC_CAP_API_ENDPOINT");
	} else {
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = ORIGINAL_CAP_ENV;
	}
});

// Mock report viewmodel
const mockSubmitReport = vi.fn(async () => ({
	id: 1,
	type: "post",
	targetId: 1,
	reason: "垃圾广告",
}));
vi.mock("@/viewmodels/forum/report", () => ({
	ApiError: class ApiError extends Error {
		code?: string;
		constructor(m: string, c?: string) {
			super(m);
			this.message = m;
			this.code = c;
		}
	},
	REPORT_REASONS: ["垃圾广告", "违规内容", "人身攻击", "虚假信息", "侵权内容", "其他"],
	submitReport: (...args: any[]) => mockSubmitReport(...args),
}));

// Mock write-gate — always allow (not blocked)
vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: () => Promise.resolve(false),
}));

// Mock cap-widget to auto-solve so the fail-closed CAPTCHA gate clears
vi.mock("@/components/cap-widget", () => ({
	CapWidget: ({ onSolve }: { onSolve: (t: string) => void }) => {
		useEffect(() => {
			onSolve("test-token");
		}, [onSolve]);
		return createElement("div", { "data-testid": "cap-widget" });
	},
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

async function loadDialog() {
	const [{ ForumToastProvider }, { ReportDialog }] = await Promise.all([
		import("@/components/forum/forum-toast"),
		import("@/components/forum/report-dialog"),
	]);
	return { ForumToastProvider, ReportDialog };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderDialog(props: Record<string, unknown> = {}) {
	const { ForumToastProvider, ReportDialog } = await loadDialog();
	const onOpenChange = vi.fn();
	return {
		onOpenChange,
		...render(
			createElement(
				ForumToastProvider,
				null,
				createElement(ReportDialog, {
					open: true,
					onOpenChange,
					targetType: "post",
					targetId: 42,
					...props,
				}),
			),
		),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReportDialog toast integration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		mockSubmitReport.mockReset();
		mockSubmitReport.mockResolvedValue({ id: 1 });
		// Ensure CAP env is set before the dynamic import re-evaluates the
		// report-dialog module (the web vitest config runs with isolate:false,
		// so the module cache survives across files).
		process.env.NEXT_PUBLIC_CAP_API_ENDPOINT = "https://cap.example.com";
		vi.resetModules();
	});

	afterEach(() => {
		vi.useRealTimers();
		cleanup();
	});

	it("shows success toast on report submit", async () => {
		vi.useRealTimers();
		await renderDialog();

		// Wait for permission check + CAPTCHA auto-solve → reason picker
		await waitFor(() => {
			expect(screen.getByText("垃圾广告")).toBeTruthy();
		});

		const reasonBtn = screen.getByText("垃圾广告");
		await act(async () => {
			fireEvent.click(reasonBtn);
		});

		const submitBtn = screen.getByText("提交举报");
		await act(async () => {
			fireEvent.click(submitBtn);
		});

		await waitFor(() => {
			expect(screen.getByText("举报已提交")).toBeTruthy();
		});
	});

	it("shows error toast on duplicate report (ApiError with code)", async () => {
		const { ApiError } = await import("@/viewmodels/forum/report");
		mockSubmitReport.mockRejectedValueOnce(
			Object.assign(new ApiError("已重复举报", "DUPLICATE_REPORT"), { code: "DUPLICATE_REPORT" }),
		);

		vi.useRealTimers();
		await renderDialog();

		await waitFor(() => {
			expect(screen.getByText("垃圾广告")).toBeTruthy();
		});

		const reasonBtn = screen.getByText("垃圾广告");
		await act(async () => {
			fireEvent.click(reasonBtn);
		});

		const submitBtn = screen.getByText("提交举报");
		await act(async () => {
			fireEvent.click(submitBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("您已经举报过这条回复了"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("举报提交失败");
		});
	});

	it("shows error toast on non-ApiError failure (network error)", async () => {
		mockSubmitReport.mockRejectedValueOnce(new TypeError("Failed to fetch"));

		vi.useRealTimers();
		await renderDialog();

		await waitFor(() => {
			expect(screen.getByText("违规内容")).toBeTruthy();
		});

		const reasonBtn = screen.getByText("违规内容");
		await act(async () => {
			fireEvent.click(reasonBtn);
		});

		const submitBtn = screen.getByText("提交举报");
		await act(async () => {
			fireEvent.click(submitBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("网络错误，请重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("举报提交失败");
		});
	});
});
