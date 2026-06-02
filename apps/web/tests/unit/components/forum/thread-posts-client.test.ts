// @vitest-environment happy-dom
// Tests for ThreadPostsClient — jumpPage prop wiring to FloatingToolbar
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/viewmodels/forum/write-gate", () => ({
	writeGatePreflight: () => Promise.resolve(false),
}));

vi.mock("@/viewmodels/shared/formatting", () => ({
	formatDateTime: () => "2026-01-01",
}));

vi.mock("@/lib/cdn", () => ({
	getStaticImageUrl: (name: string) => `/static/${name}`,
}));

vi.mock("@/lib/text", () => ({
	buildQuoteSnippet: (content: string) => content.slice(0, 50),
}));

// Track FloatingToolbar props
const floatingToolbarProps = vi.fn();
vi.mock("@/components/forum/floating-toolbar", () => ({
	FloatingToolbar: (props: any) => {
		floatingToolbarProps(props);
		return createElement("div", { "data-testid": "floating-toolbar" });
	},
}));

// Stub PostCard
vi.mock("@/components/forum/post-card", () => ({
	PostCard: () => createElement("div", { "data-testid": "post-card" }),
}));

// Stub ReplyDialog
vi.mock("@/components/forum/reply-dialog", () => ({
	ReplyDialog: () => null,
}));

// Stub ThreadModMenu
vi.mock("@/components/forum/thread-mod-menu", () => ({
	ThreadModMenu: () => null,
}));

import { ThreadPostsClient } from "@/components/forum/thread-posts-client";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeThread(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		forumId: 10,
		authorId: 100,
		authorName: "test",
		authorAvatar: "",
		authorAvatarPath: "",
		subject: "Test Thread",
		createdAt: 1700000000,
		lastPostAt: 1700000000,
		lastPoster: "test",
		lastPosterId: 100,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		replies: 50,
		views: 200,
		closed: 0,
		sticky: 0,
		digest: 0,
		special: 0,
		highlight: 0,
		recommends: 0,
		typeName: "",
		isAuthorFirstThread: false,
		isRecommended: false,
		...overrides,
	};
}

const defaultProps = {
	thread: makeThread(),
	posts: [],
	canModerateForum: false,
	canManageThread: false,
	canMoveThread: false,
	canDeleteThread: false,
	currentUserId: null,
	currentUserRole: null,
	selfEmailVerifiedAt: null,
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	window.scrollTo = vi.fn();
});

afterEach(() => {
	cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ThreadPostsClient", () => {
	it("passes jumpPage to FloatingToolbar when provided", () => {
		const jumpPage = { basePath: "/threads/1", pages: 5 };
		render(createElement(ThreadPostsClient, { ...defaultProps, jumpPage }));

		// FloatingToolbar should have been called with jumpPage
		const calls = floatingToolbarProps.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.jumpPage).toEqual({ basePath: "/threads/1", pages: 5 });
	});

	it("does not pass jumpPage to FloatingToolbar when omitted", () => {
		render(createElement(ThreadPostsClient, { ...defaultProps }));

		const calls = floatingToolbarProps.mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.jumpPage).toBeUndefined();
	});

	it("passes backHref pointing to parent forum", () => {
		const thread = makeThread({ forumId: 42 });
		render(createElement(ThreadPostsClient, { ...defaultProps, thread }));

		const calls = floatingToolbarProps.mock.calls;
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.backHref).toBe("/forums/42");
	});

	it("passes explicit backHref to FloatingToolbar when provided", () => {
		const thread = makeThread({ forumId: 42 });
		render(
			createElement(ThreadPostsClient, {
				...defaultProps,
				thread,
				backHref: "/forums/42?page=4",
			}),
		);

		const calls = floatingToolbarProps.mock.calls;
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.backHref).toBe("/forums/42?page=4");
	});

	it("falls back to /forums/{forumId} when backHref is omitted", () => {
		const thread = makeThread({ forumId: 99 });
		render(createElement(ThreadPostsClient, { ...defaultProps, thread }));

		const calls = floatingToolbarProps.mock.calls;
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.backHref).toBe("/forums/99");
	});

	it("forwards jumpPage.returnTo to FloatingToolbar", () => {
		const jumpPage = {
			basePath: "/threads/1",
			pages: 5,
			returnTo: "/forums/10?page=3",
		};
		render(createElement(ThreadPostsClient, { ...defaultProps, jumpPage }));

		const calls = floatingToolbarProps.mock.calls;
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.jumpPage).toEqual({
			basePath: "/threads/1",
			pages: 5,
			returnTo: "/forums/10?page=3",
		});
	});

	it("passes actionType=reply when thread is open", () => {
		const thread = makeThread({ closed: 0 });
		render(createElement(ThreadPostsClient, { ...defaultProps, thread }));

		const calls = floatingToolbarProps.mock.calls;
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.actionType).toBe("reply");
	});

	it("passes actionType=none when thread is closed", () => {
		const thread = makeThread({ closed: 1 });
		render(createElement(ThreadPostsClient, { ...defaultProps, thread }));

		const calls = floatingToolbarProps.mock.calls;
		const lastCall = calls[calls.length - 1][0];
		expect(lastCall.actionType).toBe("none");
	});
});

// ─── quoteAuthorLabel — three-way author rendering (P3) ───────────────────────
import { quoteAuthorLabel } from "@/components/forum/thread-posts-client";

describe("quoteAuthorLabel", () => {
	function makePost(overrides: Record<string, unknown> = {}): any {
		return {
			id: 1,
			threadId: 10,
			forumId: 1,
			authorId: 100,
			authorName: "alice",
			content: "",
			createdAt: 0,
			isFirst: false,
			position: 1,
			ratingAggregate: { total: 0, credits: { count: 0, sum: 0 }, coins: { count: 0, sum: 0 } },
			author: { id: 100, username: "alice" },
			anonymous: 0,
			attachments: [],
			...overrides,
		};
	}

	it("returns '匿名' only for anonymous=1 + authorId=0", () => {
		expect(quoteAuthorLabel(makePost({ authorId: 0, anonymous: 1, author: null }))).toBe("匿名");
	});

	it("returns '未知用户' for authorId=0 without anonymous flag (tombstoned/placeholder)", () => {
		expect(quoteAuthorLabel(makePost({ authorId: 0, anonymous: 0, author: null }))).toBe(
			"未知用户",
		);
	});

	it("returns '未知用户' when the author lookup failed for a real authorId", () => {
		// e.g. enrichPosts couldn't resolve the user (network / FK fan-out gap)
		expect(quoteAuthorLabel(makePost({ authorId: 100, author: null }))).toBe("未知用户");
	});

	it("returns the real username when the author is populated", () => {
		expect(
			quoteAuthorLabel(makePost({ authorId: 100, author: { id: 100, username: "alice" } })),
		).toBe("alice");
	});

	it("staff/self viewing an anonymous post (worker unmasked authorId>0) sees the real username", () => {
		// Worker decoded the anonymous post for staff/self → authorId>0,
		// anonymous=1 stays as a badge signal but the label must NOT be 匿名.
		expect(
			quoteAuthorLabel(
				makePost({ authorId: 340271, anonymous: 1, author: { id: 340271, username: "小牧童" } }),
			),
		).toBe("小牧童");
	});
});
