// @vitest-environment happy-dom
// PostSidebar 14/12 font baseline tests — kept in a separate file because
// post-font-baseline.test.ts mocks PostSidebar at module scope (it's nested
// inside PostCard tests there), which would shadow the real component here.

import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

vi.mock("@/lib/cdn", () => ({
	getStaticImageUrl: (name: string) => `/static/${name}`,
}));

vi.mock("@/lib/avatar", () => ({
	getAvatarUrl: () => "/avatar.gif",
}));

vi.mock("@/components/forum/user-avatar", () => ({
	UserAvatar: () => createElement("div", { "data-testid": "avatar" }),
}));

vi.mock("@/components/forum/user-popover", () => ({
	UserPopover: ({ children }: any) => createElement("span", null, children),
}));

vi.mock("@/components/forum/post-sidebar-message-button", () => ({
	PostSidebarMessageButton: () => createElement("div", null),
}));

vi.mock("@/viewmodels/forum/thread-detail", () => ({
	formatDate: (t: number) => `d=${t}`,
}));

vi.mock("@/viewmodels/forum/user-profile", () => ({
	formatCheckinLevel: () => "Lv.3 活跃居民",
	formatCheckinDays: () => "累计 30 天",
}));

vi.mock("@/viewmodels/shared/formatting", () => ({
	formatNumber: (n: number) => String(n),
}));

import { PostSidebar } from "@/components/forum/post-sidebar";

afterEach(() => {
	cleanup();
});

function makeAuthor(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		username: "alice",
		avatarPath: "",
		role: "user",
		groupId: 0,
		groupTitle: "",
		groupColor: "",
		groupStars: 0,
		customTitle: "",
		campus: "",
		threads: 12,
		posts: 34,
		credits: 56,
		coins: 78,
		regDate: 1_700_000_000,
		olTime: 100,
		digestPosts: 2,
		checkin: { totalDays: 30 },
		...overrides,
	} as any;
}

describe("PostSidebar — 14/12 baseline", () => {
	it("desktop author username uses text-xs (was text-sm — usernames are 12px)", () => {
		render(
			createElement(PostSidebar, {
				author: makeAuthor(),
			}),
		);
		const author = screen.getByTestId("post-sidebar-author");
		expect(author.className).toContain("text-xs");
		expect(author.className).not.toContain("text-sm");
	});

	it("desktop '未知用户' fallback also uses text-xs", () => {
		render(
			createElement(PostSidebar, {
				author: null,
			}),
		);
		const author = screen.getByTestId("post-sidebar-author");
		expect(author.className).toContain("text-xs");
		expect(author.textContent).toBe("未知用户");
	});

	// ─── Anonymous masking (mig 0047) ──────────────────────────────────
	it("isAnonymous=true renders '匿名' instead of '未知用户'", () => {
		render(
			createElement(PostSidebar, {
				author: null,
				isAnonymous: true,
			}),
		);
		const author = screen.getByTestId("post-sidebar-author");
		expect(author.textContent).toBe("匿名");
		// Must not be a clickable user link.
		expect(author.tagName).toBe("SPAN");
	});

	it("isAnonymous=true with a populated author still renders '匿名'", () => {
		// Defence in depth: even if the worker accidentally surfaced the
		// real author, the flag wins on the render side.
		render(
			createElement(PostSidebar, {
				author: makeAuthor(),
				isAnonymous: true,
			}),
		);
		const author = screen.getByTestId("post-sidebar-author");
		expect(author.textContent).toBe("匿名");
	});

	it("checkin days uses text-xs (was text-2xs — 12px floor)", () => {
		render(
			createElement(PostSidebar, {
				author: makeAuthor(),
			}),
		);
		const days = screen.getByTestId("post-sidebar-checkin-days");
		expect(days.className).toContain("text-xs");
		expect(days.className).not.toContain("text-2xs");
	});

	it("stat labels (主题/回复/积分) use text-xs (was text-[10px])", () => {
		render(
			createElement(PostSidebar, {
				author: makeAuthor(),
			}),
		);
		for (const label of ["主题", "回复", "积分"]) {
			const el = screen.getByText(label);
			expect(el.className).toContain("text-xs");
			expect(el.className).not.toContain("text-[10px]");
		}
	});

	it("detail row labels (UID/同钱/注册/精华/在线) use text-xs (was text-[10px])", () => {
		render(
			createElement(PostSidebar, {
				author: makeAuthor(),
			}),
		);
		for (const label of ["UID:", "同钱:", "注册:", "精华:", "在线:"]) {
			const el = screen.getByText(label);
			expect(el.className).toContain("text-xs");
			expect(el.className).not.toContain("text-[10px]");
		}
	});

	it("campus and group title render centered in the identity card, no labels", () => {
		render(
			createElement(PostSidebar, {
				author: makeAuthor({ campus: "四平路校区", groupTitle: "同济人 Lv.2" }),
			}),
		);
		expect(screen.queryByText("校区:")).toBeNull();
		expect(screen.queryByText("等级:")).toBeNull();

		const campus = screen.getByText("四平路校区");
		expect(campus.className).toContain("truncate");
		expect(campus.parentElement?.className).toContain("text-center");

		const group = screen.getByText("同济人 Lv.2");
		expect(group.parentElement?.className).toContain("text-center");
	});
});
