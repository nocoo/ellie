// @vitest-environment happy-dom
// Tests for ReportDialog toast integration (submit success/failure only)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Mock cap-widget — render nothing
vi.mock("@/components/cap-widget", () => ({
	CapWidget: () => createElement("div", { "data-testid": "cap-widget" }),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { ReportDialog } from "@/components/forum/report-dialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDialog(props: Partial<Parameters<typeof ReportDialog>[0]> = {}) {
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
	});

	afterEach(() => {
		vi.useRealTimers();
		cleanup();
	});

	it("shows success toast on report submit", async () => {
		vi.useRealTimers();
		renderDialog();

		// Wait for permission check to pass
		await waitFor(() => {
			expect(screen.getByText("您有权限举报此回复")).toBeTruthy();
		});

		// Select a reason
		const reasonBtn = screen.getByText("垃圾广告");
		await act(async () => {
			fireEvent.click(reasonBtn);
		});

		// Submit
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
		renderDialog();

		await waitFor(() => {
			expect(screen.getByText("您有权限举报此回复")).toBeTruthy();
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
		renderDialog();

		await waitFor(() => {
			expect(screen.getByText("您有权限举报此回复")).toBeTruthy();
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
