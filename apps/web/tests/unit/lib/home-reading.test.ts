import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadHomeContext } from "@/lib/home-reading";
import { MemoryRuntime } from "@/lib/memory-runtime";

const mocks = vi.hoisted(() => ({ post: vi.fn(), jwt: vi.fn(), user: vi.fn(), runtime: vi.fn() }));
vi.mock("@/lib/forum-api", () => ({ forumApi: { postRead: mocks.post } }));
vi.mock("@/lib/forum-auth", () => ({ getWorkerJwt: mocks.jwt, getCurrentForumUser: mocks.user }));
vi.mock("@/lib/memory-runtime", async (original) => ({
	...(await original<object>()),
	getMemoryRuntime: mocks.runtime,
}));

const forum = {
	id: 1,
	parentId: 0,
	name: "Forum",
	description: "",
	icon: "",
	displayOrder: 0,
	type: "group",
	status: 1,
	visibility: "public",
};
const summary = {
	forumId: 1,
	threads: 1,
	posts: 2,
	todayThreads: 1,
	topicId: 4,
	topicSubject: "Latest",
	topicCreatedAt: 1,
	authorId: 9,
	authorName: "Author",
	authorAvatar: "",
	authorAvatarPath: "",
};
const topic = {
	id: 4,
	forumId: 1,
	subject: "Digest",
	digest: 1,
	createdAt: 1,
	replies: 1,
	views: 4,
	anonymousAuthor: 0,
	authorId: 9,
	authorName: "Author",
};
const display = { forums: [forum], summaries: [summary], digest: [topic] };
const stats = {
	todayPosts: 1,
	yesterdayPosts: 0,
	totalThreads: 1,
	totalPosts: 2,
	totalMembers: 1,
	totalOnline: 1,
	peakOnline: 1,
	peakDate: "",
};
function context(extra = {}) {
	return {
		bucket: "member",
		user: null,
		allowedForumIds: [1],
		summaryGates: [
			{
				topicId: 4,
				forumId: 1,
				forumStatus: 1,
				visibility: "public",
				sticky: 0,
				anonymousAuthor: 0,
				authorId: 9,
			},
		],
		digestGates: [
			{ topicId: 4, forumId: 1, sticky: 0, digest: 1, anonymousAuthor: 0, authorId: 9 },
		],
		...extra,
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

describe("homepage context", () => {
	it("shares the runtime flight cap before cloning or fetching without sharing private results", async () => {
		let finish!: () => void;
		const pending = new Promise<void>((resolve) => {
			finish = resolve;
		});
		const otherLoads = Array.from({ length: 63 }, (_, id) =>
			runtime.read("thread-count", String(id), async () => {
				await pending;
				return id;
			}),
		);
		mocks.post.mockImplementation(async () => {
			await pending;
			return { data: context({ display, stats, user: { id: 9 } }) };
		});
		const peek = vi.spyOn(runtime, "peek");
		const home = loadHomeContext();
		await vi.waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
		expect(peek).toHaveBeenCalledTimes(2);
		await expect(loadHomeContext()).rejects.toThrow("capacity exceeded");
		expect(mocks.post).toHaveBeenCalledTimes(1);
		expect(peek).toHaveBeenCalledTimes(2);
		expect(
			runtime.snapshot({ page: 1, limit: 1 }).families.find((row) => row.id === "home-display")
				?.loadErrors,
		).toBe(1);
		finish();
		await Promise.all(otherLoads);
		expect((await home).user).toEqual({ id: 9 });
		expect(runtime.peek("home-display", "member")).not.toHaveProperty("user");
		mocks.post.mockResolvedValue({ data: context({ user: { id: 10 } }) });
		expect((await loadHomeContext()).user).toEqual({ id: 10 });
	});

	it("releases all load slots after repeated context failures", async () => {
		mocks.post.mockRejectedValue(new Error("offline"));
		for (let index = 0; index < 64; index++)
			await expect(loadHomeContext()).rejects.toThrow("offline");
		mocks.post.mockResolvedValue({ data: context({ display, stats }) });
		expect((await loadHomeContext()).tree).toHaveLength(1);
	});

	it("keeps verified content when stats are unavailable and retries without caching defaults", async () => {
		mocks.post.mockResolvedValueOnce({ data: context({ display, user: { id: 9 } }) });
		const first = await loadHomeContext();
		expect(first.tree[0].lastThreadSubject).toBe("Latest");
		expect(first.digest).toHaveLength(1);
		expect(first.user).toEqual({ id: 9 });
		expect(first.stats).toBeUndefined();
		expect(runtime.peek("site-stats", "site:v1")).toBeUndefined();
		mocks.post.mockResolvedValueOnce({ data: context({ stats }) });
		expect((await loadHomeContext()).stats).toEqual(stats);
		expect(mocks.post.mock.calls[1][1]).toMatchObject({
			includeDisplay: false,
			includeStats: true,
		});
		expect(runtime.peek("site-stats", "site:v1")).toEqual(stats);
	});

	it("loads cold data once, then gates warm display in one request without caching private fields", async () => {
		mocks.post.mockResolvedValueOnce({ data: context({ display, stats, user: { id: 9 } }) });
		expect((await loadHomeContext()).tree[0].lastThreadSubject).toBe("Latest");
		expect(mocks.post).toHaveBeenLastCalledWith(
			"/api/v1/home/context",
			{
				cachedBucket: null,
				includeDisplay: true,
				includeStats: true,
				summaryTopicIds: [],
				digestTopicIds: [],
			},
			"jwt",
		);
		mocks.post.mockResolvedValueOnce({ data: context() });
		const hot = await loadHomeContext();
		expect(hot.user).toBeNull();
		expect(hot.digest).toHaveLength(1);
		expect(mocks.post).toHaveBeenCalledTimes(2);
		expect(mocks.post).toHaveBeenLastCalledWith(
			"/api/v1/home/context",
			{
				cachedBucket: "member",
				includeDisplay: false,
				includeStats: false,
				summaryTopicIds: [4],
				digestTopicIds: [4],
			},
			"jwt",
		);
		expect(runtime.peek("home-display", "member")).toEqual(display);
	});

	it("admits actual bucket after stale role hints and refuses missing fresh display", async () => {
		mocks.user.mockResolvedValue({ role: 1 });
		mocks.post.mockResolvedValue({ data: context({ display, stats }) });
		await loadHomeContext();
		expect(runtime.peek("home-display", "admin")).toBeUndefined();
		expect(runtime.peek("home-display", "member")).toEqual(display);
		mocks.post.mockResolvedValue({ data: context() });
		await expect(loadHomeContext()).rejects.toThrow("Incomplete");
	});

	it("removes entire forbidden forums and invalidates gated-out candidates", async () => {
		runtime.admit("member", display, runtime.capture("home-display"));
		runtime.admit("site:v1", stats, runtime.capture("site-stats"));
		mocks.post.mockResolvedValue({
			data: context({ allowedForumIds: [], summaryGates: [], digestGates: [] }),
		});
		const result = await loadHomeContext();
		expect(result.tree).toEqual([]);
		expect(result.digest).toEqual([]);
		expect(runtime.peek("home-display", "member")).toBeUndefined();
	});

	it("hides anonymized or changed-author candidates without an extra Worker call", async () => {
		mocks.post.mockResolvedValue({
			data: context({
				display,
				stats,
				summaryGates: [],
				digestGates: [
					{ topicId: 4, forumId: 1, sticky: 0, digest: 1, anonymousAuthor: 1, authorId: 0 },
				],
			}),
		});
		const result = await loadHomeContext();
		expect(result.tree[0].lastThreadId).toBe(0);
		expect(result.digest).toEqual([]);
		expect(mocks.post).toHaveBeenCalledTimes(1);
	});

	it("does not admit an in-flight response after a successful write clears empty caches", async () => {
		mocks.post.mockImplementation(async () => {
			runtime.clear();
			return { data: context({ display, stats }) };
		});
		await loadHomeContext();
		expect(runtime.peek("home-display", "member")).toBeUndefined();
		expect(runtime.peek("site-stats", "site:v1")).toBeUndefined();
	});

	it("fails closed on transport, authorization and malformed context", async () => {
		mocks.post.mockRejectedValue(new Error("Unauthorized"));
		await expect(loadHomeContext()).rejects.toThrow("Unauthorized");
		mocks.post.mockResolvedValue({ data: {} });
		await expect(loadHomeContext()).rejects.toThrow("Invalid");
		expect(runtime.peek("home-display", "member")).toBeUndefined();
	});

	it("does not truncate or admit a fresh display with more than 512 candidates", async () => {
		const summaries = Array.from({ length: 513 }, (_, i) => ({
			...summary,
			forumId: i + 1,
			topicId: i + 1,
		}));
		const forums = summaries.map((s) => ({ ...forum, id: s.forumId }));
		mocks.post.mockResolvedValue({
			data: context({
				display: { forums, summaries, digest: [] },
				stats,
				allowedForumIds: forums.map((f) => f.id),
				summaryGates: summaries.map((s) => ({
					topicId: s.topicId,
					forumId: s.forumId,
					forumStatus: 1,
					visibility: "public",
					sticky: 0,
					anonymousAuthor: 0,
					authorId: 9,
				})),
			}),
		});
		expect((await loadHomeContext()).tree).toHaveLength(513);
		expect(runtime.peek("home-display", "member")).toBeUndefined();
	});
});

it.each([
	[null, 1, "anon"],
	["jwt", 3, "staff"],
	["jwt", 2, "staff"],
])("uses role hints only to choose candidates (%s/%s)", async (jwt, role, bucket) => {
	mocks.jwt.mockResolvedValue(jwt);
	mocks.user.mockResolvedValue({ role });
	runtime.admit(bucket, display, runtime.capture("home-display"));
	mocks.post.mockResolvedValue({ data: context({ bucket, stats }) });
	await loadHomeContext();
	expect(mocks.post.mock.calls[0][1].cachedBucket).toBe(bucket);
});

it("keeps anonymous digest authors masked and does not cache the current user", async () => {
	const anonymousDisplay = {
		...display,
		digest: [{ ...topic, anonymousAuthor: 1, authorId: 0, authorName: "" }],
	};
	mocks.post.mockResolvedValue({
		data: context({
			display: anonymousDisplay,
			stats,
			digestGates: [
				{ topicId: 4, forumId: 1, sticky: 0, digest: 1, anonymousAuthor: 1, authorId: 0 },
			],
		}),
	});
	const result = await loadHomeContext();
	expect(result.digest[0]).toMatchObject({ authorId: 0, authorName: "" });
	expect(runtime.peek("home-display", "member")).not.toHaveProperty("user");
});

it("rebuilds after restart and never substitutes a cached snapshot for missing context", async () => {
	mocks.post.mockResolvedValue({ data: context({ display, stats }) });
	await loadHomeContext();
	runtime = new MemoryRuntime();
	mocks.runtime.mockReturnValue(runtime);
	await loadHomeContext();
	expect(mocks.post.mock.calls[1][1]).toMatchObject({
		includeDisplay: true,
		includeStats: true,
		cachedBucket: null,
	});
	mocks.post.mockResolvedValue({ data: context({ display: { forums: null } }) });
	await expect(loadHomeContext()).rejects.toThrow("Incomplete");
});
