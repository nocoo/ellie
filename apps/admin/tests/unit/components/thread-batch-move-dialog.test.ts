import { describe, expect, it } from "vitest";

import {
	buildForumSelectOptions,
	filterMoveTargetForums,
} from "@/components/admin/thread-batch-move-dialog";
import type { Forum } from "@/viewmodels/admin/forums";

// ---------------------------------------------------------------------------
// thread-batch-move-dialog — pure helpers (Batch H1 of task #15)
//
// Move-target filter and option-builder semantics. Threads cannot live in
// `type === "group"` rows (those are the 分区 separators) and we never want
// to move threads INTO a hidden forum (`status === 0`), so both must be
// excluded before the operator ever sees an option.
// ---------------------------------------------------------------------------

function makeForum(overrides: Partial<Forum> = {}): Forum {
	return {
		id: 1,
		parentId: 0,
		name: "默认版块",
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
		...overrides,
	};
}

describe("filterMoveTargetForums", () => {
	it("excludes group-type rows (groups cannot hold threads)", () => {
		const forums = [
			makeForum({ id: 1, type: "group", name: "分区 A" }),
			makeForum({ id: 2, type: "forum", name: "版块 B" }),
		];
		const result = filterMoveTargetForums(forums);
		expect(result.map((f) => f.id)).toEqual([2]);
	});

	it("excludes hidden forums (status === 0)", () => {
		const forums = [
			makeForum({ id: 1, status: 0, name: "已隐藏" }),
			makeForum({ id: 2, status: 1, name: "正常" }),
		];
		const result = filterMoveTargetForums(forums);
		expect(result.map((f) => f.id)).toEqual([2]);
	});

	it("keeps both forum and sub types", () => {
		const forums = [makeForum({ id: 1, type: "forum" }), makeForum({ id: 2, type: "sub" })];
		expect(filterMoveTargetForums(forums)).toHaveLength(2);
	});

	it("sorts by parentId then displayOrder so siblings group together", () => {
		const forums = [
			makeForum({ id: 10, parentId: 2, displayOrder: 1, name: "child-2-a" }),
			makeForum({ id: 11, parentId: 1, displayOrder: 2, name: "child-1-b" }),
			makeForum({ id: 12, parentId: 1, displayOrder: 1, name: "child-1-a" }),
			makeForum({ id: 13, parentId: 2, displayOrder: 0, name: "child-2-z" }),
		];
		const result = filterMoveTargetForums(forums);
		expect(result.map((f) => f.id)).toEqual([12, 11, 13, 10]);
	});

	it("does not mutate the input array", () => {
		const forums = [makeForum({ id: 2, displayOrder: 2 }), makeForum({ id: 1, displayOrder: 1 })];
		const originalOrder = forums.map((f) => f.id);
		filterMoveTargetForums(forums);
		expect(forums.map((f) => f.id)).toEqual(originalOrder);
	});

	it("returns an empty array when nothing is movable", () => {
		const forums = [makeForum({ id: 1, type: "group" }), makeForum({ id: 2, status: 0 })];
		expect(filterMoveTargetForums(forums)).toEqual([]);
	});
});

describe("buildForumSelectOptions", () => {
	it("prepends a placeholder option whose value is empty", () => {
		const opts = buildForumSelectOptions([]);
		expect(opts[0]).toEqual({ value: "", label: "请选择目标版块…" });
	});

	it("renders forum rows with their id stringified", () => {
		const opts = buildForumSelectOptions([makeForum({ id: 42, name: "讨论区" })]);
		expect(opts).toHaveLength(2);
		expect(opts[1]).toEqual({ value: "42", label: "讨论区" });
	});

	it("indents sub forums with a tree prefix to hint hierarchy", () => {
		const opts = buildForumSelectOptions([
			makeForum({ id: 1, name: "父版块", type: "forum" }),
			makeForum({ id: 2, name: "子版块", type: "sub" }),
		]);
		expect(opts[1].label).toBe("父版块");
		expect(opts[2].label).toBe("  └ 子版块");
	});

	it("only the placeholder option exists when forum list is empty", () => {
		expect(buildForumSelectOptions([])).toEqual([{ value: "", label: "请选择目标版块…" }]);
	});
});
