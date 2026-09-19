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

vi.mock("react", () => ({ cache: (fn: (...args: unknown[]) => unknown) => fn }));

import { forumApi } from "@/lib/forum-api";

let { getCachedForumList, getCachedForumNames, getCachedThreadById } = await import(
	"@/lib/forum-cache"
);
let { getForumTitle, getThreadTitle, getUserTitle } = await import(
	"@/viewmodels/forum/title.server"
);

const mockForumApi = forumApi as any;
beforeEach(async () => {
	vi.resetAllMocks();
	vi.resetModules();
	({ getCachedForumList, getCachedForumNames, getCachedThreadById } = await import(
		"@/lib/forum-cache"
	));
	({ getForumTitle, getThreadTitle, getUserTitle } = await import(
		"@/viewmodels/forum/title.server"
	));
});

describe("getThreadTitle", () => {
	it("returns thread subject", async () => {
		mockForumApi.get.mockResolvedValue({ data: { subject: "Hello World" } });
		const result = await getThreadTitle(1);
		expect(result).toBe("Hello World");
		expect(mockForumApi.get).toHaveBeenCalledWith("/api/v1/threads/1", undefined, {
			readPurpose: "metadata",
		});
	});
});

describe("getUserTitle", () => {
	it("returns username", async () => {
		mockForumApi.get.mockResolvedValue({ data: { username: "testuser" } });
		const result = await getUserTitle(42);
		expect(result).toBe("testuser");
		expect(mockForumApi.get).toHaveBeenCalledWith("/api/v1/users/42");
	});
});

describe("getForumTitle", () => {
	it("returns forum name when found", async () => {
		mockForumApi.getAll.mockResolvedValue({ data: [{ id: 5, name: "General" }] });
		const result = await getForumTitle(5);
		expect(result).toBe("General");
	});

	it("returns fallback when forum not found", async () => {
		mockForumApi.getAll.mockResolvedValue({ data: [{ id: 5, name: "General" }] });
		const result = await getForumTitle(999);
		expect(result).toBe("版块 999");
	});
});

describe("render-pass loader routing", () => {
	it("marks the title request as metadata and retains the page reading event", async () => {
		mockForumApi.get.mockResolvedValue({ data: { subject: "Shared" } });

		const title = await getThreadTitle(42);
		const thread = await getCachedThreadById(42);

		expect(title).toBe("Shared");
		expect(thread.subject).toBe("Shared");
		expect(mockForumApi.get.mock.calls).toEqual([
			["/api/v1/threads/42", undefined, { readPurpose: "metadata" }],
			["/api/v1/threads/42"],
		]);
	});

	it("getForumTitle and getCachedForumList both resolve through forumApi.getAll (shared path)", async () => {
		mockForumApi.getAll.mockResolvedValue({ data: [{ id: 7, name: "Dev" }] });

		// generateMetadata → getForumTitle → getCachedForumList → forumApi.getAll
		const title = await getForumTitle(7);
		// page loader → getCachedForumList → forumApi.getAll (same function, deduped by React cache at runtime)
		const forums = await getCachedForumList();

		expect(title).toBe("Dev");
		expect(forums).toEqual([{ id: 7, name: "Dev" }]);
		expect(mockForumApi.getAll).toHaveBeenCalledWith("/api/v1/forums");
		expect(mockForumApi.getAll).toHaveBeenCalledTimes(2);
	});
});

it("name-only reads request no forum summary", async () => {
	mockForumApi.getAll.mockResolvedValue({ data: [{ id: 7, name: "Dev" }] });
	expect(await getCachedForumNames()).toEqual([{ id: 7, name: "Dev" }]);
	expect(mockForumApi.getAll).toHaveBeenCalledWith("/api/v1/forums", { view: "names" });
});
