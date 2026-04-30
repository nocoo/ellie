import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/forum-api", () => ({
	forumApi: {
		get: vi.fn(),
		getAll: vi.fn(),
		getCursor: vi.fn(),
		getPage: vi.fn(),
		postAuth: vi.fn(),
	},
	publicUserToUser: vi.fn((u: any) => u),
}));

vi.mock("@/lib/forum-settings", () => ({
	getPageSize: vi.fn(async () => 20),
}));

import { forumApi } from "@/lib/forum-api";
import { loadDigestList } from "@/viewmodels/forum/digest.server";

const mockForumApi = forumApi as any;

const mockStats = { total: 100, level1: 50, level2: 30, level3: 20 };
const mockFilters = { years: [2024, 2025], forums: [{ id: 1, name: "General", digestCount: 10 }] };
const mockThreads = [
	{
		id: 1,
		forumId: 1,
		subject: "Digest Thread",
		authorId: 1,
		authorName: "user1",
		views: 10,
		replies: 2,
		lastPostAt: 1000,
		lastPostBy: "user2",
		createdAt: 900,
		sticky: 0,
		digest: 1,
		highlight: "",
		closed: 0,
		special: 0,
		displayOrder: 0,
	},
];

describe("loadDigestList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockForumApi.getCursor.mockResolvedValue({
			data: mockThreads,
			meta: { nextCursor: "next123" },
		});
		mockForumApi.get.mockImplementation((path: string) => {
			if (path.includes("stats")) return Promise.resolve({ data: mockStats });
			if (path.includes("filters")) return Promise.resolve({ data: mockFilters });
			return Promise.resolve({ data: null });
		});
	});

	it("fetches digest threads, stats, and filters in parallel", async () => {
		const result = await loadDigestList({});

		expect(result.results.items).toEqual(mockThreads);
		expect(result.results.nextCursor).toBe("next123");
		expect(result.stats).toEqual(mockStats);
		expect(result.filters).toEqual(mockFilters);
	});

	it("uses default limit from settings", async () => {
		await loadDigestList({});
		expect(mockForumApi.getCursor).toHaveBeenCalledWith(
			"/api/v1/digest",
			expect.objectContaining({ limit: 20 }),
		);
	});

	it("passes custom limit", async () => {
		await loadDigestList({ limit: 10 });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith(
			"/api/v1/digest",
			expect.objectContaining({ limit: 10 }),
		);
	});

	it("passes cursor", async () => {
		await loadDigestList({ cursor: "abc" });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith(
			"/api/v1/digest",
			expect.objectContaining({ cursor: "abc" }),
		);
	});

	it("passes forumId filter", async () => {
		await loadDigestList({ forumId: 5 });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith(
			"/api/v1/digest",
			expect.objectContaining({ forumId: 5 }),
		);
	});

	it("passes level filter when valid (1-3)", async () => {
		await loadDigestList({ level: 2 });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith(
			"/api/v1/digest",
			expect.objectContaining({ level: 2 }),
		);
	});

	it("ignores level filter when invalid (0 or >3)", async () => {
		await loadDigestList({ level: 0 });
		const call = mockForumApi.getCursor.mock.calls[0][1];
		expect(call.level).toBeUndefined();
	});

	it("passes year filter", async () => {
		await loadDigestList({ year: 2024 });
		expect(mockForumApi.getCursor).toHaveBeenCalledWith(
			"/api/v1/digest",
			expect.objectContaining({ year: 2024 }),
		);
	});

	it("sets prevCursor from params.cursor", async () => {
		const result = await loadDigestList({ cursor: "prev" });
		expect(result.results.prevCursor).toBe("prev");
	});

	it("sets prevCursor to null when no cursor param", async () => {
		const result = await loadDigestList({});
		expect(result.results.prevCursor).toBeNull();
	});

	it("total comes from stats.total", async () => {
		const result = await loadDigestList({});
		expect(result.results.total).toBe(100);
	});
});
