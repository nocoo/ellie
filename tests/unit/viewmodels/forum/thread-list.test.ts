import { describe, expect, test } from "bun:test";
import { createRepositories } from "@/data/index";
import type { Thread } from "@/models/types";
import { StickyLevel } from "@/models/types";
import { enrichThread, fetchThreadList } from "@/viewmodels/forum/thread-list";

describe("thread-list ViewModel", () => {
	describe("enrichThread", () => {
		const baseThread: Thread = {
			id: 1,
			forumId: 1,
			authorId: 1,
			authorName: "test",
			subject: "Test Thread",
			createdAt: 1000000,
			lastPostAt: 1000000,
			lastPoster: "test",
			replies: 5,
			views: 100,
			closed: 0,
			sticky: StickyLevel.None,
			digest: 0,
			special: 0,
			highlight: 0,
			recommends: 0,
		};

		test("returns thread with empty badges for normal thread", () => {
			const result = enrichThread(baseThread);
			expect(result.thread).toBe(baseThread);
			expect(result.badges).toEqual([]);
			expect(result.highlightStyle).toBeNull();
		});

		test("includes sticky badge for global sticky", () => {
			const thread = { ...baseThread, sticky: StickyLevel.Global };
			const result = enrichThread(thread);
			expect(result.badges.length).toBeGreaterThan(0);
			expect(result.badges[0].type).toBe("sticky");
			expect(result.badges[0].label).toBe("全局置顶");
		});

		test("includes digest badge", () => {
			const thread = { ...baseThread, digest: 2 };
			const result = enrichThread(thread);
			const digestBadge = result.badges.find((b) => b.type === "digest");
			expect(digestBadge).toBeDefined();
			if (!digestBadge) throw new Error("Expected digest badge");
			expect(digestBadge.label).toContain("精华");
		});

		test("includes closed badge", () => {
			const thread = { ...baseThread, closed: 1 };
			const result = enrichThread(thread);
			const closedBadge = result.badges.find((b) => b.type === "closed");
			expect(closedBadge).toBeDefined();
		});

		test("decodes highlight style", () => {
			// bold (bit 24) = 0x1000000 = 16777216
			const thread = { ...baseThread, highlight: 0x01ff0000 };
			const result = enrichThread(thread);
			expect(result.highlightStyle).not.toBeNull();
			if (!result.highlightStyle) throw new Error("Expected highlight");
			expect(result.highlightStyle.bold).toBe(true);
			expect(result.highlightStyle.color).toBe("#ff0000");
		});

		test("multiple badges coexist", () => {
			const thread = { ...baseThread, sticky: StickyLevel.Forum, digest: 1, closed: 1 };
			const result = enrichThread(thread);
			expect(result.badges.length).toBe(3);
			const types = result.badges.map((b) => b.type);
			expect(types).toContain("sticky");
			expect(types).toContain("digest");
			expect(types).toContain("closed");
		});
	});

	describe("fetchThreadList", () => {
		test("returns null for non-existent forum", async () => {
			const repos = createRepositories();
			const result = await fetchThreadList(repos, 999999);
			expect(result).toBeNull();
		});

		test("returns forum data for existing forum", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum in mock data");

			const result = await fetchThreadList(repos, forum.id);
			expect(result).not.toBeNull();
			if (!result) throw new Error("Expected result");
			expect(result.forum.id).toBe(forum.id);
		});

		test("enriches thread items with badges", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum in mock data");

			const result = await fetchThreadList(repos, forum.id);
			if (!result) throw new Error("Expected result");
			for (const item of result.items) {
				expect(Array.isArray(item.badges)).toBe(true);
				expect(item.thread.id).toBeDefined();
			}
		});

		test("respects digestOnly filter", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum in mock data");

			const result = await fetchThreadList(repos, forum.id, { digestOnly: true });
			if (!result) throw new Error("Expected result");
			// All returned threads should be digest (if any)
			for (const item of result.items) {
				expect(item.thread.digest).toBeGreaterThan(0);
			}
		});

		test("default sort is latest", async () => {
			const repos = createRepositories();
			const forums = await repos.forums.listAll();
			const forum = forums.find((f) => f.type !== "group");
			if (!forum) throw new Error("No non-group forum in mock data");

			// Should not throw with default params
			const result = await fetchThreadList(repos, forum.id);
			expect(result).not.toBeNull();
		});
	});
});
