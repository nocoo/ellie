// @vitest-environment happy-dom
// Tests for ForumHeader TopBar — profile card layout, coins display, single trigger
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn() }),
	usePathname: () => "/",
}));

vi.mock("next-auth/react", () => ({
	signOut: vi.fn(),
}));

// Track UserPopover trigger count and props
let userPopoverCount = 0;
const userPopoverCalls: any[] = [];
vi.mock("@/components/forum/user-popover", () => ({
	UserPopover: (props: any) => {
		userPopoverCount++;
		userPopoverCalls.push(props);
		return createElement(
			"div",
			{ "data-testid": "user-popover-trigger", "data-trigger-class": props.triggerClassName },
			props.children,
		);
	},
}));

// Stub TrackedUserAvatar — render a marker element for DOM order assertion
vi.mock("@/components/forum/user-avatar", () => ({
	TrackedUserAvatar: ({ uid, username }: any) =>
		createElement("div", { "data-testid": "avatar", "data-uid": uid }, username),
}));

vi.mock("@/components/forum/forum-logo", () => ({
	ForumLogo: () => createElement("div", { "data-testid": "logo" }),
}));

vi.mock("@/components/forum/message-badge-icon", () => ({
	MessageBadgeIcon: () =>
		createElement("div", { "data-testid": "forum-top-bar-message-icon" }, "msg"),
}));

vi.mock("@/components/theme-toggle", () => ({
	ThemeToggle: () => null,
}));

vi.mock("@/components/width-toggle", () => ({
	WidthToggle: () => null,
}));

import { ForumHeader } from "@/components/forum/forum-header";
import type { HeaderViewModel } from "@/viewmodels/forum/header";
import { DEFAULT_STATS, HOT_KEYWORDS } from "@/viewmodels/forum/header";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeVm(userOverrides: Record<string, unknown> = {}): HeaderViewModel {
	return {
		user: {
			username: "testuser",
			uid: 42,
			groupTitle: "会员",
			credits: 500,
			coins: 120,
			reminderCount: 0,
			role: 0,
			...userOverrides,
		},
		navTabs: [{ label: "首页", href: "/" }],
		hotKeywords: HOT_KEYWORDS,
		stats: DEFAULT_STATS,
	};
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	userPopoverCount = 0;
	userPopoverCalls.length = 0;
});

afterEach(() => {
	cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ForumHeader — TopBar profile card", () => {
	it("renders coins (同钱) in the header", () => {
		render(createElement(ForumHeader, { vm: makeVm({ coins: 250 }) }));
		expect(screen.getByText("同钱 250")).toBeDefined();
	});

	it("renders credits (积分) in the header", () => {
		render(createElement(ForumHeader, { vm: makeVm({ credits: 999 }) }));
		expect(screen.getByText("积分 999")).toBeDefined();
	});

	it("renders avatar before username in DOM order", () => {
		const { container } = render(createElement(ForumHeader, { vm: makeVm() }));
		const trigger = container.querySelector("[data-testid='user-popover-trigger']");
		expect(trigger).toBeDefined();
		if (!trigger) return;

		// Inside the trigger, avatar should come before the username text
		const avatarEl = trigger.querySelector("[data-testid='avatar']");
		const usernameEl = Array.from(trigger.querySelectorAll("span")).find(
			(el) => el.textContent === "testuser",
		);
		expect(avatarEl).toBeDefined();
		expect(usernameEl).toBeDefined();
		if (!avatarEl || !usernameEl) return;

		// Avatar should precede username in document order
		const order = avatarEl.compareDocumentPosition(usernameEl);
		// DOCUMENT_POSITION_FOLLOWING = 4 means avatar comes before username
		expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("has exactly one UserPopover trigger for the profile card", () => {
		render(createElement(ForumHeader, { vm: makeVm() }));
		expect(userPopoverCount).toBe(1);
	});

	it("does not render profile card when user is null (logged out)", () => {
		const vm: HeaderViewModel = {
			user: null,
			navTabs: [{ label: "首页", href: "/" }],
			hotKeywords: HOT_KEYWORDS,
			stats: DEFAULT_STATS,
		};
		render(createElement(ForumHeader, { vm }));
		expect(screen.queryByTestId("user-popover-trigger")).toBeNull();
		expect(screen.queryByTestId("avatar")).toBeNull();
		// Should show login link instead
		expect(screen.getByText("登录")).toBeDefined();
	});

	it("renders username and UID", () => {
		render(createElement(ForumHeader, { vm: makeVm({ username: "alice", uid: 99 }) }));
		// Username appears in both avatar stub and text span — use getAllByText
		expect(screen.getAllByText("alice").length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText("UID: 99")).toBeDefined();
	});

	it("renders groupTitle", () => {
		render(createElement(ForumHeader, { vm: makeVm({ groupTitle: "管理员" }) }));
		expect(screen.getByText("管理员")).toBeDefined();
	});

	it("passes triggerClassName to UserPopover with profile card styles", () => {
		render(createElement(ForumHeader, { vm: makeVm() }));
		expect(userPopoverCalls.length).toBe(1);
		const triggerClass = userPopoverCalls[0].triggerClassName;
		expect(typeof triggerClass).toBe("string");
		// Trigger should carry the card's layout/focus/hover classes
		expect(triggerClass).toContain("inline-flex");
		expect(triggerClass).toContain("focus-visible:");
		expect(triggerClass).toContain("hover:bg-accent");
	});

	it("uses span elements (not div) for profile content inside trigger", () => {
		const { container } = render(createElement(ForumHeader, { vm: makeVm() }));
		const trigger = container.querySelector("[data-testid='user-popover-trigger']");
		if (!trigger) return;
		// Profile text content should use span elements (valid inside button)
		const profileSpans = trigger.querySelectorAll("span");
		expect(profileSpans.length).toBeGreaterThan(0);
	});
});

// ─── Mobile trim contract (reviewer freeze msg=8b90cb85) ─────────────────────
// iPhone-targeted polish: TopBar collapses h-[90px] → h-14, hides
// username/UID/credits meta inline (popover still has it), drops the
// WidthToggle/ThemeToggle, NavBar becomes horizontal-scroll, and
// SearchStatsBar disappears entirely. Pinned via stable testid + class
// presence rather than viewport simulation — happy-dom does not run media
// queries, so we assert the `hidden sm:*` tokens are applied to the right
// nodes. Visual coverage at 320/375/390/430 lives in the Playwright mobile
// spec; this gate is the fast-feedback drift guard.
describe("ForumHeader — iPhone mobile-trim contract", () => {
	it("TopBar wrapper carries `h-14 sm:h-[90px]` (collapsed on mobile, unchanged on desktop)", () => {
		render(createElement(ForumHeader, { vm: makeVm() }));
		const bar = screen.getByTestId("forum-top-bar");
		expect(bar.className).toContain("h-14");
		expect(bar.className).toContain("sm:h-[90px]");
	});

	it("logged-in user meta block is `hidden sm:block` (popover trigger still works on mobile via avatar)", () => {
		render(createElement(ForumHeader, { vm: makeVm() }));
		const meta = screen.getByTestId("forum-top-bar-user-meta");
		expect(meta.className).toContain("hidden");
		expect(meta.className).toContain("sm:block");
		// The avatar marker remains visible on mobile (still inside the trigger).
		expect(screen.getByTestId("avatar")).toBeDefined();
	});

	it("desktop-only toggles (WidthToggle/ThemeToggle) wrapper is `hidden sm:inline-flex`", () => {
		render(createElement(ForumHeader, { vm: makeVm() }));
		const toggles = screen.getByTestId("forum-top-bar-desktop-toggles");
		expect(toggles.className).toContain("hidden");
		expect(toggles.className).toContain("sm:inline-flex");
	});

	it("NavBar inner scroller uses `overflow-x-auto` and links carry `whitespace-nowrap shrink-0`", () => {
		render(createElement(ForumHeader, { vm: makeVm() }));
		const nav = screen.getByTestId("forum-nav-bar");
		expect(nav.className).toContain("overflow-x-auto");
		expect(nav.className).toContain("touch-pan-x");
		// At least one nav link is `whitespace-nowrap shrink-0` so a long
		// label can never wrap onto a second line.
		const links = screen.getAllByTestId("forum-nav-link");
		expect(links.length).toBeGreaterThan(0);
		for (const link of links) {
			expect(link.className).toContain("whitespace-nowrap");
			expect(link.className).toContain("shrink-0");
		}
	});

	it("NavBar outer wrapper clips horizontal overflow (no body-level scrollbar)", () => {
		render(createElement(ForumHeader, { vm: makeVm() }));
		const nav = screen.getByTestId("forum-nav-bar");
		// Parent of the inner scroller is the gradient wrapper that must clip.
		const outer = nav.parentElement;
		expect(outer?.className).toContain("overflow-x-hidden");
	});

	it("SearchStatsBar wrapper is `hidden sm:block` (whole bar disappears on mobile)", () => {
		render(createElement(ForumHeader, { vm: makeVm() }));
		const bar = screen.getByTestId("forum-search-stats-bar");
		expect(bar.className).toContain("hidden");
		expect(bar.className).toContain("sm:block");
	});

	it("guest TopBar still renders 登录 / 注册 (links remain on mobile, only toggles disappear)", () => {
		const vm: HeaderViewModel = {
			user: null,
			navTabs: [{ label: "首页", href: "/" }],
			hotKeywords: HOT_KEYWORDS,
			stats: DEFAULT_STATS,
		};
		render(createElement(ForumHeader, { vm }));
		expect(screen.getByText("登录")).toBeDefined();
		expect(screen.getByText("注册")).toBeDefined();
	});

	// Reviewer follow-up (msg=ad33321c): logged-in header mobile coverage was
	// thin — avatar / message icon / logout / username meta hidden / desktop
	// toggles hidden must all hold simultaneously in the logged-in branch.
	// happy-dom doesn't run media queries, so we still pin via class tokens
	// for the hidden-on-mobile pieces; the visible-on-mobile pieces are
	// asserted as present-in-DOM (and not wrapped in `hidden sm:*`).
	it("logged-in mobile contract: avatar + message icon + logout button render; meta + toggles are mobile-hidden", () => {
		render(createElement(ForumHeader, { vm: makeVm({ username: "alice", uid: 99 }) }));

		// 1. Avatar (inside the popover trigger, hence still mobile-visible).
		const avatar = screen.getByTestId("avatar");
		expect(avatar).toBeDefined();

		// 2. Message badge icon — always mounted in the action-icon cluster
		//    on mobile (no `hidden sm:*` wrapper). The stub returns a marker
		//    div, so its presence proves the JSX path stays mounted.
		const msgIcon = screen.getByTestId("forum-top-bar-message-icon");
		expect(msgIcon).toBeDefined();
		// Walk up the DOM to make sure no ancestor inside the TopBar carries
		// `hidden sm:*` — this would silently mobile-hide the icon.
		let p: HTMLElement | null = msgIcon;
		while (p && p.getAttribute("data-testid") !== "forum-top-bar") {
			expect(p.className ?? "").not.toMatch(/(^|\s)hidden(\s|$)/);
			p = p.parentElement;
		}

		// 3. Logout button — Chinese title "退出登录" pins the right node.
		const logout = screen.getByTitle("退出登录");
		expect(logout.tagName).toBe("BUTTON");

		// 4. Username meta block is `hidden sm:block` (popover content still
		//    exposes identity once the avatar is tapped).
		const meta = screen.getByTestId("forum-top-bar-user-meta");
		expect(meta.className).toContain("hidden");
		expect(meta.className).toContain("sm:block");

		// 5. Desktop-only toggles wrapper is `hidden sm:inline-flex`.
		const toggles = screen.getByTestId("forum-top-bar-desktop-toggles");
		expect(toggles.className).toContain("hidden");
		expect(toggles.className).toContain("sm:inline-flex");
	});
});
