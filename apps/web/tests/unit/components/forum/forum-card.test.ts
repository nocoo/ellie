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

	it("mobile inline variant — wide layout: stats are intentionally hidden on mobile (no `forum-stats-inline` in the sm:hidden block)", () => {
		// Mobile freeze (msg 8b90cb85): iPhone forum-index hides secondary
		// info — 帖/回 counts go away. We assert that the wide layout's
		// `sm:hidden` block no longer renders any inline ForumStats node.
		// The desktop column (`forum-stats-desktop`) is unchanged.
		render(createElement(ForumCard, { forum: makeForum(), layout: "wide" }));
		const inlineEls = screen.queryAllByTestId("forum-stats-inline");
		expect(inlineEls.length).toBe(0);
		// Desktop column survives so wide layout still shows counts ≥640px.
		expect(screen.getAllByTestId("forum-stats-desktop").length).toBeGreaterThan(0);
	});

	it("grid layout inline variant pins whitespace-nowrap (mobile-hidden wrapper still renders the inner span)", () => {
		// Grid layout's stats row is wrapped in `hidden sm:block` for mobile,
		// but the inner inline-variant span is still in the DOM (happy-dom
		// doesn't evaluate CSS visibility). The anti-wrap guard on that span
		// must remain — that's the original homepage regression's home.
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

	it("mobile compact stack — wide layout: last-poster link and inline stats are intentionally absent (iPhone freeze)", () => {
		// Reviewer freeze (msg 8b90cb85): on iPhone the per-forum row drops
		// secondary info — last-poster username, inline 帖/回 stats, sub-forum
		// + moderator meta. Only icon, name, today-pill and last-post date
		// remain. We assert the link DOM is not produced inside the
		// `sm:hidden` mobile block; desktop links continue to work via
		// `last-poster-link` (covered above).
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		expect(screen.queryByTestId("last-poster-link-mobile")).toBeNull();
		// last-post date span remains so users still see freshness signal.
		expect(screen.getByTestId("last-post-date-mobile")).not.toBeNull();
	});

	it("mobile compact stack — wide layout: date span keeps no-wrap class (freshness pin)", () => {
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		const date = screen.getByTestId("last-post-date-mobile");
		expect(date.tagName).toBe("SPAN");
		expect(date.className).toContain("whitespace-nowrap");
		expect(date.className).toContain("shrink-0");
	});

	it("grid-layout last-poster username is a Link to /users/:id", () => {
		// Grid layout (used by groups with >10 children) had the same bug:
		// username was a bare `<span>`. Codify it.
		render(createElement(ForumCard, { forum: lastPostForum, layout: "grid" }));
		const link = screen.getByTestId("last-poster-link-grid");
		expect(link.tagName).toBe("A");
		expect(link.getAttribute("href")).toBe("/users/12345");
	});

	it("grid-layout thread title link gets min-w-0 + flex-1 so name can shrink", () => {
		// Reviewer caught: thread title is a flex child but only had `truncate`,
		// no `min-w-0/flex-1`. With long titles + a username sibling, the
		// flexbox couldn't shrink the title (default min-width:auto on flex
		// items) and the username could push the title off-screen. Pinning
		// min-w-0 + flex-1 lets the title shrink correctly while the username
		// stays at intrinsic width via shrink-0.
		render(createElement(ForumCard, { forum: lastPostForum, layout: "grid" }));
		const title = screen.getByTestId("grid-last-thread-link");
		expect(title.tagName).toBe("A");
		expect(title.className).toContain("min-w-0");
		expect(title.className).toContain("flex-1");
		expect(title.className).toContain("truncate");
		// Username sibling stays intrinsic-width.
		const userLink = screen.getByTestId("last-poster-link-grid");
		expect(userLink.className).toContain("shrink-0");
	});
});

describe("ForumCard font baseline — 14/12 mix aligned with thread-list page", () => {
	// Reviewer口径 (zheng-li msg=c5e029ab + reviewer msg=4b6f58cb):
	// 帖子列表页的字号是 14/12 组合 — 主帖标题/板块名/子版面名/末贴标题/描述/今日徽章 14px (text-sm),
	// 时间/阅读量/回复量/用户名(含版主) 12px (text-xs).
	// 首页 forum-card 必须沿用同一口径。
	const lastPostForum = makeForum({
		lastThreadId: 999,
		lastThreadSubject: "Hello",
		lastPostAt: 100,
		lastPoster: "alice",
		lastPosterId: 1,
	});

	it("desktop ForumStats column wrapper uses text-xs (stats are 12px)", () => {
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		// The wrapper carries the size class; the inner span only owns
		// whitespace-nowrap. Walk to the parent <div> and check that.
		const inner = screen.getByTestId("forum-stats-desktop");
		const wrapper = inner.parentElement;
		expect(wrapper?.className).toContain("text-xs");
		expect(wrapper?.className).not.toContain("text-sm");
	});

	it("LastPostPreview outer wrapper stays text-sm (thread title is 14px)", () => {
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		// Date span sits inside the LastPostPreview's outer grid; that grid
		// owns the text-sm class so the last-thread title inherits 14px.
		const date = screen.getByTestId("last-post-date");
		// date span → outer flex span (last-post-meta) → flex-col div → outer grid div
		const grid = date.parentElement?.parentElement?.parentElement;
		expect(grid?.className).toContain("text-sm");
	});

	it("LastPostPreview meta row (date + username) uses text-xs", () => {
		// Date and username sit inside a dedicated meta span that owns text-xs
		// so they render at 12px while the sibling thread-title link stays 14px.
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		const meta = screen.getByTestId("last-post-meta");
		expect(meta.className).toContain("text-xs");
		// Both date and username must live inside the meta span (so they inherit 12px).
		const date = screen.getByTestId("last-post-date");
		const userLink = screen.getByTestId("last-poster-link");
		expect(meta.contains(date)).toBe(true);
		expect(meta.contains(userLink)).toBe(true);
	});

	it("mobile compact meta row uses text-xs (date span)", () => {
		// Mobile meta row now carries only the last-post-date; row still uses
		// text-xs so the date renders at 12px alongside its desktop sibling.
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		const row = screen.getByTestId("mobile-meta-row");
		expect(row.className).toContain("text-xs");
		expect(row.className).not.toContain("text-sm");
	});

	it("grid layout stats row uses text-xs (12px stats)", () => {
		render(createElement(ForumCard, { forum: lastPostForum, layout: "grid" }));
		const row = screen.getByTestId("grid-stats-row");
		expect(row.className).toContain("text-xs");
		expect(row.className).not.toContain("text-sm");
	});

	it("grid layout last-post row wrapper stays text-sm (thread title is 14px)", () => {
		render(createElement(ForumCard, { forum: lastPostForum, layout: "grid" }));
		const row = screen.getByTestId("grid-last-post-row");
		expect(row.className).toContain("text-sm");
		// Title link inherits — confirm no explicit text-xs override on it.
		const title = screen.getByTestId("grid-last-thread-link");
		expect(title.className).not.toContain("text-xs");
	});

	it("grid layout username Link is text-xs (usernames are 12px even inside a 14px row)", () => {
		render(createElement(ForumCard, { forum: lastPostForum, layout: "grid" }));
		const userLink = screen.getByTestId("last-poster-link-grid");
		expect(userLink.className).toContain("text-xs");
	});

	it("SubForumLinks row stays text-sm (sub-forum names are 14px navigation)", () => {
		const withChildren = makeForum({
			children: [{ id: 11, name: "子版面 A" } as never, { id: 12, name: "子版面 B" } as never],
		});
		render(createElement(ForumCard, { forum: withChildren, layout: "wide" }));
		const row = screen.getByTestId("forum-meta-子版面");
		expect(row.className).toContain("text-sm");
		expect(row.className).not.toContain("text-xs");
	});

	it("ModeratorLinks row uses text-xs (moderator usernames are 12px per username rule)", () => {
		const withMods = makeForum({
			moderatorList: [
				{ id: 1, name: "mod-a" },
				{ id: 2, name: "mod-b" },
			],
		});
		render(createElement(ForumCard, { forum: withMods, layout: "wide" }));
		const row = screen.getByTestId("forum-meta-版主");
		expect(row.className).toContain("text-xs");
		expect(row.className).not.toContain("text-sm");
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

// ─── Mobile trim contract (reviewer freeze msg=8b90cb85) ─────────────────────
// iPhone-targeted polish removes secondary information from the forum-index
// row. These pins make sure a future "tidy up" can't re-introduce the
// removed pieces without breaking the gate.
describe("ForumCard — iPhone mobile-trim contract", () => {
	it("wide layout mobile name uses `min-w-0 truncate`, today-pill is shrink-0 (no overflow on long names)", () => {
		const longName = makeForum({ name: "一二三四五六七八九十一二三四五六七", todayThreads: 5 });
		render(createElement(ForumCard, { forum: longName, layout: "wide" }));
		const nameLinks = screen.getAllByText(longName.name);
		// The `sm:hidden` mobile block has its own copy of the name link.
		// At least one must carry truncate + min-w-0 to defend against
		// overflowing a 320–375px viewport.
		const hasTruncate = nameLinks.some(
			(el) => el.className.includes("truncate") && el.className.includes("min-w-0"),
		);
		expect(hasTruncate).toBe(true);
		// Today pill keeps shrink-0 so the long name can't push it out.
		const pills = screen.getAllByText(/^\+?5$|^\(5\)$/);
		const pillShrink = pills.some((el) => el.className.includes("shrink-0"));
		// Wide layout uses `variant="pill"` which inherits shrink-0 via the
		// wrapper; either inline-flex shrink or an ancestor shrink-0 counts.
		const pillOrAncestorShrink =
			pillShrink ||
			pills.some((el) => {
				let p: HTMLElement | null = el;
				for (let i = 0; i < 4 && p; i++) {
					if ((p.className ?? "").includes("shrink-0")) return true;
					p = p.parentElement;
				}
				return false;
			});
		expect(pillOrAncestorShrink).toBe(true);
	});

	it("grid layout: stats row, moderator line, thread-title link, and last-poster username are wrapped in `hidden sm:*`; only date is mobile-visible (mobile parity with wide)", () => {
		const withMods = makeForum({
			moderatorList: [{ id: 1, name: "mod-a" }],
			lastThreadId: 9,
			lastThreadSubject: "Title",
			lastPostAt: 100,
			lastPoster: "alice",
			lastPosterId: 1,
		});
		render(createElement(ForumCard, { forum: withMods, layout: "grid" }));
		const statsRow = screen.getByTestId("grid-stats-row");
		expect(statsRow.className).toContain("hidden");
		expect(statsRow.className).toMatch(/sm:(block|inline)/);
		const userLink = screen.getByTestId("last-poster-link-grid");
		expect(userLink.className).toContain("hidden");
		expect(userLink.className).toMatch(/sm:(block|inline)/);
		// Thread title link is desktop-only on mobile per reviewer follow-up
		// msg=ad33321c — grid mobile now mirrors wide mobile (date only).
		const titleLink = screen.getByTestId("grid-last-thread-link");
		expect(titleLink.className).toContain("hidden");
		expect(titleLink.className).toMatch(/sm:(block|inline)/);
		// Moderator line: walk up from the rendered moderator label.
		const modRow = screen.getByTestId("forum-meta-版主");
		// Wrapper div carries hidden sm:block.
		const wrapper = modRow.parentElement;
		expect(wrapper?.className).toContain("hidden");
		// The mobile-visible piece: grid's last-post date carries `sm:hidden`
		// (visible only on mobile) so the freshness signal stays — and class
		// assertions hold under happy-dom's no-media-query environment.
		const mobileDate = screen.getByTestId("grid-last-post-date-mobile");
		expect(mobileDate.className).toContain("sm:hidden");
	});
});
