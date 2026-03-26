import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import { buildSearchParams, executeSearch, isValidSearchQuery } from "@/viewmodels/forum/search";

describe("search ViewModel", () => {
	describe("buildSearchParams", () => {
		test("title search sets titlePrefix", () => {
			const params = buildSearchParams({
				query: "hello",
				searchType: "title",
			});
			expect(params.titlePrefix).toBe("hello");
			expect(params.authorName).toBeUndefined();
		});

		test("author search sets authorName", () => {
			const params = buildSearchParams({
				query: "admin",
				searchType: "author",
			});
			expect(params.authorName).toBe("admin");
			expect(params.titlePrefix).toBeUndefined();
		});

		test("includes pagination params", () => {
			const params = buildSearchParams({
				query: "test",
				searchType: "title",
				cursor: "abc",
				direction: "forward",
				limit: 10,
			});
			expect(params.cursor).toBe("abc");
			expect(params.direction).toBe("forward");
			expect(params.limit).toBe(10);
		});

		test("defaults limit to 20", () => {
			const params = buildSearchParams({
				query: "test",
				searchType: "title",
			});
			expect(params.limit).toBe(20);
		});
	});

	describe("isValidSearchQuery", () => {
		test("valid query", () => {
			expect(isValidSearchQuery("hello")).toBe(true);
		});

		test("empty query invalid", () => {
			expect(isValidSearchQuery("")).toBe(false);
		});

		test("whitespace-only invalid", () => {
			expect(isValidSearchQuery("   ")).toBe(false);
		});

		test("too-long query invalid (>50)", () => {
			expect(isValidSearchQuery("a".repeat(51))).toBe(false);
		});

		test("50-char query valid", () => {
			expect(isValidSearchQuery("a".repeat(50))).toBe(true);
		});

		test("single char valid", () => {
			expect(isValidSearchQuery("a")).toBe(true);
		});
	});

	describe("executeSearch", () => {
		test("returns empty for invalid query", async () => {
			const repos = createRepositories();
			const result = await executeSearch(repos, {
				query: "",
				searchType: "title",
			});
			expect(result.items.length).toBe(0);
			expect(result.total).toBe(0);
		});

		test("returns results for title search", async () => {
			const repos = createRepositories();
			// Create a thread to search for
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum");

			await repos.threads.create({
				forumId: forum.id,
				authorId: 1,
				authorName: "tester",
				subject: "SearchableTitle123",
				content: "<p>Content</p>",
			});

			const result = await executeSearch(repos, {
				query: "SearchableTitle",
				searchType: "title",
			});
			expect(result.items.length).toBeGreaterThan(0);
		});

		test("returns results for author search", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum");

			await repos.threads.create({
				forumId: forum.id,
				authorId: 1,
				authorName: "UniqueSearchAuthor",
				subject: "Test Thread",
				content: "<p>Content</p>",
			});

			const result = await executeSearch(repos, {
				query: "UniqueSearchAuthor",
				searchType: "author",
			});
			expect(result.items.length).toBeGreaterThan(0);
		});
	});
});
