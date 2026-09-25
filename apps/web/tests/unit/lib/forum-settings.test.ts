import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// React `cache()` is mocked to identity so we don't dedupe across cases
// (each `getCached*` call goes through to the underlying loader).
vi.mock("react", () => ({ cache: (fn: (...args: unknown[]) => unknown) => fn }));
vi.mock("@/lib/forum-api", () => ({ forumApi: { get: vi.fn(), getAll: vi.fn() } }));

import { forumApi } from "@/lib/forum-api";

let { getCachedForumSettings, getCachedPageSize, getCachedPostsPerPage, getCachedPublicSettings } =
	await import("@/lib/forum-cache");

const mockGet = forumApi.get as ReturnType<typeof vi.fn>;

describe("forum-settings (via lib/forum-cache)", () => {
	beforeEach(async () => {
		vi.resetAllMocks();
		vi.resetModules();
		Reflect.deleteProperty(globalThis, "__elliePublicSettings");
		vi.useFakeTimers();
		({ getCachedForumSettings, getCachedPageSize, getCachedPostsPerPage, getCachedPublicSettings } =
			await import("@/lib/forum-cache"));
	});
	afterEach(() => {
		vi.useRealTimers();
		Reflect.deleteProperty(globalThis, "__elliePublicSettings");
	});

	describe("getCachedForumSettings", () => {
		it("returns parsed settings from API", async () => {
			mockGet.mockResolvedValue({
				data: {
					"general.pagination.page_size": 30,
					"general.pagination.posts_per_page": 15,
					"general.pagination.max_post_length": 80000,
				},
			});
			const settings = await getCachedForumSettings();
			expect(settings).toEqual({ pageSize: 30, postsPerPage: 15, maxPostLength: 80000 });
		});

		it("parses string values", async () => {
			mockGet.mockResolvedValue({
				data: {
					"general.pagination.page_size": "25",
					"general.pagination.posts_per_page": "10",
					"general.pagination.max_post_length": "60000",
				},
			});
			const settings = await getCachedForumSettings();
			expect(settings).toEqual({ pageSize: 25, postsPerPage: 10, maxPostLength: 60000 });
		});

		it("uses defaults for non-numeric values", async () => {
			mockGet.mockResolvedValue({
				data: {
					"general.pagination.page_size": "invalid",
					"general.pagination.posts_per_page": true,
					"general.pagination.max_post_length": {},
				},
			});
			const settings = await getCachedForumSettings();
			expect(settings).toEqual({ pageSize: 20, postsPerPage: 20, maxPostLength: 50000 });
		});

		it("returns defaults on error", async () => {
			mockGet.mockRejectedValue(new Error("network"));
			const settings = await getCachedForumSettings();
			expect(settings).toEqual({ pageSize: 20, postsPerPage: 20, maxPostLength: 50000 });
		});

		it("uses defaults for missing keys", async () => {
			mockGet.mockResolvedValue({ data: {} });
			const settings = await getCachedForumSettings();
			expect(settings).toEqual({ pageSize: 20, postsPerPage: 20, maxPostLength: 50000 });
		});
	});

	it("shares settings across pagination and raw reads until the five-minute boundary", async () => {
		mockGet.mockResolvedValue({ data: { "general.pagination.page_size": 30 } });
		const raw = await getCachedPublicSettings();
		raw["general.pagination.page_size"] = 99;
		expect(await getCachedPageSize()).toBe(30);
		await vi.advanceTimersByTimeAsync(299_999);
		expect(await getCachedPageSize()).toBe(30);
		expect(mockGet).toHaveBeenCalledTimes(1);
		mockGet.mockResolvedValue({ data: { "general.pagination.page_size": 40 } });
		await vi.advanceTimersByTimeAsync(1);
		expect(await getCachedPageSize()).toBe(40);
		expect(mockGet).toHaveBeenCalledTimes(2);
	});

	it("does not retain a failed settings fetch", async () => {
		mockGet.mockRejectedValueOnce(new Error("offline"));
		expect(await getCachedPageSize()).toBe(20);
		mockGet.mockResolvedValue({ data: { "general.pagination.page_size": 35 } });
		expect(await getCachedPageSize()).toBe(35);
		expect(mockGet).toHaveBeenCalledTimes(2);
	});

	it("shares one settings load across concurrent page and API requests and route modules", async () => {
		const settings = {
			"general.site.name": "Ellie",
			"features.access.require_login": true,
		};
		mockGet.mockResolvedValue({ data: settings });
		const { GET } = await import("@/app/api/v1/settings/route");
		const [page, response] = await Promise.all([
			getCachedPublicSettings(),
			GET(new Request("https://example.com/api/v1/settings?prefix=features.")),
		]);
		expect(page).toEqual(settings);
		expect(await response.json()).toEqual({ "features.access.require_login": true });
		vi.resetModules();
		const otherRoute = await import("@/app/api/v1/settings/route");
		for (const prefix of ["", "general.", "private."]) {
			const result = await otherRoute.GET(
				new Request(`https://example.com/api/v1/settings?prefix=${prefix}`),
			);
			expect(await result.json()).toEqual(
				Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith(prefix))),
			);
		}
		expect(mockGet).toHaveBeenCalledExactlyOnceWith("/api/v1/settings");
	});

	it("does not cache the settings API error response", async () => {
		const { GET } = await import("@/app/api/v1/settings/route");
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			mockGet.mockRejectedValueOnce(new Error("offline"));
			const request = new Request("https://example.com/api/v1/settings");
			expect(await (await GET(request)).json()).toEqual({});
			mockGet.mockResolvedValue({ data: { "general.site.name": "Ellie" } });
			expect(await (await GET(request)).json()).toEqual({ "general.site.name": "Ellie" });
			expect(mockGet).toHaveBeenCalledTimes(2);
		} finally {
			error.mockRestore();
		}
	});

	it.each([
		[],
		[{ id: 1, name: "Public", lastThreadId: 0, lastPosterId: 0 }],
		[{ id: 1, name: "Public", lastThreadId: 42, lastPosterId: 0 }],
	])("observes a Worker-invalidated summary on the next render: %j", async (updated) => {
		const { getCachedForumStructure, getCachedForumAncestors } = await import("@/lib/forum-cache");
		vi.mocked(forumApi.getAll)
			.mockResolvedValueOnce({
				data: [{ id: 1, name: "Public", lastThreadId: 42, lastPosterId: 20 }],
			} as never)
			.mockResolvedValue({ data: updated } as never);
		await getCachedForumStructure(null);
		// React cache is identity here: each call stands for a separate render.
		expect((await getCachedForumStructure(null)).forums).toEqual(updated);
		expect(forumApi.getAll).toHaveBeenCalledTimes(2);
		mockGet.mockResolvedValue({ data: { forum: { id: 1 }, ancestors: [] } });
		await getCachedForumAncestors(1);
		await getCachedForumAncestors(1);
		expect(mockGet).toHaveBeenCalledTimes(2);
	});

	describe("getCachedPageSize", () => {
		it("returns pageSize from settings", async () => {
			mockGet.mockResolvedValue({ data: { "general.pagination.page_size": 50 } });
			expect(await getCachedPageSize()).toBe(50);
		});
	});

	describe("getCachedPostsPerPage", () => {
		it("returns postsPerPage from settings", async () => {
			mockGet.mockResolvedValue({ data: { "general.pagination.posts_per_page": 40 } });
			expect(await getCachedPostsPerPage()).toBe(40);
		});
	});

	describe("getCachedPublicSettings", () => {
		it("returns raw settings map from API", async () => {
			const rawData = { "features.access.maintenance_mode": false, "general.site.name": "Ellie" };
			mockGet.mockResolvedValue({ data: rawData });
			const result = await getCachedPublicSettings();
			expect(result).toEqual(rawData);
		});

		it("loads the public settings endpoint", async () => {
			mockGet.mockResolvedValue({ data: {} });
			await getCachedPublicSettings();
			expect(mockGet).toHaveBeenCalledWith("/api/v1/settings");
		});
	});
});
