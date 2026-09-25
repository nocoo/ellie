import { EMPTY_HOME_STATS } from "@ellie/types";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRuntime } from "@/lib/memory-runtime";
import { loadThreadContext } from "@/lib/thread-reading";

const mocks = vi.hoisted(() => ({
	post: vi.fn(),
	postAuth: vi.fn(),
	jwt: vi.fn(),
	runtime: vi.fn(),
	statistics: vi.fn(),
}));
vi.mock("@/lib/daily-statistics", () => ({
	getDailyStatistics: () => ({ read: mocks.statistics }),
}));
vi.mock("@/lib/forum-api", () => ({ forumApi: { post: mocks.post, postAuth: mocks.postAuth } }));
vi.mock("@/lib/forum-auth", () => ({ getWorkerJwt: mocks.jwt }));
vi.mock("@/lib/memory-runtime", async (original) => ({
	...(await original<object>()),
	getMemoryRuntime: mocks.runtime,
}));

const stats = { ...EMPTY_HOME_STATS, totalThreads: 9 };
const daily = { stats, forums: {} };
const params = { threadId: 4, limit: 20, cursor: null, last: false };
const revision = "a".repeat(64);
const display = {
	forum: { id: 2 },
	posts: [{ id: 1, threadId: 4, content: "public" }],
	authors: [],
	attachments: [],
	ancestors: [],
};
function response(extra = {}) {
	return {
		data: {
			thread: { id: 4, forumId: 2, views: 10 },
			user: null,
			revision,
			cacheable: true,
			nextCursor: null,
			...extra,
		},
	};
}
let runtime: MemoryRuntime;
beforeEach(() => {
	vi.clearAllMocks();
	runtime = new MemoryRuntime();
	mocks.runtime.mockReturnValue(runtime);
	mocks.jwt.mockResolvedValue(null);
	mocks.statistics.mockReset().mockResolvedValue(daily);
});

it("always checks authority and preserves fresh identity/header outside the stored display", async () => {
	mocks.post.mockResolvedValueOnce(response({ display, stats: { totalThreads: 999 } }));
	await loadThreadContext(params);
	const admit = vi.spyOn(runtime, "admit");
	mocks.jwt.mockResolvedValue("jwt");
	mocks.postAuth.mockResolvedValueOnce(
		response({ user: { id: 8 }, thread: { id: 4, forumId: 2, views: 20 } }),
	);
	const hit = await loadThreadContext(params);
	expect(hit.thread.views).toBe(20);
	expect(hit.user).toEqual({ id: 8 });
	expect(hit.display).toEqual(display);
	expect(hit.stats).toEqual(stats);
	expect(mocks.post.mock.calls[0][1]).toMatchObject({ includeStats: false });
	expect(mocks.postAuth.mock.calls[0][1]).toMatchObject({
		includeDisplay: false,
		cachedRevision: revision,
		includeStats: false,
	});
	expect(admit).not.toHaveBeenCalled();
	expect(runtime.peek("thread-detail", "thread:4")).toEqual({
		selection: "thread:4:limit:20:cursor:start:mode:forward",
		display,
		revision,
	});
});

it("serves verified content without daily stats and ignores unsolicited Worker statistics", async () => {
	mocks.statistics.mockResolvedValueOnce(null);
	mocks.post.mockResolvedValueOnce(response({ display, stats: { totalThreads: 999 } }));
	const result = await loadThreadContext(params);
	expect(result.display).toEqual(display);
	expect(result.stats).toBeUndefined();
	expect(mocks.post.mock.calls[0][1]).toMatchObject({ includeStats: false });
});

it("never uses or admits the shared snapshot for an unmasked owner or privileged viewer", async () => {
	mocks.post.mockResolvedValueOnce(response({ display }));
	await loadThreadContext(params);
	mocks.post.mockResolvedValueOnce(response({ cacheable: false }));
	await expect(loadThreadContext(params)).rejects.toThrow("Incomplete");
	const privateDisplay = { ...display, authors: [{ id: 9 }] };
	mocks.post.mockResolvedValueOnce(response({ cacheable: false, display: privateDisplay }));
	expect((await loadThreadContext(params)).display).toEqual(privateDisplay);
	expect(runtime.peek<{ display: unknown }>("thread-detail", "thread:4")?.display).toEqual(display);
});

it("retains only the latest selection for a thread and rejects an omitted replacement", async () => {
	mocks.post.mockResolvedValueOnce(response({ display }));
	await loadThreadContext(params);
	mocks.post.mockResolvedValueOnce(response());
	await expect(loadThreadContext({ ...params, last: true })).rejects.toThrow("Incomplete");
	expect(mocks.post.mock.calls[1][1]).toMatchObject({ cachedRevision: null, includeDisplay: true });
	mocks.post.mockResolvedValueOnce(response({ display: { ...display, posts: [] } }));
	await loadThreadContext({ ...params, last: true });
	expect(runtime.snapshot({ page: 1, limit: 50, family: "thread-detail" }).pagination.total).toBe(
		1,
	);
	mocks.post.mockResolvedValueOnce(response());
	await expect(loadThreadContext(params)).rejects.toThrow("Incomplete");
});

it("rejects changed gates and Worker errors instead of serving a stale snapshot", async () => {
	mocks.post.mockResolvedValueOnce(response({ display }));
	await loadThreadContext(params);
	mocks.post.mockResolvedValueOnce(response({ revision: "b".repeat(64) }));
	await expect(loadThreadContext(params)).rejects.toThrow("Incomplete");
	mocks.post.mockRejectedValueOnce(new Error("Forbidden"));
	await expect(loadThreadContext(params)).rejects.toThrow("Forbidden");
});

it("renders a display larger than 2 MiB without retaining it or substituting a previous page", async () => {
	const large = {
		...display,
		posts: [{ id: 1, threadId: 4, content: "x".repeat(2 * 1024 * 1024 + 1) }],
	};
	mocks.post.mockResolvedValueOnce(response({ display: large }));
	expect((await loadThreadContext(params)).display).toEqual(large);
	expect(runtime.peek("thread-detail", "thread:4")).toBeUndefined();
});

it("fences a fill crossing a mutation and starts cold after process restart", async () => {
	mocks.post.mockImplementationOnce(async () => {
		runtime.clear("thread-detail", "thread:4");
		return response({ display });
	});
	await loadThreadContext(params);
	expect(runtime.peek("thread-detail", "thread:4")).toBeUndefined();
	mocks.runtime.mockReturnValue(new MemoryRuntime());
	mocks.post.mockResolvedValueOnce(response({ display }));
	await loadThreadContext(params);
	expect(mocks.post.mock.calls[1][1]).toMatchObject({ cachedRevision: null, includeDisplay: true });
});

it.each([
	null,
	{ thread: { id: 5, forumId: 2 } },
	{ cacheable: null },
	{ revision: "bad" },
	{ nextCursor: 1 },
	{ display: { ...display, forum: { id: 3 } } },
	{ display: { ...display, posts: Array(21).fill({ threadId: 4 }) } },
	{ display: { ...display, posts: [{ threadId: 5 }] } },
	{ display: { ...display, authors: null } },
	{ display: { ...display, attachments: null } },
	{ display: { ...display, ancestors: null } },
])("rejects inconsistent context %j", async (extra) => {
	mocks.post.mockResolvedValue(extra === null ? { data: null } : response({ display, ...extra }));
	await expect(loadThreadContext(params)).rejects.toThrow();
});

afterEach(() => vi.restoreAllMocks());

it.each([Date.UTC(2026, 8, 24, 1), Date.UTC(2026, 8, 24, 15, 59)])(
	"refreshes a response crossing absolute expiry or Shanghai midnight from %s",
	async (start) => {
		let now = start;
		runtime = new MemoryRuntime({ now: () => now });
		mocks.runtime.mockReturnValue(runtime);
		mocks.post.mockResolvedValueOnce(response({ display, stats: { totalThreads: 1 } }));
		await loadThreadContext(params);
		const expiry = Date.parse(
			runtime.snapshot({ page: 1, limit: 50, family: "thread-detail" }).entries[0].expiresAt,
		);
		now = expiry - 1;
		mocks.post.mockImplementationOnce(async () => {
			now = expiry;
			return response();
		});
		const fresh = { ...display, posts: [{ id: 1, threadId: 4, content: "refreshed" }] };
		mocks.post.mockResolvedValueOnce(response({ display: fresh, stats: { totalThreads: 2 } }));
		const result = await loadThreadContext(params);
		expect(result.display).toEqual(fresh);
		expect(result.stats).toEqual(stats);
		expect(mocks.post).toHaveBeenCalledTimes(3);
		expect(mocks.post.mock.calls[2][1]).toMatchObject({
			cachedRevision: null,
			includeDisplay: true,
			includeStats: false,
		});
	},
);

it("refreshes once when a warm entry is cleared in flight, without an unbounded retry", async () => {
	mocks.post.mockResolvedValueOnce(response({ display }));
	await loadThreadContext(params);
	mocks.post.mockImplementationOnce(async () => {
		runtime.clear("thread-detail");
		return response();
	});
	mocks.post.mockResolvedValueOnce(response());
	await expect(loadThreadContext(params)).rejects.toThrow("Incomplete");
	expect(mocks.post).toHaveBeenCalledTimes(3);
});

it("shares equivalent decoded selections while rejecting malformed cursors", async () => {
	mocks.post.mockResolvedValueOnce(response({ display }));
	await loadThreadContext({ ...params, cursor: btoa('{"position":20}') });
	mocks.post.mockResolvedValueOnce(response());
	await loadThreadContext({ ...params, cursor: btoa('{ "position": 20 }') });
	expect(mocks.post.mock.calls[1][1]).toMatchObject({ includeDisplay: false });
	await expect(loadThreadContext({ ...params, cursor: "invalid" })).rejects.toThrow("cursor");
	expect(mocks.post).toHaveBeenCalledTimes(2);
});

it("sets a fifteen-second read deadline and releases the load slot after abort", async () => {
	const controller = new AbortController();
	const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal);
	mocks.post.mockImplementationOnce(
		(_path, _body, signal: AbortSignal) =>
			new Promise((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(new Error("Timed out")), { once: true });
			}),
	);
	const pending = loadThreadContext(params);
	const rejected = expect(pending).rejects.toThrow("Timed out");
	await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledOnce());
	expect(timeout).toHaveBeenCalledWith(15_000);
	controller.abort();
	await rejected;
	mocks.post.mockResolvedValue(response({ display }));
	await expect(
		Promise.all(Array.from({ length: 64 }, () => loadThreadContext(params))),
	).resolves.toHaveLength(64);
});
