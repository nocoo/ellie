import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import {
	canSubmit,
	submitPost,
	validateContent,
	validateSubject,
} from "@/viewmodels/forum/post-editor";
import type { PostEditorState } from "@/viewmodels/forum/post-editor";

describe("post-editor ViewModel", () => {
	describe("canSubmit", () => {
		test("thread mode: requires both subject and content", () => {
			const state: PostEditorState = {
				mode: "thread",
				subject: "Title",
				content: "Body",
				forumId: 1,
			};
			expect(canSubmit(state)).toBe(true);
		});

		test("thread mode: empty subject returns false", () => {
			const state: PostEditorState = {
				mode: "thread",
				subject: "",
				content: "Body",
				forumId: 1,
			};
			expect(canSubmit(state)).toBe(false);
		});

		test("thread mode: empty content returns false", () => {
			const state: PostEditorState = {
				mode: "thread",
				subject: "Title",
				content: "",
				forumId: 1,
			};
			expect(canSubmit(state)).toBe(false);
		});

		test("thread mode: whitespace-only returns false", () => {
			const state: PostEditorState = {
				mode: "thread",
				subject: "   ",
				content: "Body",
				forumId: 1,
			};
			expect(canSubmit(state)).toBe(false);
		});

		test("reply mode: requires only content", () => {
			const state: PostEditorState = {
				mode: "reply",
				subject: "",
				content: "Reply text",
				forumId: 1,
				threadId: 1,
			};
			expect(canSubmit(state)).toBe(true);
		});

		test("reply mode: empty content returns false", () => {
			const state: PostEditorState = {
				mode: "reply",
				subject: "",
				content: "",
				forumId: 1,
				threadId: 1,
			};
			expect(canSubmit(state)).toBe(false);
		});
	});

	describe("validateSubject", () => {
		test("returns null for valid subject", () => {
			expect(validateSubject("Hello World")).toBeNull();
		});

		test("returns error for empty subject", () => {
			expect(validateSubject("")).not.toBeNull();
		});

		test("returns error for too-long subject", () => {
			expect(validateSubject("a".repeat(81))).not.toBeNull();
		});

		test("accepts 80-char subject", () => {
			expect(validateSubject("a".repeat(80))).toBeNull();
		});
	});

	describe("validateContent", () => {
		test("returns null for valid content", () => {
			expect(validateContent("Hello")).toBeNull();
		});

		test("returns error for empty content", () => {
			expect(validateContent("")).not.toBeNull();
		});

		test("returns error for too-long content", () => {
			expect(validateContent("a".repeat(50001))).not.toBeNull();
		});

		test("accepts 50000-char content", () => {
			expect(validateContent("a".repeat(50000))).toBeNull();
		});
	});

	describe("submitPost", () => {
		test("creates thread in thread mode", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum");

			const state: PostEditorState = {
				mode: "thread",
				subject: "Test Thread",
				content: "<p>Content</p>",
				forumId: forum.id,
			};

			const result = await submitPost(repos, state, 1, "tester");
			expect(result.success).toBe(true);
			expect(result.threadId).toBeDefined();
		});

		test("creates reply in reply mode", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum");

			// Create thread first
			const thread = await repos.threads.create({
				forumId: forum.id,
				authorId: 1,
				authorName: "tester",
				subject: "Thread for Reply",
				content: "<p>Main post</p>",
			});

			const state: PostEditorState = {
				mode: "reply",
				subject: "",
				content: "<p>Reply content</p>",
				forumId: forum.id,
				threadId: thread.id,
			};

			const result = await submitPost(repos, state, 1, "tester");
			expect(result.success).toBe(true);
		});

		test("fails for invalid state", async () => {
			const repos = createRepositories();
			const state: PostEditorState = {
				mode: "thread",
				subject: "",
				content: "",
				forumId: 1,
			};

			const result = await submitPost(repos, state, 1, "tester");
			expect(result.success).toBe(false);
		});

		test("fails for reply without threadId", async () => {
			const repos = createRepositories();
			const state: PostEditorState = {
				mode: "reply",
				subject: "",
				content: "Reply",
				forumId: 1,
			};

			const result = await submitPost(repos, state, 1, "tester");
			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});
});
