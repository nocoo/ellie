// @vitest-environment happy-dom
// Tests for UserModActions toast integration
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock api-client
const mockPost = vi.fn(async () => ({ data: {} }));
const mockGet = vi.fn(async () => ({ data: { status: 0 } }));
vi.mock("@/lib/api-client", () => ({
	apiClient: {
		post: (...args: any[]) => mockPost(...args),
		get: (...args: any[]) => mockGet(...args),
	},
}));

// Mock next/navigation
const mockRefresh = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));

// Mock UI components to simplify rendering
vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: any) => createElement("span", null, children),
}));
vi.mock("@/components/ui/button", () => ({
	Button: ({ children, onClick, disabled }: any) =>
		createElement("button", { type: "button", onClick, disabled }, children),
}));
vi.mock("@/components/ui/dialog", () => ({
	Dialog: ({ children, open }: any) => (open ? createElement("div", null, children) : null),
	DialogContent: ({ children }: any) => createElement("div", null, children),
	DialogDescription: ({ children }: any) => createElement("p", null, children),
	DialogFooter: ({ children }: any) => createElement("div", null, children),
	DialogHeader: ({ children }: any) => createElement("div", null, children),
	DialogTitle: ({ children }: any) => createElement("h2", null, children),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
	DropdownMenu: ({ children }: any) => createElement("div", null, children),
	DropdownMenuContent: ({ children }: any) => createElement("div", null, children),
	DropdownMenuItem: ({ children, onClick, disabled }: any) =>
		createElement("button", { type: "button", onClick, disabled }, children),
	DropdownMenuSeparator: () => createElement("hr"),
	DropdownMenuTrigger: ({ render }: any) => render,
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { UserModActions } from "@/components/forum/user-mod-actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderActions(props: Partial<Parameters<typeof UserModActions>[0]> = {}) {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(UserModActions, {
				userId: 42,
				username: "testuser",
				viewerRole: 1,
				isSelf: false,
				...props,
			}),
		),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UserModActions toast integration", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		mockGet.mockResolvedValue({ data: { status: 0 } });
	});

	afterEach(() => {
		vi.useRealTimers();
		cleanup();
	});

	it("shows success toast on mute action", async () => {
		vi.useRealTimers();
		renderActions();

		// Wait for status fetch and click mute
		await waitFor(() => {
			expect(screen.getByText("禁止发言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁止发言"));
		});

		// Confirmation dialog should open — click confirm
		await waitFor(() => {
			expect(screen.getByText("禁言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁言"));
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const successToast = alerts.find((el) => el.textContent?.includes("禁止发言成功"));
			expect(successToast).toBeTruthy();
		});
	});

	it("shows error toast on action failure with Error message", async () => {
		mockPost.mockRejectedValueOnce(new Error("用户不存在"));

		vi.useRealTimers();
		renderActions();

		await waitFor(() => {
			expect(screen.getByText("禁止发言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁止发言"));
		});

		await waitFor(() => {
			expect(screen.getByText("禁言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁言"));
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("用户不存在"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("禁止发言失败");
		});
	});

	it("shows error toast with fallback on non-Error failure", async () => {
		mockPost.mockRejectedValueOnce("unknown");

		vi.useRealTimers();
		renderActions();

		await waitFor(() => {
			expect(screen.getByText("禁止发言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁止发言"));
		});

		await waitFor(() => {
			expect(screen.getByText("禁言")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("禁言"));
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("请稍后重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("禁止发言失败");
		});
	});

	it("shows success toast on nuke and preserves redirect", async () => {
		vi.useRealTimers();
		renderActions();

		await waitFor(() => {
			expect(screen.getByText("封禁并删除内容")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("封禁并删除内容"));
		});

		await waitFor(() => {
			expect(screen.getByText("封禁并删除")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(screen.getByText("封禁并删除"));
		});

		// Toast should appear immediately
		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const successToast = alerts.find((el) => el.textContent?.includes("封禁并删除内容成功"));
			expect(successToast).toBeTruthy();
		});

		// Wait for the 1s delayed redirect
		await waitFor(
			() => {
				expect(mockPush).toHaveBeenCalledWith("/");
			},
			{ timeout: 2000 },
		);
	});
});
