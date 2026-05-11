// @vitest-environment happy-dom
// Tests for ThreadItem — returnTo propagation to title link and ThreadInlinePages
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

vi.mock("@/viewmodels/forum/thread-list", () => ({
	highlightStyle: () => undefined,
}));

vi.mock("@/viewmodels/shared/formatting", () => ({
	formatRelativeTime: () => "1 day ago",
}));

// Track ThreadInlinePages props
const inlinePagesProps = vi.fn();
vi.mock("@/components/forum/thread-inline-pages", () => ({
	ThreadInlinePages: (props: any) => {
		inlinePagesProps(props);
		return createElement("span", { "data-testid": "inline-pages" });
	},
}));

vi.mock("@/components/forum/thread-badge", () => ({
	ThreadBadgeList: () => null,
}));

vi.mock("@/components/forum/thread-last-post-cell", () => ({
	ThreadLastPostCell: () => createElement("div"),
}));

vi.mock("@/components/forum/thread-row-stats", () => ({
	ThreadRowStats: () => createElement("div"),
}));

vi.mock("@/components/forum/user-avatar", () => ({
	ForumAvatar: () => createElement("div"),
}));

vi.mock("@/components/forum/user-popover", () => ({
	UserPopover: ({ children }: any) => createElement("div", null, children),
}));

import { ThreadItem } from "@/components/forum/thread-item";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDisplayItem(overrides: Record<string, unknown> = {}) {
	return {
		thread: {
			id: 42,
			forumId: 5,
			authorId: 1,
			authorName: "alice",
			authorAvatar: "",
			authorAvatarPath: "",
			subject: "Test Thread",
			createdAt: 1700000000,
			lastPostAt: 1700000000,
			lastPoster: "bob",
			lastPosterId: 2,
			lastPosterAvatar: "",
			lastPosterAvatarPath: "",
			replies: 30,
			views: 100,
			closed: 0,
			sticky: 0,
			digest: 0,
			special: 0,
			highlight: 0,
			recommends: 0,
			typeName: "",
			isAuthorFirstThread: false,
			...overrides,
		},
		badges: [],
		highlight: null,
		iconSrc: "/static/folder_common.gif",
		digestSrc: null,
		newbieStampSrc: null,
	};
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ThreadItem — returnTo propagation", () => {
	it("title link includes encoded returnTo when returnTo is provided", () => {
		const item = makeDisplayItem();
		render(
			createElement(ThreadItem, {
				item,
				postsPerPage: 15,
				returnTo: "/forums/5?page=4",
			}),
		);

		// Desktop layout title link — thread subject text
		const links = screen.getAllByText("Test Thread");
		expect(links.length).toBeGreaterThan(0);
		const link = links[0].closest("a");
		expect(link).not.toBeNull();
		expect(link?.getAttribute("href")).toBe(
			`/threads/42?returnTo=${encodeURIComponent("/forums/5?page=4")}`,
		);
	});

	it("title link has no returnTo when returnTo is omitted", () => {
		const item = makeDisplayItem();
		render(createElement(ThreadItem, { item, postsPerPage: 15 }));

		const links = screen.getAllByText("Test Thread");
		const link = links[0].closest("a");
		expect(link).not.toBeNull();
		expect(link?.getAttribute("href")).toBe("/threads/42");
	});

	it("passes returnTo to ThreadInlinePages", () => {
		const item = makeDisplayItem();
		render(
			createElement(ThreadItem, {
				item,
				postsPerPage: 15,
				returnTo: "/forums/5?page=4",
			}),
		);

		// ThreadInlinePages should have been called with returnTo
		const calls = inlinePagesProps.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		// At least one call should have returnTo
		const hasReturnTo = calls.some((call: any[]) => call[0].returnTo === "/forums/5?page=4");
		expect(hasReturnTo).toBe(true);
	});

	it("does not pass returnTo to ThreadInlinePages when omitted", () => {
		const item = makeDisplayItem();
		render(createElement(ThreadItem, { item, postsPerPage: 15 }));

		const calls = inlinePagesProps.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const allUndefined = calls.every((call: any[]) => call[0].returnTo === undefined);
		expect(allUndefined).toBe(true);
	});
});
