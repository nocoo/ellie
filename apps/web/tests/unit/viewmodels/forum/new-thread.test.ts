import { describe, expect, it } from "vitest";
import {
	EDITOR_TOOL_ACTIONS,
	EXTRA_OPTIONS,
	GROUP_OPTIONS,
	POST_TYPE_TABS,
	SUBJECT_MAX_LENGTH,
} from "@/viewmodels/forum/new-thread";

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
