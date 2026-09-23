// Doc/29: the forum list composes the static structure view with
// runtime-cached summaries and fresh gates. These tests pin the tree/visibility
// behavior with summaries/gates stubbed empty (numeric-only rows); summary
// composition and gating are covered in tests/unit/lib/forum-reading.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/forum-cache", () => ({
	getCachedForumStructure: vi.fn(),
	getCachedThreadById: vi.fn(),
}));
vi.mock("@/lib/forum-auth", () => ({
	getWorkerJwt: vi.fn(async () => null),
}));
vi.mock("@/lib/forum-reading", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/forum-reading")>();
	return {
		...actual,
		loadForumSummariesWithGates: vi.fn(async () => ({
			summaries: [],
			gates: [],
			bucket: "anon",
			hiddenTopicForumIds: [],
		})),
	};
});

import { getCachedForumStructure } from "@/lib/forum-cache";
import { loadForumList } from "@/viewmodels/forum/forum-list.server";

const mockGetForumStructure = getCachedForumStructure as ReturnType<typeof vi.fn>;

function makeForum(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		parentId: 0,
		name: "General",
		status: 1,
		threads: 0,
		posts: 0,
		displayOrder: 1,
		moderators: "",
		description: "",
		redirect: "",
		icon: "",
		rules: "",
		lastThreadId: 0,
		lastPostAt: 0,
		lastPostBy: "",
		todayPosts: 0,
		...overrides,
	};
}

describe("loadForumList", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetForumStructure.mockResolvedValue({ forums: [], bucket: null });
	});

	it("fetches forums and returns visible tree", async () => {
		mockGetForumStructure.mockResolvedValue({
			forums: [
				makeForum({ id: 1, name: "General" }),
				makeForum({ id: 2, parentId: 1, name: "Sub" }),
			],
			bucket: null,
		});

		const result = await loadForumList();
		expect(mockGetForumStructure).toHaveBeenCalled();
		expect(Array.isArray(result)).toBe(true);
		expect(result.length).toBeGreaterThan(0);
		expect(result[0].id).toBe(1);
		expect(result[0].children.length).toBe(1);
	});

	it("filters invisible forums", async () => {
		mockGetForumStructure.mockResolvedValue({
			forums: [
				makeForum({ id: 1, name: "Visible" }),
				makeForum({ id: 2, name: "Hidden", status: -1 }),
			],
			bucket: null,
		});

		const result = await loadForumList();
		expect(result.length).toBe(1);
		expect(result[0].name).toBe("Visible");
	});

	it("returns empty array for empty forums", async () => {
		mockGetForumStructure.mockResolvedValue({ forums: [], bucket: null });
		const result = await loadForumList();
		expect(result).toEqual([]);
	});
});
