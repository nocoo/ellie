import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-client", () => {
	class ApiError extends Error {
		status: number;
		constructor(m: string, s: number) {
			super(m);
			this.status = s;
		}
	}
	return {
		apiClient: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
		ApiError,
	};
});

import { ApiError, apiClient } from "@/lib/api-client";
import {
	buildMessagesBreadcrumbs,
	deleteMessage,
	fetchMessage,
	fetchMessages,
	fetchUnreadCount,
	markAllMessagesRead,
	SIDEBAR_ITEMS,
	searchUsers,
	sendMessage,
} from "@/viewmodels/forum/messages";

const mockClient = apiClient as any;

describe("fetchMessages", () => {
	beforeEach(() => vi.clearAllMocks());

	it("fetches inbox messages with default params", async () => {
		mockClient.get.mockResolvedValue({
			data: [{ id: 1 }],
			meta: { nextCursor: "c1", unreadCount: 3 },
		});
		const result = await fetchMessages();
		expect(mockClient.get).toHaveBeenCalledWith("/api/v1/messages", { box: "inbox", limit: 20 });
		expect(result.messages).toEqual([{ id: 1 }]);
		expect(result.nextCursor).toBe("c1");
		expect(result.unreadCount).toBe(3);
	});

	it("fetches outbox with cursor", async () => {
		mockClient.get.mockResolvedValue({ data: [], meta: {} });
		const result = await fetchMessages("outbox", "xyz", 10);
		expect(mockClient.get).toHaveBeenCalledWith("/api/v1/messages", {
			box: "outbox",
			limit: 10,
			cursor: "xyz",
		});
		expect(result.nextCursor).toBeNull();
		expect(result.unreadCount).toBeUndefined();
	});
});

describe("fetchUnreadCount", () => {
	it("returns count from API", async () => {
		mockClient.get.mockResolvedValue({ data: { count: 5 } });
		expect(await fetchUnreadCount()).toBe(5);
	});

	it("returns 0 on error", async () => {
		mockClient.get.mockRejectedValue(new Error("fail"));
		expect(await fetchUnreadCount()).toBe(0);
	});
});

describe("fetchMessage", () => {
	it("returns message detail", async () => {
		const msg = { id: 1, subject: "Hi", content: "Body" };
		mockClient.get.mockResolvedValue({ data: msg });
		expect(await fetchMessage(1)).toEqual(msg);
		expect(mockClient.get).toHaveBeenCalledWith("/api/v1/messages/1");
	});
});

describe("sendMessage", () => {
	it("posts message and returns result", async () => {
		const result = { id: 10, receiverId: 2, receiverName: "bob", subject: "", createdAt: 1000 };
		mockClient.post.mockResolvedValue({ data: result });
		expect(await sendMessage({ receiverId: 2, content: "hello" })).toEqual(result);
		expect(mockClient.post).toHaveBeenCalledWith("/api/v1/messages", {
			receiverId: 2,
			content: "hello",
		});
	});
});

describe("deleteMessage", () => {
	it("calls delete endpoint", async () => {
		mockClient.delete.mockResolvedValue(undefined);
		await deleteMessage(5);
		expect(mockClient.delete).toHaveBeenCalledWith("/api/v1/messages/5");
	});
});

describe("markAllMessagesRead", () => {
	it("calls mark-all-read endpoint", async () => {
		mockClient.post.mockResolvedValue(undefined);
		await markAllMessagesRead();
		expect(mockClient.post).toHaveBeenCalledWith("/api/v1/messages/mark-all-read", {});
	});
});

describe("searchUsers", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns empty array for short query", async () => {
		expect(await searchUsers("a")).toEqual([]);
		expect(mockClient.get).not.toHaveBeenCalled();
	});

	it("returns empty array for empty query", async () => {
		expect(await searchUsers("")).toEqual([]);
	});

	it("fetches users for valid query", async () => {
		mockClient.get.mockResolvedValue({ data: [{ id: 1, username: "alice" }] });
		const result = await searchUsers("al");
		expect(result).toEqual([{ id: 1, username: "alice" }]);
		expect(mockClient.get).toHaveBeenCalledWith("/api/v1/users/search", { q: "al", limit: 10 });
	});

	it("returns empty array on 400 ApiError", async () => {
		mockClient.get.mockRejectedValue(new ApiError("bad", 400));
		expect(await searchUsers("test")).toEqual([]);
	});

	it("rethrows non-400 errors", async () => {
		const err = new ApiError("server error", 500);
		mockClient.get.mockRejectedValue(err);
		await expect(searchUsers("test")).rejects.toThrow("server error");
	});

	it("rethrows non-ApiError errors", async () => {
		mockClient.get.mockRejectedValue(new Error("network"));
		await expect(searchUsers("test")).rejects.toThrow("network");
	});

	it("passes custom limit", async () => {
		mockClient.get.mockResolvedValue({ data: [] });
		await searchUsers("test", 5);
		expect(mockClient.get).toHaveBeenCalledWith("/api/v1/users/search", { q: "test", limit: 5 });
	});
});

describe("buildMessagesBreadcrumbs", () => {
	it("returns home and messages breadcrumbs with default label", () => {
		const bc = buildMessagesBreadcrumbs();
		expect(bc).toEqual([{ label: "同济网论坛", href: "/" }, { label: "站内信" }]);
	});

	it("uses custom homeLabel when provided", () => {
		const bc = buildMessagesBreadcrumbs("My Forum");
		expect(bc[0].label).toBe("My Forum");
	});
});

describe("SIDEBAR_ITEMS", () => {
	it("has inbox and outbox", () => {
		expect(SIDEBAR_ITEMS.length).toBe(2);
		expect(SIDEBAR_ITEMS[0].value).toBe("inbox");
		expect(SIDEBAR_ITEMS[1].value).toBe("outbox");
	});
});
