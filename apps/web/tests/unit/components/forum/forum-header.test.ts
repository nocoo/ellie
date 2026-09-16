// @vitest-environment happy-dom
// Tests for ForumHeader TopBar — profile card layout, coins display, single trigger
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: navigation.push }),
	usePathname: () => navigation.pathname,
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
	ThemeToggle: () => createElement("button", { type: "button", "aria-label": "切换主题" }),
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
	navigation.pathname = "/";
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

describe("ForumHeader navigation and search", () => {
	it("matches forum routes at path boundaries", () => {
		navigation.pathname = "/forums/20";
		const vm = makeVm();
		vm.navTabs = [
			{ label: "论坛二", href: "/forums/2" },
			{ label: "论坛二十", href: "/forums/20" },
		];
		render(createElement(ForumHeader, { vm }));
		expect(screen.getByText("论坛二").getAttribute("aria-current")).toBeNull();
		expect(screen.getByText("论坛二十").getAttribute("aria-current")).toBe("page");
	});

	it("searches a trimmed query and leaves short queries in place", () => {
		render(createElement(ForumHeader, { vm: makeVm() }));
		const input = screen.getByRole("searchbox", { name: "搜索主题" });
		fireEvent.change(input, { target: { value: " 校园 " } });
		fireEvent.submit(screen.getByRole("searchbox").closest("form") as HTMLFormElement);
		expect(navigation.push).toHaveBeenCalledWith(`/search?q=${encodeURIComponent("校园")}`);
		fireEvent.change(input, { target: { value: "a" } });
		fireEvent.submit(screen.getByRole("searchbox").closest("form") as HTMLFormElement);
		expect(navigation.push).toHaveBeenCalledTimes(1);
	});

	it("focuses search with slash without interrupting editors and removes the listener on unmount", () => {
		const remove = vi.spyOn(document, "removeEventListener");
		const view = render(createElement(ForumHeader, { vm: makeVm() }));
		const input = screen.getByRole("searchbox");
		fireEvent.keyDown(document, { key: "/" });
		expect(document.activeElement).toBe(input);
		const editor = document.createElement("div");
		editor.setAttribute("contenteditable", "true");
		editor.tabIndex = 0;
		document.body.append(editor);
		editor.focus();
		fireEvent.keyDown(editor, { key: "/" });
		expect(document.activeElement).toBe(editor);
		fireEvent.keyDown(document, { key: "/", ctrlKey: true });
		expect(document.activeElement).toBe(editor);
		view.unmount();
		expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function));
		editor.remove();
		remove.mockRestore();
	});

	it("keeps search and theme controls available and links registration to its page", () => {
		const vm = makeVm();
		vm.user = null;
		render(createElement(ForumHeader, { vm }));
		expect(screen.getByRole("searchbox")).toBeDefined();
		expect(screen.getByRole("button", { name: "切换主题" })).toBeDefined();
		expect(screen.getByRole("link", { name: "注册" }).getAttribute("href")).toBe("/register");
		expect(screen.getAllByText("—")).toHaveLength(5);
	});
});
