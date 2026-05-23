import { beforeEach, describe, expect, it, vi } from "vitest";

// React `cache()` is mocked to identity so we don't dedupe across cases
// (each `getCached*` call goes through to the underlying loader).
vi.mock("react", () => ({ cache: (fn: (...args: unknown[]) => unknown) => fn }));
vi.mock("@/lib/forum-api", () => ({ forumApi: { get: vi.fn() } }));

import { forumApi } from "@/lib/forum-api";
import {
	getCachedForumSettings,
	getCachedPageSize,
	getCachedPostsPerPage,
	getCachedPublicSettings,
} from "@/lib/forum-cache";

const mockGet = forumApi.get as ReturnType<typeof vi.fn>;

describe("forum-settings (via lib/forum-cache)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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

		it("passes revalidate option to forumApi.get", async () => {
			mockGet.mockResolvedValue({ data: {} });
			await getCachedPublicSettings();
			expect(mockGet).toHaveBeenCalledWith("/api/v1/settings", { revalidate: 60 });
		});
	});
});
