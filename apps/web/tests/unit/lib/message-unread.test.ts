import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	userId: 1 as number | null,
	jwt: "token" as string | null,
	get: vi.fn(),
	post: vi.fn(),
	remove: vi.fn(),
}));
vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: async () => mocks.jwt,
	getCurrentForumUser: async () => (mocks.userId === null ? null : { userId: mocks.userId }),
}));
vi.mock("@/lib/forum-api", async (original) => {
	const actual = await original<typeof import("@/lib/forum-api")>();
	return {
		...actual,
		forumApi: {
			...actual.forumApi,
			getAuth: mocks.get,
			postAuth: mocks.post,
			deleteAuth: mocks.remove,
		},
	};
});

async function open() {
	const cache = await import("@/lib/message-unread");
	const route = await import("@/app/api/v1/messages/unread-count/route");
	const get = () =>
		route.GET(new NextRequest("https://example.com/api/v1/messages/unread-count"), {
			params: Promise.resolve({}),
		});
	return { ...cache, get };
}

beforeEach(() => {
	vi.resetModules();
	Reflect.deleteProperty(globalThis, "__ellieMessageUnread");
	mocks.userId = 1;
	mocks.jwt = "token";
	mocks.get.mockReset().mockResolvedValue({ data: { count: 3 } });
	mocks.post.mockReset().mockResolvedValue({ data: { receiverId: 2 } });
	mocks.remove.mockReset().mockResolvedValue({ data: {} });
});

describe("private unread estimates", () => {
	it("uses per-account memory for an hour across token refresh and rejects logged-out reads", async () => {
		let now = 1_000_000;
		const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
		try {
			const { get, MESSAGE_UNREAD_INTERVAL_MS } = await open();
			expect((await (await get()).json()).data.count).toBe(3);
			mocks.jwt = "new token";
			now += MESSAGE_UNREAD_INTERVAL_MS - 1;
			const warm = await get();
			expect(warm.headers.get("Cache-Control")).toBe("private, no-store");
			expect(mocks.get).toHaveBeenCalledTimes(1);
			now++;
			await get();
			expect(mocks.get).toHaveBeenCalledTimes(2);
			mocks.userId = 2;
			mocks.get.mockResolvedValueOnce({ data: { count: 8 } });
			expect((await (await get()).json()).data.count).toBe(8);
			mocks.userId = 1;
			expect((await (await get()).json()).data.count).toBe(3);
			mocks.jwt = null;
			expect((await get()).status).toBe(401);
			expect(mocks.get).toHaveBeenCalledTimes(3);
		} finally {
			clock.mockRestore();
		}
	});

	it("coalesces concurrent requests and retries a rejected or invalid load", async () => {
		const { readUnreadEstimate } = await open();
		mocks.get.mockRejectedValueOnce(new Error("Worker unavailable"));
		await expect(Promise.all([readUnreadEstimate(), readUnreadEstimate()])).rejects.toThrow(
			"Worker unavailable",
		);
		expect(mocks.get).toHaveBeenCalledTimes(1);
		mocks.get.mockResolvedValueOnce({ data: { count: -1 } });
		await expect(readUnreadEstimate()).rejects.toThrow("Invalid unread");
		expect((await readUnreadEstimate()).data.count).toBe(3);
		expect(mocks.get).toHaveBeenCalledTimes(3);
	});

	it("invalidates mailbox activity and a newly messaged recipient without cross-account results", async () => {
		const { readUnreadEstimate, invalidateUnreadEstimate } = await open();
		await readUnreadEstimate();
		mocks.userId = 2;
		await readUnreadEstimate();
		mocks.userId = 1;
		await invalidateUnreadEstimate(2);
		mocks.get.mockResolvedValueOnce({ data: { count: 1 } });
		expect((await readUnreadEstimate()).data.count).toBe(1);
		mocks.userId = 2;
		mocks.get.mockResolvedValueOnce({ data: { count: 4 } });
		expect((await readUnreadEstimate()).data.count).toBe(4);
		expect(mocks.get).toHaveBeenCalledTimes(4);
	});

	it("shares one process cache across separate route module instances", async () => {
		const first = await open();
		await first.readUnreadEstimate();
		vi.resetModules();
		const second = await open();
		await second.readUnreadEstimate();
		expect(mocks.get).toHaveBeenCalledTimes(1);
		await second.invalidateUnreadEstimate();
		await first.readUnreadEstimate();
		expect(mocks.get).toHaveBeenCalledTimes(2);
	});

	it("invalidates only successful mailbox proxy reads and mutations", async () => {
		const { readUnreadEstimate } = await open();
		const list = await import("@/app/api/v1/messages/route");
		const detail = await import("@/app/api/v1/messages/[id]/route");
		const mark = await import("@/app/api/v1/messages/mark-all-read/route");
		const { ForumApiError } = await import("@/lib/forum-api");
		const req = (method: string, body?: unknown) =>
			new Request("http://localhost:7031/api/v1/messages", {
				method,
				headers: { Origin: "http://localhost:7031", "Content-Type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		const params = { params: Promise.resolve({ id: "5" }) };
		await readUnreadEstimate();
		expect((await list.GET(req("GET"))).status).toBe(200);
		await readUnreadEstimate();
		expect(mocks.get).toHaveBeenCalledTimes(3);
		expect((await detail.GET(req("GET"), params)).status).toBe(200);
		await readUnreadEstimate();
		expect(mocks.get).toHaveBeenCalledTimes(5);
		mocks.remove.mockRejectedValueOnce(new ForumApiError(404, "MESSAGE_NOT_FOUND", "Not found"));
		expect((await detail.DELETE(req("DELETE"), params)).status).toBe(404);
		await readUnreadEstimate();
		expect(mocks.get).toHaveBeenCalledTimes(5);
		expect((await detail.DELETE(req("DELETE"), params)).status).toBe(200);
		await readUnreadEstimate();
		expect(mocks.get).toHaveBeenCalledTimes(6);
		expect((await mark.POST(req("POST", {}))).status).toBe(200);
		await readUnreadEstimate();
		expect(mocks.get).toHaveBeenCalledTimes(7);
		expect((await list.POST(req("POST", { receiverId: 2, content: "Message" }))).status).toBe(201);
		await readUnreadEstimate();
		expect(mocks.get).toHaveBeenCalledTimes(8);
	});

	it("bounds the account budget and fails closed for absent or malformed session identity", async () => {
		const { readUnreadEstimate, MESSAGE_UNREAD_MAX_ACCOUNTS } = await open();
		for (let id = 1; id <= MESSAGE_UNREAD_MAX_ACCOUNTS + 1; id++) {
			mocks.userId = id;
			await readUnreadEstimate();
		}
		mocks.userId = 1;
		await readUnreadEstimate();
		expect(mocks.get).toHaveBeenCalledTimes(MESSAGE_UNREAD_MAX_ACCOUNTS + 2);
		mocks.userId = null;
		await expect(readUnreadEstimate()).rejects.toMatchObject({ status: 401 });
		mocks.userId = Number.NaN;
		await expect(readUnreadEstimate()).rejects.toMatchObject({ status: 401 });
	});
});
