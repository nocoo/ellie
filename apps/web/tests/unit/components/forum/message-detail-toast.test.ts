// @vitest-environment happy-dom
// Tests for MessageDetailClient delete toast integration
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the viewmodel module
vi.mock("@/viewmodels/forum/messages", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		fetchMessage: vi.fn(),
		deleteMessage: vi.fn(),
	};
});

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
	useSession: () => ({ data: { user: { id: "20" } } }),
}));

// Mock next/link as a passthrough
vi.mock("next/link", () => ({
	default: ({ children, href }: { children: unknown; href: string }) =>
		createElement("a", { href }, children),
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { MessageDetailClient } from "@/components/forum/message-detail";
import { ApiError } from "@/lib/api-error";
import { deleteMessage, fetchMessage } from "@/viewmodels/forum/messages";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_MESSAGE = {
	id: 42,
	senderId: 10,
	senderName: "Alice",
	receiverId: 20,
	receiverName: "Bob",
	subject: "Hello",
	content: "Hi there, how are you?",
	isRead: true,
	createdAt: 1700000000,
};

function renderMessageDetail() {
	return render(
		createElement(
			ForumToastProvider,
			null,
			createElement(MessageDetailClient, {
				messageId: 42,
				breadcrumbs: [{ label: "站内信" }],
			}),
		),
	);
}

/** Find the delete button (the one that is neither "回复" nor "返回") */
function getDeleteButton(): HTMLElement {
	const buttons = screen.getAllByRole("button");
	const btn = buttons.find(
		(b) => !b.textContent?.includes("回复") && !b.textContent?.includes("返回"),
	);
	expect(btn).toBeTruthy();
	return btn as HTMLElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MessageDetailClient delete toast integration", () => {
	beforeEach(() => {
		vi.mocked(fetchMessage).mockResolvedValue(MOCK_MESSAGE as any);
		vi.mocked(deleteMessage).mockReset();
		mockPush.mockReset();

		// happy-dom doesn't provide confirm/alert; define stubs
		globalThis.confirm = vi.fn(() => true);
		globalThis.alert = vi.fn();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows success toast on delete and navigates to /messages", async () => {
		vi.mocked(deleteMessage).mockResolvedValueOnce(undefined);

		renderMessageDetail();
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(getDeleteButton());
		});

		await waitFor(() => {
			expect(screen.getByText("站内信已删除")).toBeTruthy();
		});
		expect(mockPush).toHaveBeenCalledWith("/messages");
		expect(globalThis.alert).not.toHaveBeenCalled();
	});

	it("shows error toast with ApiError message on delete failure", async () => {
		vi.mocked(deleteMessage).mockRejectedValueOnce(
			new ApiError(403, "FORBIDDEN", "无权删除此消息"),
		);

		renderMessageDetail();
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(getDeleteButton());
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("无权删除此消息"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("删除失败");
		});
		expect(mockPush).not.toHaveBeenCalled();
		expect(globalThis.alert).not.toHaveBeenCalled();
	});

	it("shows fallback error toast on delete non-ApiError failure", async () => {
		vi.mocked(deleteMessage).mockRejectedValueOnce(new Error("network"));

		renderMessageDetail();
		await waitFor(() => {
			expect(screen.getByText("Alice")).toBeTruthy();
		});

		await act(async () => {
			fireEvent.click(getDeleteButton());
		});

		await waitFor(() => {
			const alerts = screen.getAllByRole("alert");
			const errorToast = alerts.find((el) => el.textContent?.includes("删除失败，请重试"));
			expect(errorToast).toBeTruthy();
			expect(errorToast?.textContent).toContain("删除失败");
		});
		expect(mockPush).not.toHaveBeenCalled();
		expect(globalThis.alert).not.toHaveBeenCalled();
	});
});
