import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", () => ({ cache: (fn: (...args: unknown[]) => unknown) => fn }));
vi.mock("@/lib/forum-api", () => ({ forumApi: { get: vi.fn() } }));

import { forumApi } from "@/lib/forum-api";
import { getForumSettings, getPageSize, getPostsPerPage } from "@/lib/forum-settings";

const mockGet = forumApi.get as ReturnType<typeof vi.fn>;

describe("forum-settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("getForumSettings", () => {
		it("returns parsed settings from API", async () => {
			mockGet.mockResolvedValue({
				data: {
					"general.pagination.page_size": 30,
					"general.pagination.posts_per_page": 15,
					"general.pagination.max_post_length": 80000,
				},
			});
			const settings = await getForumSettings();
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
			const settings = await getForumSettings();
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
			const settings = await getForumSettings();
			expect(settings).toEqual({ pageSize: 20, postsPerPage: 20, maxPostLength: 50000 });
		});

		it("returns defaults on error", async () => {
			mockGet.mockRejectedValue(new Error("network"));
			const settings = await getForumSettings();
			expect(settings).toEqual({ pageSize: 20, postsPerPage: 20, maxPostLength: 50000 });
		});

		it("uses defaults for missing keys", async () => {
			mockGet.mockResolvedValue({ data: {} });
			const settings = await getForumSettings();
			expect(settings).toEqual({ pageSize: 20, postsPerPage: 20, maxPostLength: 50000 });
		});
	});

	describe("getPageSize", () => {
		it("returns pageSize from settings", async () => {
			mockGet.mockResolvedValue({ data: { "general.pagination.page_size": 50 } });
			expect(await getPageSize()).toBe(50);
		});
	});

	describe("getPostsPerPage", () => {
		it("returns postsPerPage from settings", async () => {
			mockGet.mockResolvedValue({ data: { "general.pagination.posts_per_page": 40 } });
			expect(await getPostsPerPage()).toBe(40);
		});
	});
});
