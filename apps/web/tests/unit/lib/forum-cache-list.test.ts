import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: vi.fn(), read: vi.fn(), settings: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/forum-list-reading", () => ({ loadForumListContext: mocks.read }));
vi.mock("@/lib/public-settings", () => ({ getPublicSettings: mocks.settings }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
	mocks.headers.mockResolvedValue(new Headers({ "x-ellie-forum-list": "2:3:4" }));
	mocks.settings.mockResolvedValue({});
	mocks.read.mockResolvedValue({ value: "context" });
});

it("loads the normalized route once through the context reader", async () => {
	const { getCachedForumListContext } = await import("@/lib/forum-cache");
	expect(await getCachedForumListContext()).toEqual({ value: "context" });
	expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ forumId: 2, page: 3, typeId: 4, limit: 20 });
});

it("does not fetch content for missing route hints", async () => {
	mocks.headers.mockResolvedValue(new Headers());
	const { getCachedForumListContext } = await import("@/lib/forum-cache");
	await expect(getCachedForumListContext()).rejects.toThrow("location");
	expect(mocks.read).not.toHaveBeenCalled();
});

it.each([
	[200, 100],
	[-1, 20],
	[1.5, 20],
	[40, 40],
])("bounds configured page size %s", async (configured, expected) => {
	mocks.settings.mockResolvedValue({ "general.pagination.page_size": configured });
	const { getCachedForumListContext } = await import("@/lib/forum-cache");
	await getCachedForumListContext();
	expect(mocks.read.mock.calls[0][0].limit).toBe(expected);
});
