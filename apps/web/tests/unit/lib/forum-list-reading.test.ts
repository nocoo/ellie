import { forumListCacheKey } from "@ellie/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadForumListContext } from "@/lib/forum-list-reading";
import { threadCountKey } from "@/lib/forum-reading";
import { MemoryRuntime } from "@/lib/memory-runtime";

const mocks = vi.hoisted(() => ({ post: vi.fn(), jwt: vi.fn(), user: vi.fn(), runtime: vi.fn() }));
vi.mock("@/lib/forum-api", () => ({ forumApi: { postRead: mocks.post } }));
vi.mock("@/lib/forum-auth", () => ({ getWorkerJwt: mocks.jwt, getCurrentForumUser: mocks.user }));
vi.mock("@/lib/memory-runtime", async (original) => ({
	...(await original<object>()),
	getMemoryRuntime: mocks.runtime,
}));

const params = { forumId: 2, page: 1, limit: 20, typeId: null };
const revision = "a".repeat(64);
const display = {
	forums: [{ id: 2, name: "Forum" }],
	threads: [],
	threadTypes: { enabled: false, types: [] },
	recommended: [],
};
const stats = { totalThreads: 10 };
function response(extra = {}) {
	return {
		data: {
			bucket: "member",
			user: null,
			revision,
			page: 1,
			limit: 20,
			typeId: null,
			hasNext: false,
			...extra,
		},
	};
}
let runtime: MemoryRuntime;
beforeEach(() => {
	vi.clearAllMocks();
	runtime = new MemoryRuntime();
	mocks.runtime.mockReturnValue(runtime);
	mocks.jwt.mockResolvedValue("jwt");
	mocks.user.mockResolvedValue({ role: 0 });
});

describe("forum list context", () => {
	it("reads once cold and once warm without caching identity or renewing display TTL", async () => {
		mocks.post.mockResolvedValueOnce(response({ display, stats, count: 0, user: { id: 7 } }));
		expect((await loadForumListContext(params)).user).toEqual({ id: 7 });
		const key = forumListCacheKey("member", 2, 1, 20, null);
		expect(runtime.peek("forum-list", key)).toEqual({ display, revision });
		const admit = vi.spyOn(runtime, "admit");
		mocks.post.mockResolvedValueOnce(response({ user: { id: 8 } }));
		const hot = await loadForumListContext(params);
		expect(hot.user).toEqual({ id: 8 });
		expect(hot.total).toBe(0);
		expect(hot.stats).toEqual(stats);
		expect(mocks.post).toHaveBeenCalledTimes(2);
		expect(mocks.post.mock.calls[1][1]).toMatchObject({
			cachedRevision: revision,
			includeDisplay: false,
			includeCount: false,
			includeStats: false,
		});
		expect(admit).not.toHaveBeenCalled();
	});
	it("requires fresh display and count after bucket or category changes", async () => {
		mocks.post.mockResolvedValueOnce(response({ display, count: 8 }));
		await loadForumListContext(params);
		mocks.post.mockResolvedValueOnce(response({ bucket: "anon" }));
		await expect(loadForumListContext(params)).rejects.toThrow("Incomplete");
		mocks.post.mockResolvedValueOnce(response({ bucket: "anon", display }));
		await expect(loadForumListContext(params)).rejects.toThrow("count");
		mocks.post.mockResolvedValueOnce(response({ bucket: "anon", display, count: 2 }));
		expect((await loadForumListContext(params)).total).toBe(2);
		mocks.post.mockResolvedValueOnce(response({ display, count: 3 }));
		expect((await loadForumListContext({ ...params, typeId: 6 })).typeId).toBeNull();
		expect(runtime.peek("thread-count", threadCountKey(2, null, "member"))).toBe(3);
	});
	it("does not admit fills racing invalidation and never serves a stale fallback", async () => {
		mocks.post.mockImplementationOnce(async () => {
			runtime.clear("forum-list");
			return response({ display, count: 1 });
		});
		expect((await loadForumListContext(params)).total).toBe(1);
		expect(runtime.peek("forum-list", forumListCacheKey("member", 2, 1, 20, null))).toBeUndefined();
		mocks.post.mockRejectedValueOnce(new Error("denied"));
		await expect(loadForumListContext(params)).rejects.toThrow("denied");
	});
	it("requires a fresh count with a display refill even when the count cache is warm", async () => {
		mocks.post.mockResolvedValueOnce(response({ display, count: 8 }));
		await loadForumListContext(params);
		mocks.post.mockResolvedValueOnce(response({ display, revision: "b".repeat(64) }));
		await expect(loadForumListContext(params)).rejects.toThrow("count");
	});
	it("restarts cold and refreshes stats/count without refilling warm display", async () => {
		let now = Date.UTC(2026, 8, 24, 2);
		runtime = new MemoryRuntime({ now: () => now });
		mocks.runtime.mockReturnValue(runtime);
		mocks.post.mockResolvedValueOnce(response({ display, stats, count: 1 }));
		await loadForumListContext(params);
		now += 6 * 60_000;
		mocks.post.mockResolvedValueOnce(response({ count: 3 }));
		expect((await loadForumListContext(params)).stats).toBeUndefined();
		expect(mocks.post.mock.calls[1][1]).toMatchObject({
			includeDisplay: false,
			includeCount: true,
			includeStats: true,
		});
		mocks.runtime.mockReturnValue(new MemoryRuntime());
		mocks.post.mockResolvedValueOnce(response({ display, count: 3 }));
		await loadForumListContext(params);
		expect(mocks.post.mock.calls[2][1]).toMatchObject({
			includeDisplay: true,
			cachedRevision: null,
		});
	});
	it("bounds in-flight contexts before cloning and never shares user responses", async () => {
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		mocks.post.mockImplementation(async () => {
			await held;
			return response({ display, count: 0 });
		});
		const pending = Array.from({ length: 64 }, () => loadForumListContext(params));
		await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(64));
		await expect(loadForumListContext(params)).rejects.toThrow("capacity");
		release();
		await Promise.all(pending);
		expect(mocks.post).toHaveBeenCalledTimes(64);
	});

	it.each([
		{ bucket: "bad" },
		{ page: 2 },
		{ limit: 1 },
		{ typeId: 3 },
		{ hasNext: 0 },
		{ revision: "bad" },
		{ display: { ...display, forums: [] } },
		{ display: { ...display, threads: Array(21).fill({}) } },
		{ display: { ...display, recommended: Array(7).fill({}) } },
		{ display: { ...display, threadTypes: null } },
		{ count: -1 },
		{ count: 1.5 },
	])("rejects inconsistent response %j", async (extra) => {
		mocks.post.mockResolvedValue(response({ display, count: 0, ...extra }));
		await expect(loadForumListContext(params)).rejects.toThrow();
	});
	it.each([
		[null, 0, "anon"],
		["jwt", 1, "admin"],
		["jwt", 2, "staff"],
		["jwt", 3, "staff"],
	])("uses role only as a hint", async (jwt, role, bucket) => {
		mocks.jwt.mockResolvedValue(jwt);
		mocks.user.mockResolvedValue({ role });
		mocks.post.mockResolvedValue(response({ bucket, display, count: 0 }));
		await loadForumListContext(params);
		expect(mocks.post.mock.calls[0][1].cachedBucket).toBe(bucket);
	});
});
