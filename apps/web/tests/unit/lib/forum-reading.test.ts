// Tests for the doc/29 reading-contract integration (lib/forum-reading.ts):
// bounds, gate equality checks, bucket visibility, compose semantics
// (numeric preserved / topic line hidden), fail-closed gates, lazy batch
// (warm render → no summaries call, gates still fresh), bounded
// reselection, chunked gate requests, and count validation.

import type { ForumSummaryGate, ForumSummaryTopic } from "@ellie/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forumApi } from "@/lib/forum-api";
import {
	boundForumSummaryTopic,
	bucketAllowsVisibility,
	composeForumDisplay,
	type ForumStructure,
	forumSummaryKey,
	gateTopicIds,
	loadForumSummariesWithGates,
	summaryCandidatePasses,
	threadCountKey,
} from "@/lib/forum-reading";
import { getMemoryRuntime } from "@/lib/memory-runtime";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/forum-api", () => ({
	forumApi: {
		get: vi.fn(),
		getAll: vi.fn(),
		getAuth: vi.fn(),
	},
}));
vi.mock("@/lib/memory-runtime", () => ({
	getMemoryRuntime: vi.fn(),
}));

const mockGetAll = forumApi.getAll as ReturnType<typeof vi.fn>;
const mockGetAuth = forumApi.getAuth as ReturnType<typeof vi.fn>;
const mockRuntime = getMemoryRuntime as ReturnType<typeof vi.fn>;

function makeSummary(overrides: Partial<ForumSummaryTopic> = {}): ForumSummaryTopic {
	return {
		forumId: 7,
		threads: 12,
		posts: 34,
		todayThreads: 2,
		topicId: 99,
		topicSubject: "Hello",
		topicCreatedAt: 1_700_000_000,
		authorId: 5,
		authorName: "alice",
		authorAvatar: "https://cdn.example.com/a.png",
		authorAvatarPath: "avatars/a.jpg",
		...overrides,
	};
}

function makeGate(overrides: Partial<ForumSummaryGate> = {}): ForumSummaryGate {
	return {
		topicId: 99,
		forumId: 7,
		forumStatus: 1,
		visibility: "public",
		sticky: 0,
		anonymousAuthor: 0,
		authorId: 5,
		...overrides,
	};
}

function makeStructure(overrides: Partial<ForumStructure["forums"][number]> = {}) {
	return {
		id: 7,
		parentId: 0,
		name: "Forum",
		threads: 0,
		posts: 0,
		status: 1,
		visibility: "public",
		type: "forum",
		moderators: "",
		moderatorIds: "",
		moderatorList: [],
		todayThreads: 0,
		lastThreadId: 0,
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		lastThreadSubject: "",
		threadTypes: { enabled: false, required: false, listable: false, prefix: false, types: [] },
		...overrides,
	} as ForumStructure["forums"][number];
}

interface RuntimeStub {
	read: ReturnType<typeof vi.fn>;
	clear: ReturnType<typeof vi.fn>;
	recordView: ReturnType<typeof vi.fn>;
	recordActivity: ReturnType<typeof vi.fn>;
}

function installRuntime(): RuntimeStub {
	const stub: RuntimeStub = {
		read: vi.fn(async (_family: string, key: string, load: () => Promise<unknown>) => {
			if (!(key in store)) store[key] = await load();
			return store[key];
		}),
		clear: vi.fn((family?: string, key?: string) => {
			if (family && key) Reflect.deleteProperty(store, key);
			else for (const k of Object.keys(store)) Reflect.deleteProperty(store, k);
		}),
		recordView: vi.fn(),
		recordActivity: vi.fn(),
	};
	const store: Record<string, unknown> = {};
	mockRuntime.mockReturnValue(stub);
	return stub;
}

function summariesResponse(summaries: ForumSummaryTopic[], jwt: string | null) {
	if (jwt) {
		mockGetAuth.mockResolvedValueOnce({ data: summaries, meta: {} });
	} else {
		mockGetAll.mockResolvedValueOnce({ data: summaries, meta: {} });
	}
}

function gatesResponse(gates: ForumSummaryGate[], jwt: string | null) {
	if (jwt) {
		mockGetAuth.mockResolvedValueOnce({ data: gates, meta: {} });
	} else {
		mockGetAll.mockResolvedValueOnce({ data: gates, meta: {} });
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	installRuntime();
});

describe("boundForumSummaryTopic", () => {
	it("clamps numerics and cuts subject/name without splitting surrogate pairs", () => {
		const bounded = boundForumSummaryTopic(
			makeSummary({
				forumId: -1,
				threads: Number.NaN,
				posts: 10.7,
				topicId: 0,
				authorId: 0,
				topicSubject: "😀".repeat(101).slice(0, 201),
				authorName: `${"😀".repeat(33)}x`,
			}),
		);
		expect(bounded.forumId).toBe(0);
		expect(bounded.threads).toBe(0);
		expect(bounded.posts).toBe(10);
		// 200 chars cut at a pair boundary (no lone surrogate).
		expect(Array.from(bounded.topicSubject).length).toBe(100);
		expect(Array.from(bounded.authorName).length).toBeLessThanOrEqual(32);
	});

	it("omits oversized avatar URLs instead of truncating them", () => {
		const long = `https://cdn.example.com/${"a".repeat(2100)}`;
		const bounded = boundForumSummaryTopic(
			makeSummary({ authorAvatar: long, authorAvatarPath: long }),
		);
		expect(bounded.authorAvatar).toBe("");
		expect(bounded.authorAvatarPath).toBe("");
		const ok = "https://cdn.example.com/normal.png";
		expect(boundForumSummaryTopic(makeSummary({ authorAvatar: ok })).authorAvatar).toBe(ok);
	});
});

describe("summaryCandidatePasses", () => {
	it("requires exact topicId/forumId/authorId equality and forumStatus 1", () => {
		const summary = makeSummary();
		expect(summaryCandidatePasses(makeGate(), summary)).toBe(true);
		expect(summaryCandidatePasses(makeGate({ topicId: 98 }), summary)).toBe(false);
		expect(summaryCandidatePasses(makeGate({ forumId: 8 }), summary)).toBe(false);
		expect(summaryCandidatePasses(makeGate({ authorId: 6 }), summary)).toBe(false);
		expect(summaryCandidatePasses(makeGate({ forumStatus: 0 }), summary)).toBe(false);
		expect(summaryCandidatePasses(makeGate({ forumStatus: 3 }), summary)).toBe(false);
	});

	it("fails moderated-hidden and anonymized candidates", () => {
		const summary = makeSummary();
		expect(summaryCandidatePasses(makeGate({ sticky: -2 }), summary)).toBe(false);
		expect(summaryCandidatePasses(makeGate({ anonymousAuthor: 1 }), summary)).toBe(false);
	});
});

describe("bucketAllowsVisibility / bucketForVerifiedUser", () => {
	it("maps buckets through the authoritative canViewForum helper", () => {
		expect(bucketAllowsVisibility("anon", "public")).toBe(true);
		expect(bucketAllowsVisibility("anon", "members")).toBe(false);
		expect(bucketAllowsVisibility("member", "members")).toBe(true);
		expect(bucketAllowsVisibility("member", "staff")).toBe(false);
		expect(bucketAllowsVisibility("staff", "staff")).toBe(true);
		expect(bucketAllowsVisibility("staff", "admin")).toBe(false);
		expect(bucketAllowsVisibility("admin", "admin")).toBe(true);
	});
});

describe("composeForumDisplay", () => {
	it("keeps numeric summary and hides only the topic line when topicId is 0", () => {
		const result = composeForumDisplay({
			structure: makeStructure(),
			summary: makeSummary({ topicId: 0, topicSubject: "", authorId: 0 }),
			gate: undefined,
			bucket: "anon",
		});
		expect(result.forum.threads).toBe(12);
		expect(result.forum.posts).toBe(34);
		expect(result.forum.todayThreads).toBe(2);
		expect(result.forum.lastThreadId).toBe(0);
		expect(result.forum.lastThreadSubject).toBe("");
		expect(result.topicHidden).toBe(false);
	});

	it("carries the topic author and creation time on lastThread*/lastPoster* fields", () => {
		const result = composeForumDisplay({
			structure: makeStructure(),
			summary: makeSummary(),
			gate: makeGate(),
			bucket: "member",
		});
		expect(result.forum.lastThreadId).toBe(99);
		expect(result.forum.lastThreadSubject).toBe("Hello");
		expect(result.forum.lastPostAt).toBe(1_700_000_000);
		expect(result.forum.lastPoster).toBe("alice");
		expect(result.forum.lastPosterId).toBe(5);
		expect(result.topicHidden).toBe(false);
	});

	it("hides the topic line (numeric kept) on gate failure or viewer visibility", () => {
		for (const gate of [
			undefined,
			makeGate({ authorId: 6 }),
			makeGate({ visibility: "members" }),
		]) {
			const result = composeForumDisplay({
				structure: makeStructure(),
				summary: makeSummary(),
				gate,
				bucket: "anon",
			});
			expect(result.forum.threads).toBe(12);
			expect(result.forum.lastThreadId).toBe(0);
			expect(result.topicHidden).toBe(true);
		}
	});
});

describe("gateTopicIds", () => {
	it("keeps unique positive ids in order", () => {
		expect(gateTopicIds([5, 0, -1, 5, 7.5, 9])).toEqual([5, 9]);
	});
});

describe("loadForumSummariesWithGates", () => {
	it("cold render: one summaries batch, per-forum entries, fresh gates", async () => {
		summariesResponse([makeSummary()], null);
		gatesResponse([makeGate()], null);
		const result = await loadForumSummariesWithGates({
			jwt: null,
			bucket: "anon",
			forumIds: [7],
		});
		expect(mockGetAll).toHaveBeenCalledTimes(2);
		expect(result.summaries[0].forumId).toBe(7);
		expect(result.hiddenTopicForumIds).toEqual([]);
		expect(result.gates).toHaveLength(1);
	});

	it("warm render: no summaries call, gates still fresh", async () => {
		// Prime the runtime store with the bounded summary.
		summariesResponse([makeSummary()], null);
		gatesResponse([makeGate()], null);
		await loadForumSummariesWithGates({ jwt: null, bucket: "anon", forumIds: [7] });
		vi.clearAllMocks();

		gatesResponse([makeGate()], null);
		const result = await loadForumSummariesWithGates({ jwt: null, bucket: "anon", forumIds: [7] });
		expect(mockGetAll).toHaveBeenCalledTimes(1); // gates only
		expect(result.summaries[0].forumId).toBe(7);
	});

	it("state mismatch clears the entry and re-reads exactly once", async () => {
		summariesResponse([makeSummary()], null);
		gatesResponse([makeGate({ authorId: 6 })], null); // stale candidate
		summariesResponse([makeSummary({ topicId: 100, topicSubject: "Next" })], null);
		gatesResponse([makeGate({ topicId: 100 })], null);
		const runtime = installRuntime();
		const result = await loadForumSummariesWithGates({ jwt: null, bucket: "anon", forumIds: [7] });
		expect(runtime.clear).toHaveBeenCalledWith("forum-summary", forumSummaryKey("anon", 7));
		expect(result.summaries[0].topicId).toBe(100);
		expect(result.hiddenTopicForumIds).toEqual([]);
		expect(mockGetAll).toHaveBeenCalledTimes(4); // 2 batches + 2 gate reads
	});

	it("gate transport failure fails closed: topic lines hidden, numerics kept, no reselection", async () => {
		summariesResponse([makeSummary()], null);
		mockGetAll.mockRejectedValueOnce(new Error("gate outage"));
		const result = await loadForumSummariesWithGates({ jwt: null, bucket: "anon", forumIds: [7] });
		expect(result.gates).toEqual([]);
		expect(result.hiddenTopicForumIds).toEqual([7]);
		expect(result.summaries[0].threads).toBe(12);
		expect(mockGetAll).toHaveBeenCalledTimes(2); // batch + failed gates, no reselection
	});

	it("chunks cold cache loads and gates without dropping forums beyond capacity", async () => {
		const { MemoryRuntime } =
			await vi.importActual<typeof import("@/lib/memory-runtime")>("@/lib/memory-runtime");
		const runtime = new MemoryRuntime();
		mockRuntime.mockReturnValue(runtime);
		const summaries: ForumSummaryTopic[] = [];
		for (let i = 1; i <= 300; i += 1) {
			summaries.push(makeSummary({ forumId: i, topicId: 1000 + i }));
		}
		summariesResponse(summaries, null);
		gatesResponse(
			summaries.slice(0, 256).map((s) => makeGate({ forumId: s.forumId, topicId: s.topicId })),
			null,
		);
		gatesResponse(
			summaries.slice(256).map((s) => makeGate({ forumId: s.forumId, topicId: s.topicId })),
			null,
		);
		const result = await loadForumSummariesWithGates({
			jwt: null,
			bucket: "anon",
			forumIds: summaries.map((s) => s.forumId),
		});
		expect(result.gates).toHaveLength(300);
		expect(result.summaries).toHaveLength(300);
		expect(runtime.snapshot({ page: 1, limit: 50 }).pagination.total).toBe(256);
		const gateUrls = mockGetAll.mock.calls
			.map((call) => String(call[1]?.topics ?? ""))
			.filter((topics: string) => topics.length > 0);
		expect(gateUrls).toHaveLength(2);
		expect(gateUrls[0].split(",").length).toBe(256);
	});

	it("composes uncached when the bucket is unknown (no runtime entries)", async () => {
		summariesResponse([makeSummary()], null);
		gatesResponse([makeGate()], null);
		const result = await loadForumSummariesWithGates({
			jwt: null,
			bucket: null,
			forumIds: [7],
		});
		expect(result.summaries[0].forumId).toBe(7);
		expect(mockRuntime).not.toHaveBeenCalled();
	});
});

it("keys local counts by forum and category", () => {
	expect(threadCountKey(7, 3)).toBe("forum:7:type:3");
	expect(threadCountKey(7, null)).toBe("forum:7:type:0");
});
