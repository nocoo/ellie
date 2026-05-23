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
	ThreadRowStats: (props: { variant: "desktop" | "mobile" }) =>
		createElement("div", { "data-testid": `thread-row-stats-${props.variant}` }),
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
			isRecommended: false,
			...overrides,
		},
		badges: [],
		highlight: null,
		iconSrc: "/static/folder_common.gif",
		digestSrc: null,
		newbieStampSrc: null,
		isGlobalAnnouncement: false,
		...overrides,
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

// ─── Global announcement (sticky=2) icon ──────────────────────────────────────
// Phase 2 of 全站公告: when isGlobalAnnouncement is true, the left-column
// row icon must be a red lucide Megaphone with aria-label="全站公告" instead
// of the classic Discuz folder/pin gif. Forum-pinned (sticky=1) and
// category-pinned (sticky=3) rows must keep their pin gif via iconSrc and
// MUST NOT render the megaphone — see reviewer constraint
// #ellie-数据同步MBP:5fc0db50 ("红色 icon 只替代/增强 sticky=2").
describe("ThreadItem — global announcement icon", () => {
	it("renders red Megaphone with aria-label=全站公告 when isGlobalAnnouncement=true", () => {
		const item = makeDisplayItem({ isGlobalAnnouncement: true });
		render(createElement(ThreadItem, { item, postsPerPage: 15 }));

		// Desktop + mobile layouts both render the row → expect 2 megaphones.
		const icons = screen.getAllByLabelText("全站公告");
		expect(icons.length).toBe(2);
		for (const icon of icons) {
			// lucide-react renders as <svg>; the text-destructive class is what
			// paints it red. The class lookup is brittle on purpose: if the
			// class name changes we want this test to flag it.
			expect(icon.tagName.toLowerCase()).toBe("svg");
			expect(icon.getAttribute("class") ?? "").toContain("text-destructive");
		}
	});

	it("renders classic <img> icon (no megaphone) when isGlobalAnnouncement=false", () => {
		const item = makeDisplayItem({ isGlobalAnnouncement: false });
		render(createElement(ThreadItem, { item, postsPerPage: 15 }));

		expect(screen.queryByLabelText("全站公告")).toBeNull();
		// The classic folder/pin gif is rendered via <img alt=""> — assert at
		// least one such image is present.
		const imgs = document.querySelectorAll("img[src='/static/folder_common.gif']");
		expect(imgs.length).toBeGreaterThan(0);
	});

	it("forum-pin (sticky=1) and category-pin (sticky=3) keep their pin gif via iconSrc", () => {
		// The VM is responsible for producing iconSrc=pin_N.gif and
		// isGlobalAnnouncement=false for sticky=1/3. Simulate that here so
		// ThreadItem cannot accidentally swap the gif for a megaphone.
		const item = makeDisplayItem({
			isGlobalAnnouncement: false,
			iconSrc: "/static/pin_3.gif",
		});
		render(createElement(ThreadItem, { item, postsPerPage: 15 }));

		expect(screen.queryByLabelText("全站公告")).toBeNull();
		const imgs = document.querySelectorAll("img[src='/static/pin_3.gif']");
		expect(imgs.length).toBeGreaterThan(0);
	});

	it("preserves desktop 36px icon column wrapper for global announcements", () => {
		// Reviewer constraint: column width must not jump when the megaphone
		// replaces the gif. Assert the wrapper class still includes w-[36px].
		const item = makeDisplayItem({ isGlobalAnnouncement: true });
		render(createElement(ThreadItem, { item, postsPerPage: 15 }));

		const icon = screen.getAllByLabelText("全站公告")[0];
		// Walk up to the wrapper div with the fixed width.
		let el: HTMLElement | null = icon;
		let found = false;
		while (el && el.tagName.toLowerCase() !== "body") {
			if ((el.getAttribute("class") ?? "").includes("w-[36px]")) {
				found = true;
				break;
			}
			el = el.parentElement;
		}
		expect(found).toBe(true);
	});
});

// ─── Mobile avatar position (reviewer freeze msg=5a91dfd3) ──────────────────
// iPhone polish wave 2: avatar moves out of Row 1 (icon + title) and into
// Row 2 alongside the username. Row 1 must no longer carry an avatar; Row 2
// must contain a stable `thread-item-mobile-avatar-link` testid pointing at
// /users/<authorId>.
describe("ThreadItem — iPhone avatar moved to Row 2", () => {
	it("mobile Row 2 contains an avatar link to /users/<authorId>", () => {
		const item = makeDisplayItem();
		render(createElement(ThreadItem, { item, postsPerPage: 15 }));
		const link = screen.getByTestId("thread-item-mobile-avatar-link") as HTMLAnchorElement;
		expect(link).toBeDefined();
		expect(link.getAttribute("href")).toBe("/users/1");
	});

	it("mobile branch root carries `sm:hidden` (toggles off on desktop)", () => {
		const item = makeDisplayItem();
		const { container } = render(createElement(ThreadItem, { item, postsPerPage: 15 }));
		// Locate the mobile branch root by walking the `thread-item` wrapper.
		const root = container.querySelector('[data-testid="thread-item"]');
		expect(root).not.toBeNull();
		// First level children: desktop (hidden sm:flex) + mobile (sm:hidden)
		const mobileBranch = root?.querySelector(".sm\\:hidden");
		expect(mobileBranch).not.toBeNull();
		// The avatar link must live inside the mobile branch.
		const link = mobileBranch?.querySelector('[data-testid="thread-item-mobile-avatar-link"]');
		expect(link).not.toBeNull();
	});
});

// ─── Mobile trim contract (reviewer freeze msg=8b90cb85) ─────────────────────
// On iPhone the thread list row drops 阅读 / 回复 / 推荐数 — those numbers are
// secondary. Desktop branch is untouched and continues to render
// ThreadRowStats inside its own column. Asserting via stable data-testid
// (not class strings) per reviewer's "不要只靠 class 字符串测试" rule.
describe("ThreadItem — iPhone mobile-trim contract", () => {
	it("only the desktop ThreadRowStats slot is rendered; mobile variant is absent", () => {
		const item = makeDisplayItem();
		render(createElement(ThreadItem, { item, postsPerPage: 15 }));
		expect(screen.getAllByTestId("thread-row-stats-desktop").length).toBe(1);
		expect(screen.queryByTestId("thread-row-stats-mobile")).toBeNull();
	});

	it("global-announcement row also has no mobile-stats slot", () => {
		const item = makeDisplayItem({ isGlobalAnnouncement: true });
		render(createElement(ThreadItem, { item, postsPerPage: 15 }));
		expect(screen.queryByTestId("thread-row-stats-mobile")).toBeNull();
	});
});
