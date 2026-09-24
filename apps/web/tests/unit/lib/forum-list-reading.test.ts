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
	it("reuses the warm scoped count when only the display revision changed", async () => {
		mocks.post.mockResolvedValueOnce(response({ display, count: 8 }));
		await loadForumListContext(params);
		mocks.post.mockResolvedValueOnce(response({ display, revision: "b".repeat(64) }));
		expect((await loadForumListContext(params)).total).toBe(8);
		expect(mocks.post.mock.calls[1][1]).toMatchObject({ includeCount: false });
	});
	it("refreshes stats at 6 min and reuses the warm scoped count without re-admit", async () => {
		let now = Date.UTC(2026, 8, 24, 2);
		runtime = new MemoryRuntime({ now: () => now });
		mocks.runtime.mockReturnValue(runtime);
		mocks.post.mockResolvedValueOnce(response({ display, stats, count: 1 }));
		await loadForumListContext(params);
		// 6 min later: site-stats TTL (5 min) expired; thread-count TTL (30 min)
		// and forum-list display TTL (30 min) are still warm. The worker
		// returns no count (bucket+type match, includeCount: false) so the
		// warm scoped count must be reused unchanged.
		now += 6 * 60_000;
		mocks.post.mockResolvedValueOnce(response({}));
		const result = await loadForumListContext(params);
		expect(result.stats).toBeUndefined();
		expect(result.total).toBe(1);
		expect(mocks.post.mock.calls[1][1]).toMatchObject({
			includeDisplay: false,
			includeCount: false,
			includeStats: true,
		});
		// Warm count is preserved untouched (no worker response, no admit).
		expect(runtime.peek("thread-count", threadCountKey(2, null, "member"))).toBe(1);
	});

	it("forces a fresh count and display after the 30 min thread-count TTL elapses", async () => {
		let now = Date.UTC(2026, 8, 24, 2);
		runtime = new MemoryRuntime({ now: () => now });
		mocks.runtime.mockReturnValue(runtime);
		mocks.post.mockResolvedValueOnce(response({ display, stats, count: 1 }));
		await loadForumListContext(params);
		// 31 min later: site-stats, forum-list display and thread-count have all
		// hit their 30 min TTL (stats was already 5 min).
		now += 31 * 60_000;
		mocks.post.mockResolvedValueOnce(response({ display, stats, count: 4 }));
		const result = await loadForumListContext(params);
		expect(result.total).toBe(4);
		expect(mocks.post.mock.calls[1][1]).toMatchObject({
			includeDisplay: true,
			includeCount: true,
			includeStats: true,
		});
	});

	it("restarts cold after a runtime replacement and refills display without count", async () => {
		const now = Date.UTC(2026, 8, 24, 2);
		runtime = new MemoryRuntime({ now: () => now });
		mocks.runtime.mockReturnValue(runtime);
		mocks.post.mockResolvedValueOnce(response({ display, stats, count: 1 }));
		await loadForumListContext(params);
		mocks.runtime.mockReturnValue(new MemoryRuntime());
		mocks.post.mockResolvedValueOnce(response({ display, count: 3 }));
		await loadForumListContext(params);
		expect(mocks.post.mock.calls[1][1]).toMatchObject({
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

it.each([Date.UTC(2026, 8, 24, 1), Date.UTC(2026, 8, 24, 15, 59)])(
	"refreshes expired list display and count after an in-flight boundary from %s",
	async (start) => {
		let now = start;
		runtime = new MemoryRuntime({ now: () => now });
		mocks.runtime.mockReturnValue(runtime);
		mocks.post.mockResolvedValueOnce(response({ display, count: 8, stats }));
		await loadForumListContext(params);
		const expiry = Date.parse(
			runtime.snapshot({ page: 1, limit: 50, family: "thread-count" }).entries[0].expiresAt,
		);
		now = expiry - 1;
		mocks.post.mockImplementationOnce(async () => {
			now = expiry;
			return response();
		});
		mocks.post.mockResolvedValueOnce(response({ display, count: 9 }));
		const result = await loadForumListContext(params);
		expect(result.total).toBe(9);
		expect(result.stats).toBeUndefined();
		expect(mocks.post).toHaveBeenCalledTimes(3);
		expect(mocks.post.mock.calls[2][1]).toMatchObject({
			includeDisplay: true,
			includeCount: true,
			cachedRevision: null,
		});
	},
);

it("refills an invalidated count even when fresh display arrives, with one retry at most", async () => {
	mocks.post.mockResolvedValueOnce(response({ display, count: 8 }));
	await loadForumListContext(params);
	mocks.post.mockImplementationOnce(async () => {
		runtime.clear("thread-count");
		return response({ display });
	});
	mocks.post.mockResolvedValueOnce(response({ display }));
	await expect(loadForumListContext(params)).rejects.toThrow("count");
	expect(mocks.post).toHaveBeenCalledTimes(3);
});
