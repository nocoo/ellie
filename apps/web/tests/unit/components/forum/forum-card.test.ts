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

describe("ForumCard LastPostPreview — clickable username + layout split", () => {
	const lastPostForum = makeForum({
		lastThreadId: 999,
		lastThreadSubject: "招商银行第八季数字金融训练营 (2025校招提前批)招募公告",
		lastPostAt: 1_710_925_680,
		lastPoster: "麻小麻",
		lastPosterId: 12345,
	});

	it("wide-layout last-poster username is a Link to /users/:id (no nested interactives)", () => {
		// Username MUST be wrapped in a real <Link> — previously it was only
		// hover-popover bait, leaving keyboard/click users no way to reach the
		// profile. Reviewer's constraint: no nested interactive markup, so we
		// dropped UserPopover here entirely (avatar still has its own link).
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		const link = screen.getByTestId("last-poster-link");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe("/users/12345");
		expect(link.textContent).toBe("麻小麻");
	});

	it("wide-layout date and username are in separate spans (date never gets eaten)", () => {
		// The previous single `<span class="truncate">` could swallow the
		// timestamp on long usernames. Pinning the date in its own
		// whitespace-nowrap span keeps it readable regardless of name width.
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		const date = screen.getByTestId("last-post-date");
		expect(date.tagName).toBe("SPAN");
		expect(date.className).toContain("whitespace-nowrap");
		// Date text is the formatted timestamp from the mock (`t=...`).
		expect(date.textContent).toBe(`t=${lastPostForum.lastPostAt}`);
	});

	it("wide-layout falls back to plain text when lastPosterId === 0", () => {
		// Anonymous/unknown poster: no link, no nested-interactive risk, and
		// the avatar slot is dropped (LastPosterAvatarLink returns null).
		render(
			createElement(ForumCard, {
				forum: makeForum({
					lastThreadId: 1,
					lastThreadSubject: "Hi",
					lastPostAt: 100,
					lastPoster: "guest",
					lastPosterId: 0,
				}),
				layout: "wide",
			}),
		);
		expect(screen.queryByTestId("last-poster-link")).toBeNull();
	});

	it("mobile compact stack also exposes a clickable username link", () => {
		// The mobile path (sm:hidden block) renders separately and used to have
		// no link at all. Same regression class — make sure it's covered.
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		const link = screen.getByTestId("last-poster-link-mobile");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe("/users/12345");
	});

	it("grid-layout last-poster username is a Link to /users/:id", () => {
		// Grid layout (used by groups with >10 children) had the same bug:
		// username was a bare `<span>`. Codify it.
		render(createElement(ForumCard, { forum: lastPostForum, layout: "grid" }));
		const link = screen.getByTestId("last-poster-link-grid");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe("/users/12345");
	});
});

describe("ForumCard font baseline — match home-footer text-sm, no text-2xs", () => {
	// Reviewer wants the homepage forum area to share the home-footer's
	// text-sm baseline (the user's reference point). These tests pin the
	// exact classes on the load-bearing spots in forum-card so a future
	// "let's shrink it back to text-xs" change becomes a visible regression
	// instead of a silent CSS drift.
	const lastPostForum = makeForum({
		lastThreadId: 999,
		lastThreadSubject: "Hello",
		lastPostAt: 100,
		lastPoster: "alice",
		lastPosterId: 1,
	});

	it("desktop ForumStats column uses text-sm (was text-xs)", () => {
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		// The wrapper carries the size class; the inner span only owns
		// whitespace-nowrap. Walk to the parent <div> and check that.
		const inner = screen.getByTestId("forum-stats-desktop");
		const wrapper = inner.parentElement;
		expect(wrapper?.className).toContain("text-sm");
		expect(wrapper?.className).not.toContain("text-xs");
	});

	it("LastPostPreview wrapper uses text-sm (was text-xs)", () => {
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		// Date span sits inside the LastPostPreview's outer grid; that grid
		// owns the text-sm class. Walk up to find it.
		const date = screen.getByTestId("last-post-date");
		// date span → outer flex span → flex-col div → outer grid div
		const grid = date.parentElement?.parentElement?.parentElement;
		expect(grid?.className).toContain("text-sm");
		expect(grid?.className).not.toContain("text-xs");
	});

	it("TodayThreadBadge pill uses text-xs (was text-2xs — no sub-12px)", () => {
		const withToday = makeForum({ todayThreads: 5 });
		render(createElement(ForumCard, { forum: withToday, layout: "wide" }));
		// Badge text appears as `+5` or `(5)`; walk to the inline span.
		const pillCandidates = screen.getAllByText(/^[+(]5[)]?$/);
		// At least one wrapper must use text-xs and never text-2xs.
		const hasTextXs = pillCandidates.some((el) => el.className.includes("text-xs"));
		const hasText2xs = pillCandidates.some((el) => el.className.includes("text-2xs"));
		expect(hasTextXs).toBe(true);
		expect(hasText2xs).toBe(false);
	});
});
