import { describe, expect, it } from "bun:test";
import { canSubmit, submitPost } from "../../../../apps/web/src/viewmodels/forum/post-editor";
import { createRepositories, resetStore } from "../../../../packages/repositories/src";

// ---------------------------------------------------------------------------
// canSubmit
// ---------------------------------------------------------------------------

describe("canSubmit", () => {
	it("thread mode: requires both subject and content", () => {
		expect(canSubmit("thread", "", "")).toBe(false);
		expect(canSubmit("thread", "Title", "")).toBe(false);
		expect(canSubmit("thread", "", "Content")).toBe(false);
		expect(canSubmit("thread", "Title", "Content")).toBe(true);
	});

	it("thread mode: trims whitespace", () => {
		expect(canSubmit("thread", "  ", "Content")).toBe(false);
		expect(canSubmit("thread", "Title", "  ")).toBe(false);
	});

	it("reply mode: requires only content", () => {
		expect(canSubmit("reply", "", "")).toBe(false);
		expect(canSubmit("reply", "", "Content")).toBe(true);
	});

	it("reply mode: ignores subject", () => {
		expect(canSubmit("reply", "anything", "")).toBe(false);
	});

	it("reply mode: trims whitespace", () => {
		expect(canSubmit("reply", "", "   ")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// submitPost
// ---------------------------------------------------------------------------

describe("submitPost", () => {
	it("thread mode: creates a thread and returns threadId", async () => {
		resetStore();
		const repos = createRepositories();
		const result = await submitPost(repos, "thread", 10, "Test subject", "<p>Test</p>", 1, "admin");

		expect(result.success).toBe(true);
		expect(result.threadId).toBeDefined();
		expect(typeof result.threadId).toBe("number");
	});

	it("reply mode: creates a post and returns success without threadId", async () => {
		resetStore();
		const repos = createRepositories();

		// First create a thread for the post to belong to
		const thread = await repos.threads.create({
			forumId: 10,
			subject: "Test thread",
			content: "<p>Test</p>",
			authorId: 1,
			authorName: "admin",
		});

		const result = await submitPost(
			repos,
			"reply",
			thread.id,
			"",
			"<p>Reply content</p>",
			2,
			"user",
		);

		expect(result.success).toBe(true);
		expect(result.threadId).toBeUndefined();
	});

	it("returns error on failure", async () => {
		resetStore();
		const repos = createRepositories();

		// Reply to a non-existent thread should still succeed in mock phase
		// (mock repos don't enforce FK constraints)
		// Let's test with a throwing mock instead
		const throwingRepos = {
			...repos,
			threads: {
				...repos.threads,
				create: async () => {
					throw new Error("DB error");
				},
			},
		};

		const result = await submitPost(throwingRepos, "thread", 10, "Sub", "Content", 1, "admin");

		expect(result.success).toBe(false);
		expect(result.error).toBe("DB error");
	});
});
