// @vitest-environment happy-dom
// Tests that write-gate preflight blocks message compose/reply from opening.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Write-gate mock (controllable) ─────────────────────────────────────────

const mockWriteGatePreflight = vi.fn(() => Promise.resolve(false));
vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: (...args: any[]) => mockWriteGatePreflight(...args),
}));

// ─── Shared mocks ───────────────────────────────────────────────────────────

const mockRouterPush = vi.fn();
const mockRouterReplace = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
}));

vi.mock("next-auth/react", () => ({
	useSession: () => ({ data: { user: { id: "20" } } }),
}));

vi.mock("next/link", () => ({
	default: ({ children, href, ...props }: any) => createElement("a", { href, ...props }, children),
}));

// Mock messages viewmodel
vi.mock("@/viewmodels/forum/messages", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		fetchMessages: vi.fn().mockResolvedValue({ messages: [], nextCursor: null }),
		fetchUnreadCount: vi.fn().mockResolvedValue(0),
		fetchMessage: vi.fn().mockResolvedValue({
			id: 42,
			senderId: 10,
			senderName: "Alice",
			receiverId: 20,
			receiverName: "Bob",
			subject: "Hello",
			content: "Hi there",
			isRead: true,
			createdAt: 1700000000,
		}),
		deleteMessage: vi.fn(),
		markAllMessagesRead: vi.fn(),
		searchUsers: vi.fn().mockResolvedValue([]),
		sendMessage: vi.fn(),
	};
});

// Mock ComposeMessageDialog to detect open state
const composeDialogProps = vi.fn();
vi.mock("@/components/forum/compose-message-dialog", () => ({
	ComposeMessageDialog: (props: any) => {
		composeDialogProps(props);
		return props.open ? createElement("div", { "data-testid": "compose-dialog" }) : null;
	},
}));

// Mock BreadcrumbBar
vi.mock("@/components/forum/breadcrumb-bar", () => ({
	BreadcrumbBar: () => null,
}));

// Mock ForumAvatar
vi.mock("@/components/forum/user-avatar", () => ({
	ForumAvatar: () => createElement("div", { "data-testid": "avatar" }),
}));

// ─── Imports ────────────────────────────────────────────────────────────────

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { MessageDetailClient } from "@/components/forum/message-detail";
import { MessagesPageClient } from "@/components/forum/messages-page";

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Message entry points write-gate integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockWriteGatePreflight.mockResolvedValue(false); // default: allowed
	});
	afterEach(cleanup);

	describe("MessagesPageClient compose button", () => {
		function renderPage(props: Record<string, unknown> = {}) {
			return render(
				createElement(
					ForumToastProvider,
					null,
					createElement(MessagesPageClient, {
						breadcrumbs: [{ label: "站内信" }],
						...props,
					}),
				),
			);
		}

		it("opens compose dialog when write-gate allows", async () => {
			renderPage();
			const composeBtn = screen.getByText("写站内信");
			fireEvent.click(composeBtn);

			await waitFor(() => {
				expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
			});
			await waitFor(() => {
				expect(screen.getByTestId("compose-dialog")).toBeTruthy();
			});
		});

		it("does NOT open compose dialog when write-gate blocks", async () => {
			mockWriteGatePreflight.mockResolvedValue(true); // blocked
			renderPage();

			const composeBtn = screen.getByText("写站内信");
			fireEvent.click(composeBtn);

			await waitFor(() => {
				expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
			});
			expect(screen.queryByTestId("compose-dialog")).toBeNull();
		});

		it("does NOT open compose dialog for initialRecipient when write-gate blocks", async () => {
			mockWriteGatePreflight.mockResolvedValue(true); // blocked
			renderPage({ initialRecipient: { id: 10, username: "Alice" } });

			await waitFor(() => {
				expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
			});
			// URL should be cleaned up
			await waitFor(() => {
				expect(mockRouterReplace).toHaveBeenCalledWith("/messages", { scroll: false });
			});
			expect(screen.queryByTestId("compose-dialog")).toBeNull();
		});
	});

	describe("MessageDetailClient reply button", () => {
		function renderDetail() {
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

		it("opens reply dialog when write-gate allows", async () => {
			renderDetail();

			// Wait for message to load
			await waitFor(() => {
				expect(screen.getByText("回复")).toBeTruthy();
			});

			fireEvent.click(screen.getByText("回复"));

			await waitFor(() => {
				expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
			});
			await waitFor(() => {
				expect(screen.getByTestId("compose-dialog")).toBeTruthy();
			});
		});

		it("does NOT open reply dialog when write-gate blocks", async () => {
			mockWriteGatePreflight.mockResolvedValue(true); // blocked
			renderDetail();

			// Wait for message to load
			await waitFor(() => {
				expect(screen.getByText("回复")).toBeTruthy();
			});

			fireEvent.click(screen.getByText("回复"));

			await waitFor(() => {
				expect(mockWriteGatePreflight).toHaveBeenCalledWith(null, "message");
			});
			expect(screen.queryByTestId("compose-dialog")).toBeNull();
		});
	});
});
