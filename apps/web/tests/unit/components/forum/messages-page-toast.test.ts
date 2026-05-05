// @vitest-environment happy-dom
// Tests for MessagesPageClient toast integration (handleDelete / handleMarkAllRead)
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the viewmodel module
vi.mock("@/viewmodels/forum/messages", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		fetchMessages: vi.fn(),
		fetchUnreadCount: vi.fn(),
		deleteMessage: vi.fn(),
		markAllMessagesRead: vi.fn(),
	};
});

// Mock next/navigation
vi.mock("next/navigation", () => ({
	useRouter: () => ({ replace: vi.fn() }),
}));

// Mock next/link as a passthrough
vi.mock("next/link", () => ({
	default: ({ children, href }: { children: unknown; href: string }) =>
		createElement("a", { href }, children),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { MessagesPageClient } from "@/components/forum/messages-page";
import { ApiError } from "@/lib/api-error";
import {
	deleteMessage,
	fetchMessages,
	fetchUnreadCount,
	markAllMessagesRead,
} from "@/viewmodels/forum/messages";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_MESSAGES = [
	{
		id: 1,
		senderId: 10,
		senderName: "Alice",
		receiverId: 20,
		receiverName: "Bob",
		subject: "Hello",
		preview: "Hi there",
		isRead: false,
		createdAt: 1700000000,
	},
	{
		id: 2,
		senderId: 11,
		senderName: "Charlie",
		receiverId: 20,
		receiverName: "Bob",
		subject: "Test",
		preview: "Testing",
		isRead: true,
		createdAt: 1700001000,
	},
];

function renderMessagesPage() {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(MessagesPageClient, {
				breadcrumbs: [{ label: "站内信" }],
				initialBox: "inbox",
			}),
		),
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessagesPageClient toast integration", () => {
	beforeEach(() => {
		vi.mocked(fetchMessages).mockResolvedValue({
			messages: MOCK_MESSAGES,
			nextCursor: null,
			unreadCount: 1,
		});
		vi.mocked(fetchUnreadCount).mockResolvedValue(1);
		vi.mocked(deleteMessage).mockReset();
		vi.mocked(markAllMessagesRead).mockReset();

		// happy-dom doesn't provide confirm/alert; define stubs on globalThis
		globalThis.confirm = vi.fn(() => true);
		globalThis.alert = vi.fn();
	});

	afterEach(() => {
		cleanup();
	});

	// -------------------------------------------------------------------------
	// handleDelete
	// -------------------------------------------------------------------------

	it("shows success toast on delete", async () => {
		vi.mocked(deleteMessage).mockResolvedValueOnce(undefined);

		renderMessagesPage();
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeTruthy();
		});

		const deleteButtons = screen.getAllByTitle("删除");
		await act(async () => {
			fireEvent.click(deleteButtons[0]);
		});

		await waitFor(() => {
			expect(screen.getByText("站内信已删除")).toBeTruthy();
		});
		expect(globalThis.alert).not.toHaveBeenCalled();
	});

	it("shows error toast with ApiError message on delete failure", async () => {
		vi.mocked(deleteMessage).mockRejectedValueOnce(
			new ApiError(403, "FORBIDDEN", "无权删除此消息"),
		);

		renderMessagesPage();
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeTruthy();
		});

		const deleteButtons = screen.getAllByTitle("删除");
		await act(async () => {
			fireEvent.click(deleteButtons[0]);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("无权删除此消息"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("删除失败");
		});
		expect(globalThis.alert).not.toHaveBeenCalled();
	});

	it("shows fallback error toast on delete non-ApiError failure", async () => {
		vi.mocked(deleteMessage).mockRejectedValueOnce(new Error("network"));

		renderMessagesPage();
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeTruthy();
		});

		const deleteButtons = screen.getAllByTitle("删除");
		await act(async () => {
			fireEvent.click(deleteButtons[0]);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("删除失败，请重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("删除失败");
		});
		expect(globalThis.alert).not.toHaveBeenCalled();
	});

	// -------------------------------------------------------------------------
	// handleMarkAllRead
	// -------------------------------------------------------------------------

	it("shows success toast on mark all read", async () => {
		vi.mocked(markAllMessagesRead).mockResolvedValueOnce(undefined);

		renderMessagesPage();
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeTruthy();
		});

		const markAllBtn = screen.getByRole("button", { name: /全部已读/ });
		await act(async () => {
			fireEvent.click(markAllBtn);
		});

		await waitFor(() => {
			expect(screen.getByText("已全部标记为已读")).toBeTruthy();
		});
		expect(globalThis.alert).not.toHaveBeenCalled();
	});

	it("shows error toast with ApiError message on mark all read failure", async () => {
		vi.mocked(markAllMessagesRead).mockRejectedValueOnce(
			new ApiError(500, "INTERNAL", "服务器内部错误"),
		);

		renderMessagesPage();
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeTruthy();
		});

		const markAllBtn = screen.getByRole("button", { name: /全部已读/ });
		await act(async () => {
			fireEvent.click(markAllBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("服务器内部错误"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("标记已读失败");
		});
		expect(globalThis.alert).not.toHaveBeenCalled();
	});

	it("shows fallback error toast on mark all read non-ApiError failure", async () => {
		vi.mocked(markAllMessagesRead).mockRejectedValueOnce(new Error("timeout"));

		renderMessagesPage();
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeTruthy();
		});

		const markAllBtn = screen.getByRole("button", { name: /全部已读/ });
		await act(async () => {
			fireEvent.click(markAllBtn);
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("操作失败，请重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("标记已读失败");
		});
		expect(globalThis.alert).not.toHaveBeenCalled();
	});
});
