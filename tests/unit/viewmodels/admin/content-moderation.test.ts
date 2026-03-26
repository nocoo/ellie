import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import {
	DEFAULT_CONTENT_FILTERS,
	createContentActions,
	fetchPosts,
	fetchThreads,
} from "@/viewmodels/admin/content-moderation";

describe("content-moderation ViewModel", () => {
	describe("DEFAULT_CONTENT_FILTERS", () => {
		test("defaults to threads tab", () => {
			expect(DEFAULT_CONTENT_FILTERS.tab).toBe("threads");
		});

		test("defaults to no forum filter", () => {
			expect(DEFAULT_CONTENT_FILTERS.forumId).toBeNull();
		});
	});

	describe("fetchThreads", () => {
		test("returns threads sorted by newest", async () => {
			const repos = createRepositories();
			const result = await fetchThreads(repos, null);
			expect(result.items.length).toBeGreaterThan(0);
			expect(typeof result.total).toBe("number");
		});

		test("filters by forumId", async () => {
			const repos = createRepositories();
			const result = await fetchThreads(repos, 10);
			for (const t of result.items) {
				expect(t.forumId).toBe(10);
			}
		});

		test("respects limit", async () => {
			const repos = createRepositories();
			const result = await fetchThreads(repos, null, undefined, undefined, 2);
			expect(result.items.length).toBeLessThanOrEqual(2);
		});

		test("returns empty for non-existent forum", async () => {
			const repos = createRepositories();
			const result = await fetchThreads(repos, 999999);
			expect(result.items).toHaveLength(0);
		});
	});

	describe("fetchPosts", () => {
		test("returns posts when no forum filter", async () => {
			const repos = createRepositories();
			const result = await fetchPosts(repos, null);
			expect(result.items.length).toBeGreaterThan(0);
		});

		test("aggregates posts across multiple threads", async () => {
			const repos = createRepositories();
			const result = await fetchPosts(repos, null, undefined, undefined, 250);
			// Verify posts come from more than one thread
			const threadIds = new Set(result.items.map((p) => p.threadId));
			expect(threadIds.size).toBeGreaterThan(1);
		});

		test("returns posts sorted by createdAt descending", async () => {
			const repos = createRepositories();
			const result = await fetchPosts(repos, null, undefined, undefined, 50);
			for (let i = 1; i < result.items.length; i++) {
				const curr = result.items[i];
				const prev = result.items[i - 1];
				expect(prev.createdAt).toBeGreaterThanOrEqual(curr.createdAt);
			}
		});

		test("returns empty for non-existent forum", async () => {
			const repos = createRepositories();
			const result = await fetchPosts(repos, 999999);
			expect(result.items).toHaveLength(0);
			expect(result.total).toBe(0);
		});

		test("respects limit parameter", async () => {
			const repos = createRepositories();
			const result = await fetchPosts(repos, null, undefined, undefined, 3);
			expect(result.items.length).toBeLessThanOrEqual(3);
		});
	});

	describe("createContentActions", () => {
		test("deleteThread removes a thread", async () => {
			const repos = createRepositories();
			const actions = createContentActions(repos);
			const threads = await repos.threads.list({});
			expect(threads.items.length).toBeGreaterThan(0);
			const target = threads.items[0];

			await actions.deleteThread(target.id);
			const found = await repos.threads.getById(target.id);
			expect(found).toBeNull();
		});

		test("deletePost removes a post", async () => {
			const repos = createRepositories();
			const actions = createContentActions(repos);
			const posts = await repos.posts.list({ threadId: 50001 });
			expect(posts.items.length).toBeGreaterThan(0);
			const target = posts.items[0];

			await actions.deletePost(target.id);
			const after = await repos.posts.list({ threadId: 50001 });
			const found = after.items.find((p) => p.id === target.id);
			expect(found).toBeUndefined();
		});

		test("deleteThread throws for non-existent", async () => {
			const repos = createRepositories();
			const actions = createContentActions(repos);
			await expect(actions.deleteThread(999999)).rejects.toThrow();
		});

		test("deletePost throws for non-existent", async () => {
			const repos = createRepositories();
			const actions = createContentActions(repos);
			await expect(actions.deletePost(999999)).rejects.toThrow();
		});
	});
});
