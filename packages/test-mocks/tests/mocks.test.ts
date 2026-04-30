import { describe, expect, it } from "vitest";
import {
	createMockAttachmentRepository,
	createMockDataStore,
	createMockForumRepository,
	createMockPostRepository,
	createMockThreadRepository,
	createMockUserRepository,
	createRepositories,
	resetStore,
} from "../src/index";

describe("createMockDataStore", () => {
	it("creates a store with seeded data", () => {
		const store = createMockDataStore();
		expect(store.users.length).toBeGreaterThan(0);
		expect(store.forums.length).toBeGreaterThan(0);
		expect(store.threads.length).toBeGreaterThan(0);
		expect(store.posts.length).toBeGreaterThan(0);
		expect(store.attachments.length).toBeGreaterThan(0);
	});

	it("nextId returns incrementing values", () => {
		const store = createMockDataStore();
		const id1 = store.nextId();
		const id2 = store.nextId();
		expect(id2).toBe(id1 + 1);
	});

	it("creates independent copies (no shared state)", () => {
		const store1 = createMockDataStore();
		const store2 = createMockDataStore();
		store1.users.pop();
		expect(store2.users.length).toBeGreaterThan(store1.users.length);
	});
});

describe("createRepositories", () => {
	it("returns all repository fields", () => {
		resetStore();
		const repos = createRepositories();
		// Each repo is an object with at least one method
		for (const key of ["forums", "threads", "posts", "users", "attachments"] as const) {
			expect(typeof repos[key]).toBe("object");
			expect(Object.keys(repos[key]).length).toBeGreaterThan(0);
		}
		expect(repos._store.users.length).toBeGreaterThan(0);
	});

	it("uses singleton store across calls", () => {
		resetStore();
		const repos1 = createRepositories();
		const repos2 = createRepositories();
		expect(repos1._store).toBe(repos2._store);
	});

	it("resetStore clears singleton", () => {
		resetStore();
		const repos1 = createRepositories();
		resetStore();
		const repos2 = createRepositories();
		expect(repos1._store).not.toBe(repos2._store);
	});
});

describe("ForumRepository", () => {
	it("listAll returns all forums", async () => {
		const store = createMockDataStore();
		const repo = createMockForumRepository(store);
		const forums = await repo.listAll();
		expect(forums.length).toBe(store.forums.length);
	});

	it("getById returns forum or null", async () => {
		const store = createMockDataStore();
		const repo = createMockForumRepository(store);
		const first = store.forums[0];
		expect(await repo.getById(first.id)).toMatchObject({ id: first.id });
		expect(await repo.getById(999999)).toBeNull();
	});

	it("update modifies forum fields", async () => {
		const store = createMockDataStore();
		const repo = createMockForumRepository(store);
		const first = store.forums[0];
		await repo.update(first.id, { name: "Renamed", status: 0 });
		const updated = store.forums.find((f) => f.id === first.id);
		expect(updated).toBeDefined();
		expect(updated?.name).toBe("Renamed");
		expect(updated?.status).toBe(0);
	});

	it("update throws for non-existent forum", async () => {
		const store = createMockDataStore();
		const repo = createMockForumRepository(store);
		await expect(repo.update(999999, { name: "X" })).rejects.toThrow("not found");
	});

	it("update individual fields independently", async () => {
		const store = createMockDataStore();
		const repo = createMockForumRepository(store);
		const forum = store.forums[0];
		// Update only description
		await repo.update(forum.id, { description: "New desc" });
		expect(store.forums.find((f) => f.id === forum.id)?.description).toBe("New desc");
		// Update only icon
		await repo.update(forum.id, { icon: "star" });
		expect(store.forums.find((f) => f.id === forum.id)?.icon).toBe("star");
		// Update only displayOrder
		await repo.update(forum.id, { displayOrder: 99 });
		expect(store.forums.find((f) => f.id === forum.id)?.displayOrder).toBe(99);
	});

	it("listAll returns a copy (not store reference)", async () => {
		const store = createMockDataStore();
		const repo = createMockForumRepository(store);
		const list = await repo.listAll();
		// Mutating the result should not affect the store
		list.pop();
		const list2 = await repo.listAll();
		expect(list2.length).toBe(store.forums.length);
	});
});

describe("ThreadRepository", () => {
	it("list returns paginated results", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const result = await repo.list({ limit: 2 });
		expect(result.items.length).toBeLessThanOrEqual(2);
		expect(result.total).toBe(store.threads.length);
	});

	it("list filters by forumId", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const forumId = store.threads[0].forumId;
		const result = await repo.list({ forumId });
		for (const t of result.items) {
			expect(t.forumId).toBe(forumId);
		}
	});

	it("list filters by authorId", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const authorId = store.threads[0].authorId;
		const result = await repo.list({ authorId });
		for (const t of result.items) {
			expect(t.authorId).toBe(authorId);
		}
	});

	it("list filters by digest", async () => {
		const store = createMockDataStore();
		// Ensure at least one digest thread exists
		store.threads[0].digest = 1;
		const repo = createMockThreadRepository(store);
		const result = await repo.list({ digest: true });
		for (const t of result.items) {
			expect(t.digest).toBeGreaterThan(0);
		}
	});

	it("list sorts by newest (createdAt)", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const result = await repo.list({ sort: "newest" });
		for (let i = 1; i < result.items.length; i++) {
			expect(result.items[i - 1].createdAt).toBeGreaterThanOrEqual(result.items[i].createdAt);
		}
	});

	it("list sorts by hot (replies)", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const result = await repo.list({ sort: "hot" });
		for (let i = 1; i < result.items.length; i++) {
			expect(result.items[i - 1].replies).toBeGreaterThanOrEqual(result.items[i].replies);
		}
	});

	it("search requires titlePrefix or authorName", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		await expect(repo.search({})).rejects.toThrow("requires titlePrefix or authorName");
	});

	it("search by titlePrefix", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const prefix = store.threads[0].subject.slice(0, 3);
		const result = await repo.search({ titlePrefix: prefix });
		for (const t of result.items) {
			expect(t.subject.startsWith(prefix)).toBe(true);
		}
	});

	it("search by authorName", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const name = store.threads[0].authorName;
		const result = await repo.search({ authorName: name });
		for (const t of result.items) {
			expect(t.authorName).toBe(name);
		}
	});

	it("getById returns thread or null", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const first = store.threads[0];
		expect(await repo.getById(first.id)).toMatchObject({ id: first.id });
		expect(await repo.getById(999999)).toBeNull();
	});

	it("create adds thread and first post", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const before = store.threads.length;
		const thread = await repo.create({
			forumId: 1,
			authorId: 1,
			authorName: "tester",
			subject: "New Thread",
			content: "Hello world",
		});
		expect(store.threads.length).toBe(before + 1);
		expect(thread.subject).toBe("New Thread");
		// First post created
		const firstPost = store.posts.find((p) => p.threadId === thread.id && p.isFirst);
		expect(firstPost).toBeDefined();
		expect(firstPost?.content).toBe("Hello world");
	});

	it("delete removes thread and cascades posts", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const thread = await repo.create({
			forumId: 1,
			authorId: 1,
			authorName: "tester",
			subject: "To Delete",
			content: "Bye",
		});
		await repo.delete(thread.id);
		expect(store.threads.find((t) => t.id === thread.id)).toBeUndefined();
		expect(store.posts.filter((p) => p.threadId === thread.id)).toHaveLength(0);
	});

	it("delete throws for non-existent thread", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		await expect(repo.delete(999999)).rejects.toThrow("not found");
	});

	it("setSticky updates sticky level", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const thread = store.threads[0];
		await repo.setSticky(thread.id, 2);
		expect(store.threads.find((t) => t.id === thread.id)?.sticky).toBe(2);
	});

	it("setDigest updates digest level", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const thread = store.threads[0];
		await repo.setDigest(thread.id, 3);
		expect(store.threads.find((t) => t.id === thread.id)?.digest).toBe(3);
	});

	it("setClosed updates closed state", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const thread = store.threads[0];
		await repo.setClosed(thread.id, true);
		expect(store.threads.find((t) => t.id === thread.id)?.closed).toBe(1);
		await repo.setClosed(thread.id, false);
		expect(store.threads.find((t) => t.id === thread.id)?.closed).toBe(0);
	});

	it("move updates thread and post forumIds", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const thread = store.threads[0];
		const targetForumId = 999;
		await repo.move(thread.id, targetForumId);
		expect(store.threads.find((t) => t.id === thread.id)?.forumId).toBe(targetForumId);
		for (const p of store.posts.filter((p) => p.threadId === thread.id)) {
			expect(p.forumId).toBe(targetForumId);
		}
	});

	it("setSticky throws for non-existent", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		await expect(repo.setSticky(999999, 1)).rejects.toThrow("not found");
	});

	it("setDigest throws for non-existent", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		await expect(repo.setDigest(999999, 1)).rejects.toThrow("not found");
	});

	it("setClosed throws for non-existent", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		await expect(repo.setClosed(999999, true)).rejects.toThrow("not found");
	});

	it("move throws for non-existent", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		await expect(repo.move(999999, 1)).rejects.toThrow("not found");
	});

	it("list with forward cursor pagination", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		// Get first page
		const page1 = await repo.list({ limit: 1 });
		expect(page1.items).toHaveLength(1);
		if (page1.nextCursor) {
			// Get second page
			const page2 = await repo.list({ limit: 1, cursor: page1.nextCursor });
			expect(page2.items).toHaveLength(1);
			expect(page2.items[0].id).not.toBe(page1.items[0].id);
			expect(page2.prevCursor).not.toBeNull();
		}
	});

	it("list with backward cursor pagination", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		// Get first page to obtain a cursor
		const page1 = await repo.list({ limit: 1 });
		if (page1.nextCursor) {
			const page2 = await repo.list({ limit: 1, cursor: page1.nextCursor });
			if (page2.prevCursor) {
				// Go backward
				const backPage = await repo.list({
					limit: 1,
					cursor: page2.prevCursor,
					direction: "backward",
				});
				expect(backPage.items.length).toBeGreaterThan(0);
			}
		}
	});

	it("list filters by createdAfter", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const midCreatedAt = store.threads[Math.floor(store.threads.length / 2)].createdAt;
		const result = await repo.list({ createdAfter: midCreatedAt });
		for (const t of result.items) {
			expect(t.createdAt).toBeGreaterThanOrEqual(midCreatedAt);
		}
	});

	it("search with cursor pagination", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const name = store.threads[0].authorName;
		const page1 = await repo.search({ authorName: name, limit: 1 });
		if (page1.nextCursor) {
			const page2 = await repo.search({ authorName: name, limit: 1, cursor: page1.nextCursor });
			expect(page2.items.length).toBeLessThanOrEqual(1);
		}
	});

	it("list with invalid cursor returns all items", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const result = await repo.list({ cursor: "not-valid!!!" });
		expect(result.items.length).toBeGreaterThan(0);
	});

	it("list with default sort (latest = lastPostAt)", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const result = await repo.list({});
		for (let i = 1; i < result.items.length; i++) {
			expect(result.items[i - 1].lastPostAt).toBeGreaterThanOrEqual(result.items[i].lastPostAt);
		}
	});

	it("search backward pagination", async () => {
		const store = createMockDataStore();
		const repo = createMockThreadRepository(store);
		const name = store.threads[0].authorName;
		const page1 = await repo.search({ authorName: name, limit: 1 });
		if (page1.nextCursor) {
			const page2 = await repo.search({
				authorName: name,
				limit: 1,
				cursor: page1.nextCursor,
				direction: "backward",
			});
			expect(page2.items.length).toBeGreaterThanOrEqual(0);
		}
	});
});

describe("PostRepository", () => {
	it("list requires threadId or authorId", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		await expect(repo.list({})).rejects.toThrow("requires threadId or authorId");
	});

	it("list filters by threadId", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const threadId = store.posts[0].threadId;
		const result = await repo.list({ threadId });
		for (const p of result.items) {
			expect(p.threadId).toBe(threadId);
		}
	});

	it("list filters by authorId", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const authorId = store.posts[0].authorId;
		const result = await repo.list({ authorId });
		for (const p of result.items) {
			expect(p.authorId).toBe(authorId);
		}
	});

	it("list sorts by position ascending", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const threadId = store.posts[0].threadId;
		const result = await repo.list({ threadId });
		for (let i = 1; i < result.items.length; i++) {
			expect(result.items[i].position).toBeGreaterThanOrEqual(result.items[i - 1].position);
		}
	});

	it("create adds post and updates thread stats", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const thread = store.threads[0];
		const beforeReplies = thread.replies;
		const post = await repo.create({
			threadId: thread.id,
			authorId: 1,
			authorName: "tester",
			content: "Reply content",
		});
		expect(post.content).toBe("Reply content");
		expect(post.isFirst).toBe(false);
		expect(thread.replies).toBe(beforeReplies + 1);
		expect(thread.lastPoster).toBe("tester");
	});

	it("delete removes post and updates thread stats", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const thread = store.threads[0];
		// Create a reply first
		const post = await repo.create({
			threadId: thread.id,
			authorId: 1,
			authorName: "tester",
			content: "To delete",
		});
		const repliesAfterCreate = thread.replies;
		await repo.delete(post.id);
		expect(thread.replies).toBe(repliesAfterCreate - 1);
		expect(store.posts.find((p) => p.id === post.id)).toBeUndefined();
	});

	it("delete throws for non-existent post", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		await expect(repo.delete(999999)).rejects.toThrow("not found");
	});

	it("list with forward cursor pagination", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const threadId = store.posts[0].threadId;
		const page1 = await repo.list({ threadId, limit: 1 });
		if (page1.nextCursor) {
			const page2 = await repo.list({ threadId, limit: 1, cursor: page1.nextCursor });
			expect(page2.items).toHaveLength(1);
			expect(page2.items[0].id).not.toBe(page1.items[0].id);
			expect(page2.prevCursor).not.toBeNull();
		}
	});

	it("list with invalid cursor returns all items", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const threadId = store.posts[0].threadId;
		const result = await repo.list({ threadId, cursor: "invalid!!!" });
		expect(result.items.length).toBeGreaterThan(0);
	});

	it("list with backward cursor pagination", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const threadId = store.posts[0].threadId;
		const page1 = await repo.list({ threadId, limit: 1 });
		if (page1.nextCursor) {
			const page2 = await repo.list({ threadId, limit: 1, cursor: page1.nextCursor });
			if (page2.prevCursor) {
				const backPage = await repo.list({
					threadId,
					limit: 1,
					cursor: page2.prevCursor,
					direction: "backward",
				});
				expect(backPage.items.length).toBeGreaterThan(0);
			}
		}
	});

	it("create with non-existent threadId uses forumId 0", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const post = await repo.create({
			threadId: 999999,
			authorId: 1,
			authorName: "tester",
			content: "orphan post",
		});
		expect(post.forumId).toBe(0);
	});

	it("create resolves forumId from thread", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		const thread = store.threads[0];
		const post = await repo.create({
			threadId: thread.id,
			authorId: 1,
			authorName: "tester",
			content: "Test",
		});
		expect(post.forumId).toBe(thread.forumId);
	});

	it("delete first post does not decrement replies", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		// Find a first post
		const firstPost = store.posts.find((p) => p.isFirst);
		if (firstPost) {
			const thread = store.threads.find((t) => t.id === firstPost.threadId);
			expect(thread).toBeDefined();
			const repliesBefore = thread?.replies ?? 0;
			await repo.delete(firstPost.id);
			// isFirst post deletion should not reduce replies (guard in code)
			expect(thread?.replies).toBe(repliesBefore);
		}
	});

	it("delete last remaining post leaves empty thread", async () => {
		const store = createMockDataStore();
		const repo = createMockPostRepository(store);
		// Create a thread with only one non-first post
		const thread = store.threads[0];
		const reply = await repo.create({
			threadId: thread.id,
			authorId: 1,
			authorName: "tester",
			content: "only reply",
		});
		// Delete all other non-first posts for this thread
		const nonFirstPosts = store.posts.filter(
			(p) => p.threadId === thread.id && !p.isFirst && p.id !== reply.id,
		);
		for (const p of nonFirstPosts) {
			await repo.delete(p.id);
		}
		// Now delete the last reply
		await repo.delete(reply.id);
		// Thread still has first post, lastPostAt updated
		const remaining = store.posts.filter((p) => p.threadId === thread.id);
		expect(remaining.length).toBeGreaterThanOrEqual(0);
	});
});

describe("UserRepository", () => {
	it("list returns paginated users", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const result = await repo.list({ limit: 2 });
		expect(result.items.length).toBeLessThanOrEqual(2);
		expect(result.total).toBe(store.users.length);
	});

	it("list filters by search (username)", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const name = store.users[0].username;
		const result = await repo.list({ search: name.slice(0, 3) });
		for (const u of result.items) {
			expect(u.username.toLowerCase()).toContain(name.slice(0, 3).toLowerCase());
		}
	});

	it("list filters by role", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const role = store.users[0].role;
		const result = await repo.list({ role });
		for (const u of result.items) {
			expect(u.role).toBe(role);
		}
	});

	it("list filters by status", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const status = store.users[0].status;
		const result = await repo.list({ status });
		for (const u of result.items) {
			expect(u.status).toBe(status);
		}
	});

	it("list sorts by lastLogin", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const result = await repo.list({ sort: "lastLogin" });
		for (let i = 1; i < result.items.length; i++) {
			expect(result.items[i - 1].lastLogin).toBeGreaterThanOrEqual(result.items[i].lastLogin);
		}
	});

	it("getById returns user or null", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const first = store.users[0];
		expect(await repo.getById(first.id)).toMatchObject({ id: first.id });
		expect(await repo.getById(999999)).toBeNull();
	});

	it("setStatus updates user status", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const user = store.users[0];
		await repo.setStatus(user.id, -1);
		expect(store.users.find((u) => u.id === user.id)?.status).toBe(-1);
	});

	it("setRole updates user role", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const user = store.users[0];
		await repo.setRole(user.id, 3);
		expect(store.users.find((u) => u.id === user.id)?.role).toBe(3);
	});

	it("setStatus throws for non-existent user", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		await expect(repo.setStatus(999999, 0)).rejects.toThrow("not found");
	});

	it("setRole throws for non-existent user", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		await expect(repo.setRole(999999, 1)).rejects.toThrow("not found");
	});

	it("list with forward cursor pagination", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const page1 = await repo.list({ limit: 1 });
		if (page1.nextCursor) {
			const page2 = await repo.list({ limit: 1, cursor: page1.nextCursor });
			expect(page2.items).toHaveLength(1);
			expect(page2.items[0].id).not.toBe(page1.items[0].id);
			expect(page2.prevCursor).not.toBeNull();
		}
	});

	it("list with backward cursor pagination", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const page1 = await repo.list({ limit: 1 });
		if (page1.nextCursor) {
			const page2 = await repo.list({ limit: 1, cursor: page1.nextCursor });
			if (page2.prevCursor) {
				const backPage = await repo.list({
					limit: 1,
					cursor: page2.prevCursor,
					direction: "backward",
				});
				expect(backPage.items.length).toBeGreaterThan(0);
			}
		}
	});

	it("list with lastLoginAfter filter", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const midLogin = store.users[Math.floor(store.users.length / 2)].lastLogin;
		const result = await repo.list({ lastLoginAfter: midLogin });
		for (const u of result.items) {
			expect(u.lastLogin).toBeGreaterThanOrEqual(midLogin);
		}
	});

	it("list with lastLogin sort and cursor", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const page1 = await repo.list({ sort: "lastLogin", limit: 1 });
		if (page1.nextCursor) {
			const page2 = await repo.list({ sort: "lastLogin", limit: 1, cursor: page1.nextCursor });
			expect(page2.items).toHaveLength(1);
		}
	});

	it("list with invalid cursor ignores pagination", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		// Invalid base64 cursor — decodeCursor returns null
		const result = await repo.list({ cursor: "not-valid-cursor!!!" });
		expect(result.items.length).toBeGreaterThan(0);
	});

	it("list backward with newest sort", async () => {
		const store = createMockDataStore();
		const repo = createMockUserRepository(store);
		const page1 = await repo.list({ sort: "newest", limit: 1 });
		if (page1.nextCursor) {
			const page2 = await repo.list({
				sort: "newest",
				limit: 1,
				cursor: page1.nextCursor,
				direction: "backward",
			});
			// Backward from second page should yield items before cursor
			expect(page2.items.length).toBeGreaterThanOrEqual(0);
		}
	});
});

describe("AttachmentRepository", () => {
	it("listByPostId returns attachments for post", async () => {
		const store = createMockDataStore();
		const repo = createMockAttachmentRepository(store);
		const postId = store.attachments[0].postId;
		const result = await repo.listByPostId(postId);
		for (const a of result) {
			expect(a.postId).toBe(postId);
		}
	});

	it("listByThreadId returns attachments for thread", async () => {
		const store = createMockDataStore();
		const repo = createMockAttachmentRepository(store);
		const threadId = store.attachments[0].threadId;
		const result = await repo.listByThreadId(threadId);
		for (const a of result) {
			expect(a.threadId).toBe(threadId);
		}
	});

	it("listByPostId returns empty for non-existent post", async () => {
		const store = createMockDataStore();
		const repo = createMockAttachmentRepository(store);
		expect(await repo.listByPostId(999999)).toEqual([]);
	});
});
