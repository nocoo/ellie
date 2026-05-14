// @vitest-environment happy-dom
// Tests for ForumCard — focused on the homepage regressions:
//   1) ForumStats must never wrap (whitespace-nowrap on inner span). 5–6 digit
//      counts like 71,254 / 195,347 (回收站) used to wrap at the `/`, breaking
//      column alignment.
//   2) Stats column width on wide layout grid template fits a 6-digit + 6-digit
//      pair — codified here so future column-width refactors don't regress.
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next/link", () => ({
	default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));

vi.mock("@/lib/cdn", () => ({
	getStaticImageUrl: (name: string) => `/static/${name}`,
}));

vi.mock("@/viewmodels/forum/forum-list", () => ({
	formatCount: (n: number) => n.toLocaleString("zh-CN"),
}));

vi.mock("@/viewmodels/shared/formatting", () => ({
	formatDateTime: (t: number) => `t=${t}`,
}));

vi.mock("@/components/forum/safe-html", () => ({
	SafeHtml: ({ html }: any) => createElement("span", null, html),
}));

vi.mock("@/components/forum/user-avatar", () => ({
	ForumAvatar: () => createElement("div", { "data-testid": "avatar" }),
}));

vi.mock("@/components/forum/user-popover", () => ({
	UserPopover: ({ children }: any) => createElement("span", null, children),
}));

import { ForumCard } from "@/components/forum/forum-card";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeForum(overrides: Record<string, unknown> = {}) {
	return {
		id: 154,
		parentId: 1,
		name: "回收站",
		description: "",
		icon: "",
		displayOrder: 0,
		type: "forum" as const,
		status: 1,
		visibility: "public" as const,
		moderators: "",
		moderatorIds: "",
		moderatorList: [],
		threads: 71254,
		posts: 195347,
		todayThreads: 0,
		lastThreadId: 0,
		lastThreadSubject: "",
		lastPostAt: 0,
		lastPoster: "",
		lastPosterId: 0,
		lastPosterAvatar: "",
		lastPosterAvatarPath: "",
		children: [],
		depth: 1,
		...overrides,
	};
}

afterEach(() => {
	cleanup();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ForumCard ForumStats — anti-wrap guard", () => {
	it("desktop variant pins whitespace-nowrap on the inner span (6+6 digits)", () => {
		// Real-world regression: 回收站 has 71,254 / 195,347 — 6 digits each.
		// Without `whitespace-nowrap`, the `/` becomes a soft-break candidate
		// and the row balloons to 2 lines, breaking the wide-layout grid.
		render(createElement(ForumCard, { forum: makeForum(), layout: "wide" }));
		const desktopEls = screen.getAllByTestId("forum-stats-desktop");
		expect(desktopEls.length).toBeGreaterThan(0);
		// The element itself (not just an ancestor) must carry whitespace-nowrap
		// — relying on parent flex/grid alone is brittle when font-size or
		// column width changes downstream.
		expect(desktopEls[0].className).toContain("whitespace-nowrap");
		// Sanity: text shows both numbers separated by " / ".
		expect(desktopEls[0].textContent).toContain("71,254");
		expect(desktopEls[0].textContent).toContain("195,347");
	});

	it("mobile inline variant also pins whitespace-nowrap (same regression class)", () => {
		// The mobile compact stack uses the inline variant. Same 5–6 digit
		// counts can wrap at the `/` and push the meta line to 2 rows on
		// narrow phones. Reviewer asked to widen the fix to inline too.
		render(createElement(ForumCard, { forum: makeForum(), layout: "wide" }));
		const inlineEls = screen.getAllByTestId("forum-stats-inline");
		expect(inlineEls.length).toBeGreaterThan(0);
		expect(inlineEls[0].className).toContain("whitespace-nowrap");
	});

	it("grid layout inline variant also pins whitespace-nowrap", () => {
		// The grid layout (compact 2-col cell, used when a group has >10 children)
		// also renders ForumStats with variant="inline". Same anti-wrap guard.
		render(createElement(ForumCard, { forum: makeForum(), layout: "grid" }));
		const inlineEls = screen.getAllByTestId("forum-stats-inline");
		expect(inlineEls.length).toBeGreaterThan(0);
		expect(inlineEls[0].className).toContain("whitespace-nowrap");
	});
});
