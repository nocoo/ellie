import { describe, expect, it } from "vitest";
import {
	buildForumBreadcrumb,
	buildForumTree,
	type Forum,
	flattenForumTree,
	statusLabel,
	typeLabel,
} from "@/viewmodels/admin/forums";

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

	// Phase H.3 — admin thread detail page renders a forum breadcrumb by
	// walking the `parentId` chain. The viewmodel owns that chain build so
	// the page stays declarative and the fallback behaviour is testable
	// without rendering React.
	describe("buildForumBreadcrumb", () => {
		const mk = (id: number, parentId: number, name: string) => ({ id, parentId, name });

		it("returns the full chain root-first when every parent resolves", () => {
			const forums = [mk(1, 0, "技术区"), mk(2, 1, "前端"), mk(3, 2, "React")];
			expect(buildForumBreadcrumb(forums, 3)).toEqual([
				{ id: 1, name: "技术区" },
				{ id: 2, name: "前端" },
				{ id: 3, name: "React" },
			]);
		});

		it("returns a single-item chain for a root forum", () => {
			const forums = [mk(1, 0, "公告")];
			expect(buildForumBreadcrumb(forums, 1)).toEqual([{ id: 1, name: "公告" }]);
		});

		it('falls back to [{id, name: "#<id>"}] when the forumId is missing', () => {
			expect(buildForumBreadcrumb([], 7)).toEqual([{ id: 7, name: "#7" }]);
			const forums = [mk(1, 0, "技术区")];
			expect(buildForumBreadcrumb(forums, 99)).toEqual([{ id: 99, name: "#99" }]);
		});

		it("returns the resolved prefix when the parent chain breaks mid-walk", () => {
			// forum 3's parent (id=2) is missing — chain stops at the orphan.
			const forums = [mk(1, 0, "技术区"), mk(3, 2, "React")];
			expect(buildForumBreadcrumb(forums, 3)).toEqual([{ id: 3, name: "React" }]);
		});

		it("is cycle-safe — does not hang when parentId loops back", () => {
			// 1 → 2 → 1 (malformed data). Loop is bounded by forums.length and
			// guarded by `seen`, so the chain terminates rather than spinning.
			const forums = [
				{ id: 1, parentId: 2, name: "A" },
				{ id: 2, parentId: 1, name: "B" },
			];
			const chain = buildForumBreadcrumb(forums, 1);
			// We don't pin the exact length — only that the call returns and
			// includes the starting node.
			expect(chain[chain.length - 1]).toEqual({ id: 1, name: "A" });
			expect(chain.length).toBeLessThanOrEqual(forums.length + 1);
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
