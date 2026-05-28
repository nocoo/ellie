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
	formatDateTimeMobile: (t: number) => `m=${t}`,
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

	it("mobile compact stack — wide layout: surfaces 2-row latest-post line (title + user + date)", () => {
		// Reviewer freeze msg=efa3c2e9 reversed the earlier msg=8b90cb85 trim —
		// 哥的反馈是「右侧空间没利用」，移动端要恢复最新帖子标题/用户/时间，但
		// 严格 2 行密度。MobileLastPostLine 必须渲染 thread link + poster link +
		// 短日期，并且 thread link 抗截断、meta 区固定不挤压标题。
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		const threadLink = screen.getByTestId("mobile-last-thread-link");
		expect(threadLink.tagName).toBe("A");
		expect(threadLink.getAttribute("href")).toBe("/threads/999");
		expect(threadLink.className).toContain("truncate");
		expect(threadLink.className).toContain("min-w-0");
		expect(threadLink.className).toContain("flex-1");

		const posterLink = screen.getByTestId("mobile-last-poster-link");
		expect(posterLink.tagName).toBe("A");
		expect(posterLink.getAttribute("href")).toBe("/users/12345");
		expect(posterLink.className).toContain("truncate");
		expect(posterLink.className).toContain("min-w-0");

		const date = screen.getByTestId("mobile-last-post-date");
		expect(date.className).toContain("whitespace-nowrap");
		expect(date.className).toContain("shrink-0");
		expect(date.className).toContain("tabular-nums");
		// Date uses the compact mobile formatter (`m=...`), never the long
		// `formatDateTime` form — that would crowd the title at 320px.
		expect(date.textContent).toBe(`m=${lastPostForum.lastPostAt}`);
	});

	it("mobile compact stack — wide layout: meta region is width-capped so title keeps space", () => {
		// `max-w-[42%]` on the meta wrapper guarantees the title link always has
		// at least ~58% of the row width to truncate gracefully — otherwise long
		// usernames would push the title off-screen even with `flex-1`.
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		const date = screen.getByTestId("mobile-last-post-date");
		const metaWrapper = date.parentElement;
		expect(metaWrapper?.className).toContain("max-w-[42%]");
		expect(metaWrapper?.className).toContain("shrink-0");
	});

	it("mobile compact stack — wide layout: empty state renders 2-row placeholder", () => {
		// `lastPostAt === 0` would collapse the row to 1 line without an empty
		// state. Reviewer pin: render "暂无最新主题" so every card keeps the same
		// 2-line height on mobile.
		render(createElement(ForumCard, { forum: makeForum(), layout: "wide" }));
		const empty = screen.getByTestId("mobile-last-post-empty");
		expect(empty.textContent).toBe("暂无最新主题");
		expect(screen.queryByTestId("mobile-last-thread-link")).toBeNull();
		expect(screen.queryByTestId("mobile-last-poster-link")).toBeNull();
		expect(screen.queryByTestId("mobile-last-post-date")).toBeNull();
	});

	it("mobile compact stack — wide layout: avatar slot is dropped for anonymous poster", () => {
		// When `lastPosterId <= 0` there is no avatar to render, but the thread
		// title and timestamp still surface so users see freshness signal.
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
		// `ForumAvatar` mock renders `data-testid="avatar"`. With the anonymous
		// poster, the mobile branch should not render an avatar node inside the
		// mobile row (other rows like the wide-layout sm:flex still might).
		const row = screen.getByTestId("mobile-last-post-row");
		expect(row.querySelector("[data-testid=avatar]")).toBeNull();
		expect(screen.getByTestId("mobile-last-thread-link").textContent).toBe("Hi");
		// Anonymous poster name renders as plain span, not a Link.
		const poster = screen.getByTestId("mobile-last-poster-link");
		expect(poster.tagName).toBe("SPAN");
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

	it("mobile compact row (Row 2) uses text-xs (date + username at 12px)", () => {
		// Mobile Row 2 carries thread-link, poster-link and compact date in
		// 12px so the auxiliary meta stays tighter than the 14px Row 1 name.
		render(createElement(ForumCard, { forum: lastPostForum, layout: "wide" }));
		const row = screen.getByTestId("mobile-last-post-row");
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

// ─── Mobile 2-row contract (reviewer freeze msg=efa3c2e9) ────────────────────
// Reversed the earlier msg=8b90cb85 "hide everything" freeze: the per-row
// auxiliary content (latest thread title + user + short date) is now visible
// on mobile, but bounded so every card stays at exactly 2 lines.
describe("ForumCard — mobile 2-row contract", () => {
	it("wide layout mobile name uses `min-w-0 truncate`, today-pill is shrink-0 (no overflow on long names)", () => {
		const longName = makeForum({ name: "一二三四五六七八九十一二三四五六七", todayThreads: 5 });
		render(createElement(ForumCard, { forum: longName, layout: "wide" }));
		const nameLinks = screen.getAllByText(longName.name);
		const hasTruncate = nameLinks.some(
			(el) => el.className.includes("truncate") && el.className.includes("min-w-0"),
		);
		expect(hasTruncate).toBe(true);
		const pills = screen.getAllByText(/^\+?5$|^\(5\)$/);
		const pillShrink = pills.some((el) => el.className.includes("shrink-0"));
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

	it("grid layout Row 1 (name + today badge) is flex-nowrap on mobile, flex-wrap on sm+", () => {
		// Reviewer freeze msg=683d8fff: grid mobile Row 1 used to be
		// `flex-wrap`, which let a long forum name push the today-badge to a
		// 2nd line and broke the 2-row mobile density contract. Pin the new
		// mobile-only `flex-nowrap` + `sm:flex-wrap` tokens, the name link's
		// `flex-1 min-w-0 truncate`, and the badge wrapper's `shrink-0` so a
		// future refactor can't silently re-introduce the wrap.
		const longName = makeForum({
			name: "一二三四五六七八九十一二三四五六七",
			todayThreads: 5,
		});
		render(createElement(ForumCard, { forum: longName, layout: "grid" }));
		const row1 = screen.getByTestId("grid-row1");
		expect(row1.className).toContain("flex-nowrap");
		expect(row1.className).toContain("sm:flex-wrap");
		const nameLink = row1.querySelector("a");
		expect(nameLink).not.toBeNull();
		expect(nameLink?.className).toContain("flex-1");
		expect(nameLink?.className).toContain("min-w-0");
		expect(nameLink?.className).toContain("truncate");
		// Today badge wrapper keeps shrink-0 — guards against name pushing it out.
		const badgeText = screen.getAllByText(/^[+(]?5[)]?$/);
		const wrapper = badgeText.find((el) =>
			el.parentElement?.classList.contains("shrink-0"),
		)?.parentElement;
		expect(wrapper?.className).toContain("shrink-0");
	});

	it("grid layout: mobile Row 2 surfaces shared MobileLastPostLine; desktop row stays `hidden sm:flex`", () => {
		const withMods = makeForum({
			moderatorList: [{ id: 1, name: "mod-a" }],
			lastThreadId: 9,
			lastThreadSubject: "Title",
			lastPostAt: 100,
			lastPoster: "alice",
			lastPosterId: 1,
		});
		render(createElement(ForumCard, { forum: withMods, layout: "grid" }));
		// Stats/moderator rows are still desktop-only — they are *not* part of
		// the 2-row mobile budget; only Row 2 latest-post info is.
		const statsRow = screen.getByTestId("grid-stats-row");
		expect(statsRow.className).toContain("hidden");
		expect(statsRow.className).toMatch(/sm:(block|inline)/);
		const modRow = screen.getByTestId("forum-meta-版主");
		expect(modRow.parentElement?.className).toContain("hidden");
		// Desktop grid last-post row stays `hidden sm:flex` so it does not
		// double up with the mobile shared helper.
		const desktopGridRow = screen.getByTestId("grid-last-post-row");
		expect(desktopGridRow.className).toContain("hidden");
		expect(desktopGridRow.className).toMatch(/sm:(block|flex|inline)/);
		// Mobile shared helper produces the new 2-row latest-post line.
		expect(screen.getByTestId("mobile-last-thread-link").getAttribute("href")).toBe("/threads/9");
		expect(screen.getByTestId("mobile-last-poster-link").getAttribute("href")).toBe("/users/1");
		expect(screen.getByTestId("mobile-last-post-date").textContent).toBe("m=100");
	});

	it("grid layout empty state: mobile Row 2 shows '暂无最新主题' to keep 2-row density", () => {
		// `lastPostAt === 0` — desktop drops its grid-last-post-row entirely
		// (it's gated on `lastPostAt > 0`), but mobile must still render the
		// empty-state placeholder so the card stays at 2 lines.
		render(createElement(ForumCard, { forum: makeForum(), layout: "grid" }));
		expect(screen.queryByTestId("grid-last-post-row")).toBeNull();
		const empty = screen.getByTestId("mobile-last-post-empty");
		expect(empty.textContent).toBe("暂无最新主题");
	});
});
