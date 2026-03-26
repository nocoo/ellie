import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import { UserStatus } from "@/models/types";

describe("createRepositories — cross-repo consistency", () => {
	test("thread.create produces a first post visible in post repo", async () => {
		const repos = createRepositories();
		const thread = await repos.threads.create({
			forumId: 10,
			authorId: 1,
			authorName: "admin",
			subject: "Cross-repo test",
			content: "<p>First post</p>",
		});

		const posts = await repos.posts.list({ threadId: thread.id });
		expect(posts.items.length).toBe(1);
		expect(posts.items[0].isFirst).toBe(true);
		expect(posts.items[0].content).toBe("<p>First post</p>");
	});

	test("post.create updates thread reply count visible via thread repo", async () => {
		const repos = createRepositories();
		const thread = await repos.threads.create({
			forumId: 10,
			authorId: 1,
			authorName: "admin",
			subject: "Reply count test",
			content: "<p>Original</p>",
		});

		await repos.posts.create({
			threadId: thread.id,
			authorId: 10,
			authorName: "zhangsan",
			content: "<p>Reply</p>",
		});

		const updated = await repos.threads.getById(thread.id);
		expect(updated?.replies).toBe(1);
		expect(updated?.lastPoster).toBe("zhangsan");
	});

	test("user.setStatus change is reflected in auth validation", async () => {
		const repos = createRepositories();
		const { validateMockCredentials } = await import("@/auth");

		// User can authenticate initially
		const user = validateMockCredentials(repos._store.users, "admin", "admin");
		expect(user).not.toBeNull();

		// Ban the user via user repository
		await repos.users.setStatus(user?.id, UserStatus.Banned);

		// Auth now rejects
		expect(validateMockCredentials(repos._store.users, "admin", "admin")).toBeNull();
	});

	test("all repos share the same store instance", () => {
		const repos = createRepositories();
		// _store is the single source of truth
		expect(repos._store.users.length).toBeGreaterThan(0);
		expect(repos._store.threads.length).toBeGreaterThan(0);
		expect(repos._store.posts.length).toBeGreaterThan(0);
		expect(repos._store.forums.length).toBeGreaterThan(0);
	});
});
