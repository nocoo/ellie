import {
	EDITOR_TOOL_ACTIONS,
	EXTRA_OPTIONS,
	GROUP_OPTIONS,
	POST_TYPE_TABS,
	SUBJECT_MAX_LENGTH,
	buildNewThreadBreadcrumbs,
} from "@/viewmodels/forum/new-thread";
import { describe, expect, it } from "vitest";

describe("POST_TYPE_TABS", () => {
	it("has 5 tabs", () => {
		expect(POST_TYPE_TABS.length).toBe(5);
	});

	it("first tab is thread", () => {
		expect(POST_TYPE_TABS[0].value).toBe("thread");
		expect(POST_TYPE_TABS[0].label).toBe("发表主题");
	});
});

describe("EXTRA_OPTIONS", () => {
	it("has 6 options", () => {
		expect(EXTRA_OPTIONS.length).toBe(6);
	});
});

describe("GROUP_OPTIONS", () => {
	it("has default option", () => {
		expect(GROUP_OPTIONS[0].value).toBe("");
	});
});

describe("EDITOR_TOOL_ACTIONS", () => {
	it("has 7 actions", () => {
		expect(EDITOR_TOOL_ACTIONS.length).toBe(7);
	});

	it("first is non-action (status text)", () => {
		expect(EDITOR_TOOL_ACTIONS[0].isAction).toBe(false);
	});

	it("second is action", () => {
		expect(EDITOR_TOOL_ACTIONS[1].isAction).toBe(true);
	});
});

describe("SUBJECT_MAX_LENGTH", () => {
	it("is 80", () => {
		expect(SUBJECT_MAX_LENGTH).toBe(80);
	});
});

describe("buildNewThreadBreadcrumbs", () => {
	it("returns home + ancestors + 发表主题", () => {
		const ancestors = [
			{
				id: 1,
				parentId: 0,
				name: "Root",
				status: 1,
				threads: 0,
				posts: 0,
				displayOrder: 1,
				moderators: "",
				description: "",
				redirect: "",
				icon: "",
				rules: "",
				lastThreadId: 0,
				lastPostAt: 0,
				lastPostBy: "",
				todayPosts: 0,
			},
			{
				id: 2,
				parentId: 1,
				name: "Sub",
				status: 1,
				threads: 0,
				posts: 0,
				displayOrder: 1,
				moderators: "",
				description: "",
				redirect: "",
				icon: "",
				rules: "",
				lastThreadId: 0,
				lastPostAt: 0,
				lastPostBy: "",
				todayPosts: 0,
			},
		];
		const bc = buildNewThreadBreadcrumbs(ancestors);
		expect(bc[0]).toEqual({ label: "首页", href: "/" });
		expect(bc[1]).toEqual({ label: "Root", href: "/forums/1" });
		expect(bc[2]).toEqual({ label: "Sub", href: "/forums/2" });
		expect(bc[3]).toEqual({ label: "发表主题" });
	});

	it("returns home + 发表主题 for empty ancestors", () => {
		const bc = buildNewThreadBreadcrumbs([]);
		expect(bc).toEqual([{ label: "首页", href: "/" }, { label: "发表主题" }]);
	});
});
