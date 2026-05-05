// @vitest-environment happy-dom
// Tests for ThreadModMenu toast integration
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock moderation API
const mockSetThreadClosed = vi.fn(async () => {});
const mockSetThreadSticky = vi.fn(async () => {});
const mockSetThreadDigest = vi.fn(async () => {});
const mockSetThreadHighlight = vi.fn(async () => {});
const mockMoveThread = vi.fn(async () => {});
const mockDeleteThread = vi.fn(async () => {});
vi.mock("@/lib/moderation-api", () => ({
	setThreadClosed: (...args: any[]) => mockSetThreadClosed(...args),
	setThreadSticky: (...args: any[]) => mockSetThreadSticky(...args),
	setThreadDigest: (...args: any[]) => mockSetThreadDigest(...args),
	setThreadHighlight: (...args: any[]) => mockSetThreadHighlight(...args),
	moveThread: (...args: any[]) => mockMoveThread(...args),
	deleteThread: (...args: any[]) => mockDeleteThread(...args),
}));

vi.mock("@/lib/api-client", () => ({
	ApiError: class ApiError extends Error {
		message: string;
		constructor(m: string) {
			super(m);
			this.message = m;
		}
	},
}));

// Mock next/navigation
const mockRefresh = vi.fn();
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));

// Mock sub-dialog components — render simple trigger buttons for confirm actions
vi.mock("@/components/forum/sticky-dialog", () => ({
	StickyDialog: ({ open, onConfirm }: any) =>
		open
			? createElement(
					"button",
					{ type: "button", "data-testid": "sticky-confirm", onClick: () => onConfirm(1) },
					"ConfirmSticky",
				)
			: null,
}));
vi.mock("@/components/forum/highlight-dialog", () => ({
	HighlightDialog: ({ open, onConfirm }: any) =>
		open
			? createElement(
					"button",
					{
						type: "button",
						"data-testid": "highlight-confirm",
						onClick: () => onConfirm({ color: "red" }),
					},
					"ConfirmHighlight",
				)
			: null,
}));
vi.mock("@/components/forum/digest-dialog", () => ({
	DigestDialog: ({ open, onConfirm }: any) =>
		open
			? createElement(
					"button",
					{ type: "button", "data-testid": "digest-confirm", onClick: () => onConfirm(1) },
					"ConfirmDigest",
				)
			: null,
}));
vi.mock("@/components/forum/move-dialog", () => ({
	MoveDialog: ({ open, onConfirm }: any) =>
		open
			? createElement(
					"button",
					{ type: "button", "data-testid": "move-confirm", onClick: () => onConfirm(99) },
					"ConfirmMove",
				)
			: null,
}));
vi.mock("@/components/ui/confirm-dialog", () => ({
	ConfirmDialog: ({ open, onConfirm }: any) =>
		open
			? createElement(
					"button",
					{ type: "button", "data-testid": "delete-confirm", onClick: () => onConfirm() },
					"ConfirmDelete",
				)
			: null,
}));
vi.mock("@/components/forum/forum-action-button", () => ({
	ForumActionButton: ({ label, onClick, disabled }: any) =>
		createElement(
			"button",
			{ type: "button", onClick, disabled, "data-testid": `action-${label}` },
			label,
		),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { ThreadModMenu } from "@/components/forum/thread-mod-menu";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMenu(props: Partial<Parameters<typeof ThreadModMenu>[0]> = {}) {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(ThreadModMenu, {
				threadId: 1,
				forumId: 10,
				sticky: 0,
				digest: 0,
				highlight: 0,
				closed: false,
				canManageThread: true,
				canMoveThread: true,
				canDeleteThread: true,
				...props,
			}),
		),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ThreadModMenu toast integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	// --- Close/Unlock ---

	it("shows success toast on close thread", async () => {
		renderMenu({ closed: false });

		const closeBtn = screen.getByTestId("action-关闭");
		await act(async () => {
			fireEvent.click(closeBtn);
		});

		await waitFor(() => {
			expect(screen.getByText("主题已关闭")).toBeTruthy();
		});
		expect(mockSetThreadClosed).toHaveBeenCalledWith(1, true);
	});

	it("shows success toast on unlock thread", async () => {
		renderMenu({ closed: true });

		const unlockBtn = screen.getByTestId("action-解锁");
		await act(async () => {
			fireEvent.click(unlockBtn);
		});

		await waitFor(() => {
			expect(screen.getByText("主题已解锁")).toBeTruthy();
		});
		expect(mockSetThreadClosed).toHaveBeenCalledWith(1, false);
	});

	it("shows error toast on close failure", async () => {
		const { ApiError } = await import("@/lib/api-client");
		mockSetThreadClosed.mockRejectedValueOnce(new ApiError("权限不足"));

		renderMenu({ closed: false });

		const closeBtn = screen.getByTestId("action-关闭");
		await act(async () => {
			fireEvent.click(closeBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("权限不足"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("关闭失败");
		});
	});

	// --- Sticky ---

	it("shows success toast on sticky change", async () => {
		renderMenu();

		// Open sticky dialog
		const stickyBtn = screen.getByTestId("action-置顶");
		await act(async () => {
			fireEvent.click(stickyBtn);
		});

		// Confirm in mock dialog
		const confirmBtn = screen.getByTestId("sticky-confirm");
		await act(async () => {
			fireEvent.click(confirmBtn);
		});

		await waitFor(() => {
			expect(screen.getByText("置顶已更新")).toBeTruthy();
		});
	});

	// --- Move ---

	it("shows error toast on move failure", async () => {
		mockMoveThread.mockRejectedValueOnce(new Error("network"));

		renderMenu();

		// Open move dialog
		const moveBtn = screen.getByTestId("action-移动");
		await act(async () => {
			fireEvent.click(moveBtn);
		});

		// Confirm in mock dialog
		const confirmBtn = screen.getByTestId("move-confirm");
		await act(async () => {
			fireEvent.click(confirmBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("操作失败"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("移动失败");
		});
	});

	// --- Delete ---

	it("shows success toast on delete (before router.push)", async () => {
		renderMenu();

		// Open delete dialog
		const deleteBtn = screen.getByTestId("action-删除");
		await act(async () => {
			fireEvent.click(deleteBtn);
		});

		// Confirm in mock dialog
		const confirmBtn = screen.getByTestId("delete-confirm");
		await act(async () => {
			fireEvent.click(confirmBtn);
		});

		await waitFor(() => {
			expect(screen.getByText("主题已删除")).toBeTruthy();
		});
		expect(mockPush).toHaveBeenCalledWith("/forums/10");
	});

	it("shows error toast on delete failure", async () => {
		const { ApiError } = await import("@/lib/api-client");
		mockDeleteThread.mockRejectedValueOnce(new ApiError("主题不存在"));

		renderMenu();

		const deleteBtn = screen.getByTestId("action-删除");
		await act(async () => {
			fireEvent.click(deleteBtn);
		});

		const confirmBtn = screen.getByTestId("delete-confirm");
		await act(async () => {
			fireEvent.click(confirmBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("主题不存在"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("删除失败");
		});
		expect(mockPush).not.toHaveBeenCalled();
	});
});
