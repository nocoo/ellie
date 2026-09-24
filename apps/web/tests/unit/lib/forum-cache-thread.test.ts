import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ headers: vi.fn(), read: vi.fn(), settings: vi.fn() }));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/thread-reading", () => ({ loadThreadContext: mocks.read }));
vi.mock("@/lib/public-settings", () => ({ fetchPublicSettingsRaw: mocks.settings }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.resetModules();
	mocks.headers.mockResolvedValue(new Headers({ "x-ellie-thread": "4?page=3" }));
	mocks.settings.mockResolvedValue({});
	mocks.read.mockResolvedValue({ value: "context" });
});

it("resolves the trusted route with configured page size at the shared request boundary", async () => {
	const { getCachedThreadContext } = await import("@/lib/forum-cache");
	expect(await getCachedThreadContext()).toEqual({ value: "context" });
	expect(mocks.read).toHaveBeenCalledExactlyOnceWith({
		threadId: 4,
		limit: 20,
		cursor: btoa(JSON.stringify({ position: 40 })),
		last: false,
	});
});

it("does not fetch for a missing trusted route hint", async () => {
	mocks.headers.mockResolvedValue(new Headers());
	const { getCachedThreadContext } = await import("@/lib/forum-cache");
	await expect(getCachedThreadContext()).rejects.toThrow("location");
	expect(mocks.read).not.toHaveBeenCalled();
});

it.each([
	[200, 100],
	[-1, 20],
	[1.5, 20],
	[40, 40],
])("bounds configured size %s", async (configured, expected) => {
	mocks.settings.mockResolvedValue({ "general.pagination.posts_per_page": configured });
	mocks.headers.mockResolvedValue(new Headers({ "x-ellie-thread": "4?last=1" }));
	const { getCachedThreadContext } = await import("@/lib/forum-cache");
	await getCachedThreadContext();
	expect(mocks.read.mock.calls[0][0]).toEqual({
		threadId: 4,
		limit: expected,
		cursor: null,
		last: true,
	});
});
