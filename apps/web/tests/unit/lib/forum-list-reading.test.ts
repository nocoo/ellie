import { forumListCacheKey } from "@ellie/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadForumListContext } from "@/lib/forum-list-reading";
import { MemoryRuntime } from "@/lib/memory-runtime";

const mocks = vi.hoisted(() => ({
	post: vi.fn(),
	jwt: vi.fn(),
	user: vi.fn(),
	runtime: vi.fn(),
	daily: vi.fn(),
}));
vi.mock("@/lib/daily-statistics", () => ({ getDailyStatistics: () => ({ read: mocks.daily }) }));
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
			announcementCount: 0,
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
	mocks.daily.mockResolvedValue({
		stats,
		forums: { 2: { threads: 0, posts: 20, todayThreads: 1, types: { 6: 4 } } },
	});
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
	it("requires fresh display after a bucket change and uses daily normalized category counts", async () => {
		mocks.daily.mockResolvedValue({ stats, forums: { 2: { threads: 8, types: { 6: 4 } } } });
		mocks.post.mockResolvedValueOnce(response({ display }));
		await loadForumListContext(params);
		mocks.post.mockResolvedValueOnce(response({ bucket: "anon" }));
		await expect(loadForumListContext(params)).rejects.toThrow("Incomplete");
		mocks.post.mockResolvedValueOnce(response({ bucket: "anon", display }));
		expect((await loadForumListContext(params)).total).toBe(8);
		mocks.post.mockResolvedValueOnce(response({ display, typeId: 6 }));
		expect((await loadForumListContext({ ...params, typeId: 6 })).total).toBe(4);
		mocks.post.mockResolvedValueOnce(response({ display }));
		expect((await loadForumListContext({ ...params, typeId: 6 })).total).toBe(8);
	});
	it("adds only current authorized announcements to daily local totals across buckets", async () => {
		mocks.daily.mockResolvedValue({ stats, forums: { 2: { threads: 10, types: {} } } });
		for (const [bucket, jwt, role, announcementCount] of [
			["admin", "jwt", 1, 7],
			["anon", null, 0, 1],
			["member", "jwt", 0, 0],
		] as const) {
			mocks.jwt.mockResolvedValue(jwt);
			mocks.user.mockResolvedValue({ role });
			mocks.post.mockResolvedValueOnce(response({ bucket, display, announcementCount }));
			expect((await loadForumListContext(params)).total).toBe(10 + announcementCount);
			expect(mocks.post.mock.lastCall?.[1]).toMatchObject({
				includeCount: false,
				includeStats: false,
			});
		}
		mocks.post.mockRejectedValueOnce(new Error("forbidden"));
		await expect(loadForumListContext(params)).rejects.toThrow("forbidden");
	});
	it("uses zero when statistics are unavailable without requesting a recount", async () => {
		mocks.daily.mockResolvedValue(null);
		mocks.post.mockResolvedValueOnce(response({ display, announcementCount: 1 }));
		const result = await loadForumListContext(params);
		expect(result.total).toBe(1);
		expect(result.stats).toBeUndefined();
		expect(result.display.forums[0]).toMatchObject({ threads: 0, posts: 0, todayThreads: 0 });
		expect(mocks.post.mock.lastCall?.[1].includeCount).toBe(false);
	});
	it("rejects overflow when adding current announcements", async () => {
		mocks.daily.mockResolvedValue({
			stats,
			forums: { 2: { threads: Number.MAX_SAFE_INTEGER, types: {} } },
		});
		mocks.post.mockResolvedValueOnce(response({ display, announcementCount: 1 }));
		await expect(loadForumListContext(params)).rejects.toThrow("count");
	});
	it("does not admit fills racing invalidation and never serves a stale authorization fallback", async () => {
		mocks.post.mockImplementationOnce(async () => {
			runtime.clear("forum-list");
			return response({ display });
		});
		await loadForumListContext(params);
		expect(runtime.peek("forum-list", forumListCacheKey("member", 2, 1, 20, null))).toBeUndefined();
		mocks.post.mockRejectedValueOnce(new Error("denied"));
		await expect(loadForumListContext(params)).rejects.toThrow("denied");
	});
	it("echoes the opaque token across display expiry and never exposes it to the browser", async () => {
		let now = Date.UTC(2026, 8, 24, 2);
		runtime = new MemoryRuntime({ now: () => now });
		mocks.runtime.mockReturnValue(runtime);
		const token = JSON.stringify({ signature: "signed", text: '"'.repeat(90_000) });
		mocks.post.mockResolvedValueOnce(response({ display, readSnapshot: token }));
		const cold = await loadForumListContext(params);
		expect(cold).not.toHaveProperty("readSnapshot");
		for (const minutes of [6, 31, 181, 359]) {
			now = Date.UTC(2026, 8, 24, 2) + minutes * 60_000;
			mocks.post.mockResolvedValueOnce(response({ display }));
			expect((await loadForumListContext(params)).stats).toEqual(stats);
			expect(mocks.post.mock.lastCall?.[1]).toMatchObject({
				cachedRead: token,
				includeCount: false,
				includeStats: false,
			});
		}
		mocks.runtime.mockReturnValue(new MemoryRuntime());
		mocks.post.mockResolvedValueOnce(response({ display }));
		await loadForumListContext(params);
		expect(mocks.post.mock.lastCall?.[1]).toMatchObject({
			cachedRead: null,
			cachedRevision: null,
			includeDisplay: true,
		});
	});
	it("stores a snapshot under the authoritative bucket and normalized category", async () => {
		mocks.post.mockResolvedValueOnce(response({ display, bucket: "anon", readSnapshot: "token" }));
		await loadForumListContext({ ...params, typeId: 6 });
		expect(runtime.peek("forum-read", forumListCacheKey("anon", 2, 1, 20, null))).toBe("token");
		expect(runtime.peek("forum-read", forumListCacheKey("member", 2, 1, 20, 6))).toBeUndefined();
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
		{ count: "1" },
		{ announcementCount: undefined },
		{ announcementCount: -1 },
		{ announcementCount: 1.5 },
		{ announcementCount: "1" },
		{ announcementCount: Number.MAX_SAFE_INTEGER + 1 },
		{ count: 1, announcementCount: 2 },
	])("rejects inconsistent response %j", async (extra) => {
		mocks.post.mockResolvedValue(response({ display, count: 0, ...extra }));
		await expect(loadForumListContext(params)).rejects.toThrow();
	});
	it("rejects an announcement contribution on a type-filtered response", async () => {
		mocks.post.mockResolvedValueOnce(
			response({ display, typeId: 6, count: 2, announcementCount: 1 }),
		);
		await expect(loadForumListContext({ ...params, typeId: 6 })).rejects.toThrow("context");
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

it.each(["clear", "expire"])(
	"refills display once after an in-flight %s without recounting",
	async (action) => {
		let now = Date.UTC(2026, 8, 24, 2);
		runtime = new MemoryRuntime({ now: () => now });
		mocks.runtime.mockReturnValue(runtime);
		mocks.daily.mockResolvedValue({ stats, forums: { 2: { threads: 8, types: {} } } });
		mocks.post.mockResolvedValueOnce(response({ display }));
		await loadForumListContext(params);
		mocks.post.mockImplementationOnce(async () => {
			if (action === "clear") runtime.clear("forum-list");
			else now += 30 * 60_000;
			return response();
		});
		mocks.post.mockResolvedValueOnce(response({ display }));
		expect((await loadForumListContext(params)).total).toBe(8);
		expect(mocks.post).toHaveBeenCalledTimes(3);
		expect(mocks.post.mock.lastCall?.[1]).toMatchObject({
			includeDisplay: true,
			includeCount: false,
			cachedRevision: null,
		});
	},
);

it("stops after one display retry when fresh display is missing", async () => {
	mocks.post.mockResolvedValueOnce(response({ display }));
	await loadForumListContext(params);
	mocks.post.mockImplementationOnce(async () => {
		runtime.clear("forum-list");
		return response();
	});
	mocks.post.mockResolvedValueOnce(response());
	await expect(loadForumListContext(params)).rejects.toThrow("Incomplete");
	expect(mocks.post).toHaveBeenCalledTimes(3);
});
