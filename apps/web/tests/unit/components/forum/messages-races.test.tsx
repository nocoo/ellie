// @vitest-environment happy-dom
// Independent review: real components, confirmation dialog and message viewmodel.
// Only API transport, route navigation and unrelated dialog/avatar surfaces are fixtures.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get, post, remove, router } = vi.hoisted(() => ({
	get: vi.fn(),
	post: vi.fn(),
	remove: vi.fn(),
	router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));

vi.mock("@/lib/api-client", async (original) => ({
	...(await original<Record<string, unknown>>()),
	apiClient: { get, post, delete: remove },
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next-auth/react", () => ({
	useSession: () => ({ data: { user: { id: "20", role: 0 } } }),
}));
vi.mock("next/link", () => ({
	default: ({ href, prefetch: _, ...props }: any) => <a href={href} {...props} />,
}));
vi.mock("@/components/forum/compose-message-dialog", () => ({ ComposeMessageDialog: () => null }));
vi.mock("@/components/forum/user-avatar", () => ({
	ForumAvatar: () => <span aria-hidden="true" />,
}));

import { ForumToastProvider } from "@/components/forum/forum-toast";
import { MessageDetailClient } from "@/components/forum/message-detail";
import { MessagesPageClient } from "@/components/forum/messages-page";

const incoming = {
	id: 42,
	senderId: 10,
	senderName: "Alice",
	receiverId: 20,
	receiverName: "Bob",
	subject: "Incoming message",
	content: "Received message content",
	preview: "Received message content",
	isRead: false,
	createdAt: 1700000000,
};
const outgoing = {
	...incoming,
	id: 99,
	senderId: 20,
	senderName: "Bob",
	receiverId: 30,
	receiverName: "Carol",
	subject: "Unread outgoing message",
};

beforeEach(() => {
	vi.clearAllMocks();
	get.mockImplementation(async (path, params) => {
		if (path === "/api/v1/messages/42") return { data: structuredClone(incoming) };
		if (path === "/api/v1/messages/unread-count") return { data: { count: 1 } };
		if (path === "/api/v1/messages") {
			return {
				data: [structuredClone(params.box === "outbox" ? outgoing : incoming)],
				meta: { nextCursor: null, unreadCount: params.box === "outbox" ? undefined : 1 },
			};
		}
		throw new Error(`Unexpected fixture request: ${path}`);
	});
	remove.mockResolvedValue({ data: null });
	post.mockResolvedValue({ data: null });
});
afterEach(cleanup);

describe("Independent message async review", () => {
	it("does not submit another delete while the successful navigation is pending", async () => {
		let finishDelete!: (value: unknown) => void;
		remove.mockReturnValueOnce(
			new Promise((resolve) => {
				finishDelete = resolve;
			}),
		);
		render(
			<ForumToastProvider>
				<MessageDetailClient messageId={42} breadcrumbs={[{ label: "站内信" }]} />
			</ForumToastProvider>,
		);
		await screen.findByText("Alice");
		fireEvent.click(screen.getByRole("button", { name: "删除站内信" }));
		fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
		expect(remove).toHaveBeenCalledExactlyOnceWith("/api/v1/messages/42");
		expect(screen.getByRole("button", { name: "确认删除" }).hasAttribute("disabled")).toBe(true);
		await act(async () => {
			finishDelete({ data: null });
		});
		expect(router.push).toHaveBeenCalledExactlyOnceWith("/messages");
		await screen.findByText("站内信已删除");
		// Next router.push returns void. The old screen can remain mounted while
		// the next route is loading; do not unmount it in the navigation fixture.
		const confirmation = screen.queryByRole("button", { name: "确认删除" });
		if (confirmation && !confirmation.hasAttribute("disabled")) {
			await act(async () => {
				fireEvent.click(confirmation);
			});
		}
		expect(remove).toHaveBeenCalledTimes(1);
	});

	it("does not claim the recipient read outgoing mail when marking the inbox read finishes late", async () => {
		let finishMarking!: (value: unknown) => void;
		post.mockReturnValueOnce(
			new Promise((resolve) => {
				finishMarking = resolve;
			}),
		);
		render(
			<ForumToastProvider>
				<MessagesPageClient initialBox="inbox" breadcrumbs={[{ label: "站内信" }]} />
			</ForumToastProvider>,
		);
		await screen.findByText("Incoming message");
		fireEvent.click(screen.getByRole("button", { name: "全部已读" }));
		expect(post).toHaveBeenCalledExactlyOnceWith("/api/v1/messages/mark-all-read", {});
		fireEvent.click(screen.getByRole("button", { name: "发信箱" }));
		await screen.findByText("Unread outgoing message");
		expect(screen.getByText("未读", { exact: true })).toBeTruthy();
		await act(async () => {
			finishMarking({ data: null });
		});
		expect(screen.getByText("Unread outgoing message")).toBeTruthy();
		expect(screen.queryByText("已读", { exact: true })).toBeNull();
		expect(screen.getByText("未读", { exact: true })).toBeTruthy();
	});
});
