import {
	type Forum,
	buildForumTree,
	flattenForumTree,
	statusLabel,
	typeLabel,
} from "@/viewmodels/admin/forums";
import { describe, expect, it } from "vitest";

describe("forums", () => {
	describe("statusLabel", () => {
		it("returns 隐藏 for 0", () => {
			expect(statusLabel(0)).toBe("隐藏");
		});

		it("returns 正常 for 1", () => {
			expect(statusLabel(1)).toBe("正常");
		});

		it("returns 未知 for other values", () => {
			expect(statusLabel(99)).toBe("未知");
		});
	});

	describe("typeLabel", () => {
		it("returns 分区 for group", () => {
			expect(typeLabel("group")).toBe("分区");
		});

		it("returns 版块 for forum", () => {
			expect(typeLabel("forum")).toBe("版块");
		});

		it("returns 子版块 for sub", () => {
			expect(typeLabel("sub")).toBe("子版块");
		});
	});

	describe("buildForumTree", () => {
		const baseForum: Forum = {
			id: 0,
			parentId: 0,
			name: "",
			description: "",
			icon: "",
			displayOrder: 0,
			threads: 0,
			posts: 0,
			type: "forum",
			status: 1,
			moderators: "",
			lastThreadId: 0,
			lastPostAt: 0,
			lastPoster: "",
			lastThreadSubject: "",
		};

		it("places root nodes (parentId=0) at top level", () => {
			const forums = [
				{ ...baseForum, id: 1, parentId: 0, name: "Root1", displayOrder: 1 },
				{ ...baseForum, id: 2, parentId: 0, name: "Root2", displayOrder: 2 },
			];
			const tree = buildForumTree(forums);
			expect(tree).toHaveLength(2);
			expect(tree[0].name).toBe("Root1");
			expect(tree[1].name).toBe("Root2");
		});

		it("nests children under parents", () => {
			const forums = [
				{ ...baseForum, id: 1, parentId: 0, displayOrder: 1 },
				{ ...baseForum, id: 2, parentId: 1, displayOrder: 1 },
				{ ...baseForum, id: 3, parentId: 1, displayOrder: 2 },
			];
			const tree = buildForumTree(forums);
			expect(tree).toHaveLength(1);
			expect(tree[0].children).toHaveLength(2);
			expect(tree[0].children[0].id).toBe(2);
			expect(tree[0].children[1].id).toBe(3);
		});

		it("sets correct depth", () => {
			const forums = [
				{ ...baseForum, id: 1, parentId: 0, displayOrder: 1 },
				{ ...baseForum, id: 2, parentId: 1, displayOrder: 1 },
				{ ...baseForum, id: 3, parentId: 2, displayOrder: 1 },
			];
			const tree = buildForumTree(forums);
			expect(tree[0].depth).toBe(0);
			expect(tree[0].children[0].depth).toBe(1);
			expect(tree[0].children[0].children[0].depth).toBe(2);
		});

		it("treats orphans as roots", () => {
			const forums = [{ ...baseForum, id: 1, parentId: 999, displayOrder: 1 }];
			const tree = buildForumTree(forums);
			expect(tree).toHaveLength(1);
			expect(tree[0].depth).toBe(0);
		});

		it("sorts children by displayOrder", () => {
			const forums = [
				{ ...baseForum, id: 1, parentId: 0, displayOrder: 1 },
				{ ...baseForum, id: 2, parentId: 1, displayOrder: 3 },
				{ ...baseForum, id: 3, parentId: 1, displayOrder: 1 },
			];
			const tree = buildForumTree(forums);
			expect(tree[0].children[0].id).toBe(3);
			expect(tree[0].children[1].id).toBe(2);
		});
	});

	describe("flattenForumTree", () => {
		it("traverses tree depth-first", () => {
			const baseForum: Forum = {
				id: 0,
				parentId: 0,
				name: "",
				description: "",
				icon: "",
				displayOrder: 0,
				threads: 0,
				posts: 0,
				type: "forum",
				status: 1,
				moderators: "",
				lastThreadId: 0,
				lastPostAt: 0,
				lastPoster: "",
				lastThreadSubject: "",
			};
			const forums = [
				{ ...baseForum, id: 1, parentId: 0, displayOrder: 1 },
				{ ...baseForum, id: 2, parentId: 1, displayOrder: 1 },
				{ ...baseForum, id: 3, parentId: 0, displayOrder: 2 },
			];
			const tree = buildForumTree(forums);
			const flat = flattenForumTree(tree);
			expect(flat.map((n) => n.id)).toEqual([1, 2, 3]);
		});
	});
});
