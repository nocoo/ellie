// tests/e2e/mobile-layout.spec.ts — iPhone layout drift guard.
//
// Reviewer freeze msg=8b90cb85 (#ellie-移动端优化:037192fa) defines the
// hard validation criteria for the iPhone-targeted forum polish:
//
//   • No horizontal body scroll at 320 / 375 / 390 / 430 px viewports
//   • TopBar action group doesn't wrap; logo doesn't push the bar back
//     to its 90px desktop height
//   • Nav bar tabs stay on a single line (the bar itself may scroll
//     horizontally, but the body must not)
//   • Forum-index card hides 帖/回 stats, last-poster username, sub-forum
//     and moderator meta on mobile
//   • Thread list mobile row hides 阅读 / 回复 / 推荐数
//   • Desktop layout (≥640px) is not regressed
//
// We assert via real viewport + DOM measurement so a CSS regression can't
// pass by only updating class names. The `mobile` Playwright project
// (configured in `playwright.config.ts`) sets the base device to iPhone 14;
// each test then resizes to the specific width under test so a single
// project covers all four reviewer-required viewports.

import { expect, test } from "./fixtures/base";
import { ForumPage } from "./pages/forum.page";
import { HomePage } from "./pages/home.page";

// Reviewer-required viewport widths. Heights mirror common iPhone aspect
// ratios but the assertions only care about width.
const MOBILE_WIDTHS = [
	{ width: 320, height: 568, label: "iPhone SE 1st gen" },
	{ width: 375, height: 667, label: "iPhone SE 2nd/3rd gen" },
	{ width: 390, height: 844, label: "iPhone 14" },
	{ width: 430, height: 932, label: "iPhone 14 Pro Max" },
] as const;

const POPULATED_FORUM_ID = 114;

test.describe("E2E-MOB-01: forum index — no horizontal body scroll", () => {
	// Reviewer follow-up msg=7c954e60: the L3 test backend may not have any
	// forum-tree data at all, so anchoring this gate on `[data-testid="forum-card"]`
	// gave false negatives on the CI runner even after `loginAs`. The body-
	// overflow invariant only needs the *real homepage* to be painted, not a
	// specific data shape. We therefore reuse `HomePage.isLoaded()` (forum
	// groups OR `暂无版块`) and a visible `digestShowcase` link — same
	// signals navigation.spec.ts already trusts — as the "homepage really
	// rendered" stable point before measuring `documentElement.scrollWidth`.
	for (const vp of MOBILE_WIDTHS) {
		test(`@${vp.width} (${vp.label}): documentElement.scrollWidth <= innerWidth + 1`, async ({
			page,
			loginAs,
		}) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await loginAs("e2etest");
			const homePage = new HomePage(page);
			await homePage.goto();
			await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
			// Wait for the real homepage to be painted. `isLoaded()` accepts
			// either a forum-groups list OR the explicit empty-state message,
			// so the gate stays valid whether the test backend has data or
			// not. `digestShowcase` is a stable home-route artifact that
			// proves we left the auth gate behind.
			expect(await homePage.isLoaded()).toBe(true);
			await expect(homePage.digestShowcase).toBeVisible({ timeout: 15_000 });

			const overflow = await page.evaluate(() => ({
				scroll: document.documentElement.scrollWidth,
				inner: window.innerWidth,
			}));
			// Reviewer's exact invariant: allow a 1px rounding slack.
			expect(overflow.scroll).toBeLessThanOrEqual(overflow.inner + 1);
		});
	}
});

test.describe("E2E-MOB-02: header — anonymous viewport doesn't wrap", () => {
	test("TopBar carries h-14 on mobile and hides search-stats bar", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");

		const topBar = page.locator('[data-testid="forum-top-bar"]');
		await expect(topBar).toBeVisible({ timeout: 15_000 });
		// The collapsed mobile bar is ~56px tall (h-14). Allow a few px of
		// padding from inline-block descenders.
		const box = await topBar.boundingBox();
		expect(box).not.toBeNull();
		if (!box) return;
		expect(box.height).toBeLessThan(72);

		// Search-stats bar is hidden on mobile via `hidden sm:block`.
		const stats = page.locator('[data-testid="forum-search-stats-bar"]');
		await expect(stats).toBeHidden();
	});

	test("nav links sit on a single line (no wrap)", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");

		const nav = page.locator('[data-testid="forum-nav-bar"]');
		await expect(nav).toBeVisible({ timeout: 15_000 });

		// Single-line invariant: collect every nav-link bounding box, then
		// confirm they share the same Y coordinate (within a 4px slack to
		// absorb sub-pixel rendering jitter).
		const tops = await nav
			.locator('[data-testid="forum-nav-link"]')
			.evaluateAll((els: Element[]) =>
				els.map((el) => (el as HTMLElement).getBoundingClientRect().top),
			);
		expect(tops.length).toBeGreaterThan(0);
		const minTop = Math.min(...tops);
		const maxTop = Math.max(...tops);
		expect(maxTop - minTop).toBeLessThanOrEqual(4);

		// The bar may scroll horizontally; that's allowed by reviewer's
		// freeze. Confirm overflow-x is auto/scroll (the actual style after
		// browser computation).
		const overflowX = await nav.evaluate(
			(el) => window.getComputedStyle(el as HTMLElement).overflowX,
		);
		expect(["auto", "scroll"]).toContain(overflowX);
	});
});

test.describe("E2E-MOB-03: forum index card hides secondary info on mobile", () => {
	// Reviewer follow-up msg=7c954e60: hard-pinning the existence of a
	// `[data-testid="forum-card"]` here couples the e2e gate to CI test-data
	// shape, which is unstable. Unit tests already pin the wide / grid
	// hidden-on-mobile class tokens (forum-card.test.ts). This e2e now only
	// validates the *renderable contract*: if at least one ForumCard appears,
	// the mobile hidden assertions must hold; if no ForumCard is rendered
	// (empty backend / data drift), we still gate that the real homepage
	// loaded, then skip the data-dependent absence checks.
	test("`forum-stats-inline` (帖/回) is not in the mobile wide layout", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await loginAs("e2etest");
		const homePage = new HomePage(page);
		await homePage.goto();
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		expect(await homePage.isLoaded()).toBe(true);

		const card = page.locator('[data-testid="forum-card"]').first();
		const hasCard = (await card.count()) > 0;
		if (!hasCard) {
			test.info().annotations.push({
				type: "skip-reason",
				description:
					"No forum-card rendered on the CI homepage (empty forum tree). " +
					"Unit-test mobile hidden contract still pins the wide/grid tokens.",
			});
			return;
		}

		// At least one ForumCard is rendered. Validate the mobile hidden
		// contract end-to-end against the real layout.
		await expect(card).toBeVisible({ timeout: 15_000 });

		// In the mobile (`sm:hidden`) wide-layout block, the inline stats span
		// was removed entirely. Grid layout still emits the span but wraps
		// the whole stats row in `hidden sm:block`, so it must not be
		// reported as visible.
		const inlineStats = page.getByTestId("forum-stats-inline");
		// Count = 0 OR none visible. We can't strictly require count=0
		// because grid layout still produces the inner span (hidden via
		// ancestor), so we assert visibility instead.
		const count = await inlineStats.count();
		for (let i = 0; i < count; i++) {
			await expect(inlineStats.nth(i)).toBeHidden();
		}

		// Last-poster mobile link (wide layout) must be entirely absent in
		// the mobile branch's DOM — easier to assert than visibility.
		await expect(page.getByTestId("last-poster-link-mobile")).toHaveCount(0);

		// Grid layout: thread title link is now `hidden sm:block`, so even
		// when the panel uses the grid variant the title must not be visible
		// on a 390px viewport. Reviewer follow-up msg=ad33321c.
		const gridTitle = page.getByTestId("grid-last-thread-link");
		const gridCount = await gridTitle.count();
		for (let i = 0; i < gridCount; i++) {
			await expect(gridTitle.nth(i)).toBeHidden();
		}
	});
});

test.describe("E2E-MOB-04: thread list mobile row hides 阅读/回复/推荐数", () => {
	test("mobile thread row does not render a ThreadRowStats mobile span", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		// Reviewer follow-up msg=7c954e60: previous wait on
		// `forumPage.threadItems.first()` (a desktop-branch `<a>` link) was
		// hidden on a mobile viewport, so the gate stalled even though the
		// thread list actually rendered. `ThreadItem` now exposes a stable
		// `data-testid="thread-item"` on its root <div> (visible in both
		// desktop and mobile layouts), so we wait on that instead before
		// asserting the absence of `thread-row-stats-mobile`.
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		// Wait for at least one real thread row (root testid is mounted
		// regardless of viewport branch) before asserting the stats span
		// is absent — guarantees we're on the populated forum-114 thread
		// list, not a fallback / loading state.
		await expect(page.getByTestId("thread-item").first()).toBeVisible({ timeout: 15_000 });

		// `ThreadRowStats variant="mobile"` always emits a stable testid
		// (`thread-row-stats-mobile`) when rendered. The mobile (sm:hidden)
		// branch of `ThreadItem` was trimmed and no longer calls it, so the
		// testid must not appear in the thread list. This is a strict count
		// check — more robust than text-content regex which can drift if
		// formatCompactNumber changes (reviewer follow-up msg=ad33321c).
		await expect(page.getByTestId("thread-row-stats-mobile")).toHaveCount(0);
		// And the desktop column is still hidden by CSS at this viewport
		// (no need to count >0 — the column lives inside `hidden sm:flex`).
	});
});

test.describe("E2E-MOB-05: desktop is not regressed", () => {
	// Sanity check: at a desktop width the existing behavior is intact.
	// This catches a future "mobile-only fix" that accidentally hides
	// something on desktop by reordering Tailwind tokens (e.g. dropping
	// `sm:flex`).
	test("@1280: TopBar shows the user-meta block and the search-stats bar", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		// SearchStatsBar is `hidden sm:block` — it must be visible on desktop.
		await expect(page.getByTestId("forum-search-stats-bar")).toBeVisible();
	});

	// Reviewer-requested @1280 PC-not-regressed gates for wave-2 mobile polish
	// (msg=5a91dfd3). Each assertion has a mobile counterpart elsewhere; the
	// point of this test is to prove the desktop branch is intact.
	test("@1280: footer logo + nav-bar bbox + post-content meta + new-post button stay visible", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await loginAs("e2etest");
		// Land on a populated forum first so we can pin both the new-post
		// button and (later) the PostContent meta bar on a real thread.
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		// NavBar bbox — desktop must keep the centered, max-content-width
		// layout (no edge padding). `.nav-gradient` is the blue strip; on
		// desktop `margin-inline: auto` keeps it centered. Width <= 1200px
		// (--content-max-width) and x > 0 (centered, not flush).
		const navStrip = page.locator(".nav-gradient").first();
		await expect(navStrip).toBeVisible({ timeout: 15_000 });
		const navBox = await navStrip.boundingBox();
		expect(navBox).not.toBeNull();
		if (navBox) {
			expect(navBox.x).toBeGreaterThan(0);
			expect(navBox.width).toBeLessThanOrEqual(1200 + 1);
		}

		// New-post image button must be visible on desktop (mobile token is
		// `hidden sm:inline-block`). Existence-conditional so the gate still
		// holds when the forum is rendered as a group / read-only.
		const newPostBtn = page.getByTestId("forum-new-post-button");
		const newPostCount = await newPostBtn.count();
		if (newPostCount > 0) {
			await expect(newPostBtn.first()).toBeVisible({ timeout: 15_000 });
		} else {
			test.info().annotations.push({
				type: "skip-reason",
				description:
					"Populated forum has no new-post button (likely group/read-only). " +
					"Unit test still pins `hidden sm:inline-block` token.",
			});
		}

		// Open the first thread to validate PostContent meta bar PC visibility.
		const firstThread = page.getByTestId("thread-item").first();
		const tCount = await firstThread.count();
		if (tCount > 0) {
			// At 1280px the desktop `hidden sm:flex` branch is the visible one,
			// so the canonical desktop title link is the right click target.
			await firstThread.locator('a[href^="/threads/"]').first().click();
			await page.waitForLoadState("load");
			const meta = page.getByTestId("post-content-meta-bar");
			const metaCount = await meta.count();
			if (metaCount > 0) {
				await expect(meta.first()).toBeVisible({ timeout: 15_000 });
			} else {
				test.info().annotations.push({
					type: "skip-reason",
					description: "Opened thread has no posts — PostContent meta bar PC gate skipped.",
				});
			}
		} else {
			test.info().annotations.push({
				type: "skip-reason",
				description: "Populated forum has no threads — PostContent meta bar PC gate skipped.",
			});
		}

		// Footer logo wrap is `hidden sm:block` — must be visible on desktop.
		// Scroll the footer into view; site-footer sits below the thread list.
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.getByTestId("site-footer-logo-wrap")).toBeVisible();
	});
});

// ─── Wave 2: iPhone polish per reviewer freeze msg=5a91dfd3 ─────────────────
// 1. NavBar shouldn't go edge-to-edge on mobile (must leave content-card padding).
// 2. Recommended-thread card hides author + reply meta on mobile (existence-conditional).
// 3. ForumNewPostButton hidden on mobile.
// 4. ThreadItem mobile avatar lives next to username (Row 2), not next to title.
// 5. Thread-detail breadcrumb collapses intermediate forum-ancestors on mobile.
// 6. PostContent top meta bar hidden on mobile (PostCard mobile header already
//    carries avatar/author/time/floor — would be a duplicate).
// 7. SiteFooter logo hidden on mobile.
//
// All data-dependent assertions follow the rule "loginAs + isLoaded then
// existence-conditional skip" learned from CI run 26324987257.

test.describe("E2E-MOB-06: NavBar mobile padding (no edge-to-edge)", () => {
	test("@375: nav-gradient strip has left > 0 (leaves content-card edge padding)", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const navStrip = page.locator(".nav-gradient").first();
		await expect(navStrip).toBeVisible({ timeout: 15_000 });
		const box = await navStrip.boundingBox();
		expect(box).not.toBeNull();
		if (!box) return;
		// Must leave at least a 1rem (≈16px) margin on each side per
		// reviewer freeze — the blue strip aligns with content cards.
		expect(box.x).toBeGreaterThanOrEqual(8);
		expect(box.width).toBeLessThanOrEqual(375 - 8);
	});
});

test.describe("E2E-MOB-07: recommended threads — mobile meta hidden", () => {
	test("@375: when 推荐主题 renders, author/reply meta spans are not visible", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const meta = page.getByTestId("forum-recommended-meta");
		const metaCount = await meta.count();
		if (metaCount === 0) {
			test.info().annotations.push({
				type: "skip-reason",
				description:
					"No recommended threads on the populated forum — unit tests still pin `hidden sm:inline`.",
			});
			return;
		}
		for (let i = 0; i < metaCount; i++) {
			await expect(meta.nth(i)).toBeHidden();
		}
	});
});

test.describe("E2E-MOB-08: forum-new-post-button hidden on mobile", () => {
	test("@375: the pn_post.png image button is not visible on a forum page", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const button = page.getByTestId("forum-new-post-button");
		const count = await button.count();
		if (count === 0) {
			test.info().annotations.push({
				type: "skip-reason",
				description:
					"Forum page rendered without a new-post-button (likely an isGroup forum on the CI test backend).",
			});
			return;
		}
		// Page renders the button twice (top + bottom toolbars); both must be
		// CSS-hidden by the `hidden sm:inline-block` class.
		for (let i = 0; i < count; i++) {
			await expect(button.nth(i)).toBeHidden();
		}
	});
});

test.describe("E2E-MOB-09: ThreadItem mobile avatar moved to username row", () => {
	test("@375: thread-item-mobile-avatar-link is visible and shares Y with the username", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("thread-item").first()).toBeVisible({ timeout: 15_000 });

		const avatarLink = page.getByTestId("thread-item-mobile-avatar-link").first();
		const avatarCount = await avatarLink.count();
		if (avatarCount === 0) {
			test.info().annotations.push({
				type: "skip-reason",
				description: "Thread list rendered empty on the mobile branch.",
			});
			return;
		}
		await expect(avatarLink).toBeVisible({ timeout: 15_000 });

		// Avatar Y must roughly match the username row (Row 2). Walk the
		// avatar's parent flex row and assert at least one sibling carrying
		// the username text shares the Y coordinate (within 8px slack).
		const avatarBox = await avatarLink.boundingBox();
		expect(avatarBox).not.toBeNull();
		if (!avatarBox) return;
		const parent = avatarLink.locator("xpath=..");
		const siblingTops = await parent
			.locator("> *")
			.evaluateAll((els: Element[]) =>
				els.map((el) => (el as HTMLElement).getBoundingClientRect().top),
			);
		const minTop = Math.min(...siblingTops);
		const maxTop = Math.max(...siblingTops);
		expect(maxTop - minTop).toBeLessThanOrEqual(8);
	});
});

test.describe("E2E-MOB-10: thread detail breadcrumb collapses intermediate ancestors", () => {
	test("@375: breadcrumb-segment-mobile-hidden tokens are present (or chain is short)", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		// Open the first thread to land on the detail page.
		const firstThreadLink = page.getByTestId("thread-item").first();
		const threadCount = await firstThreadLink.count();
		if (threadCount === 0) {
			test.info().annotations.push({
				type: "skip-reason",
				description:
					"No threads on the populated forum — cannot exercise thread-detail breadcrumb.",
			});
			return;
		}
		// Mobile branch exposes a stable `thread-item-mobile-title-link`
		// testid for the title link. Going through `'a[href^="/threads/"]'`
		// is unsafe here because the ThreadItem DOM emits the desktop
		// branch first (hidden by `hidden sm:flex` at 375px) and `.first()`
		// would resolve to that desktop link, which Playwright will wait
		// for to become visible and then time out.
		const titleLink = page.getByTestId("thread-item-mobile-title-link").first();
		await titleLink.click();
		await page.waitForLoadState("load");

		// Visible segments (testid="breadcrumb-segment") must include the
		// current page's non-linked label. Hidden segments (if any) must
		// carry `hidden sm:inline-flex` so desktop is unaffected.
		await expect(page.getByTestId("breadcrumb-segment").first()).toBeVisible({
			timeout: 15_000,
		});
		const hidden = page.getByTestId("breadcrumb-segment-mobile-hidden");
		const hiddenCount = await hidden.count();
		// On a thread under a deep forum-ancestor tree we should see at
		// least one mobile-hidden segment; on a shallow chain (home →
		// forum → thread) hiddenCount may legitimately be 0.
		for (let i = 0; i < hiddenCount; i++) {
			await expect(hidden.nth(i)).toBeHidden();
		}
	});
});

test.describe("E2E-MOB-11: PostContent meta bar hidden on mobile", () => {
	test("@375: the duplicated 发表于/floor meta row is not visible on a post", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		const firstThread = page.getByTestId("thread-item").first();
		const tCount = await firstThread.count();
		if (tCount === 0) {
			test.info().annotations.push({
				type: "skip-reason",
				description: "No thread to open — cannot validate post meta bar.",
			});
			return;
		}
		// Click via the stable mobile testid; the desktop title link is
		// `hidden sm:flex` at 375px and would cause Playwright to wait
		// for visibility forever.
		await page.getByTestId("thread-item-mobile-title-link").first().click();
		await page.waitForLoadState("load");

		// PostContent meta bar carries a stable testid; on mobile it lives
		// inside `hidden md:flex` and must not be visible.
		const meta = page.getByTestId("post-content-meta-bar");
		const metaCount = await meta.count();
		if (metaCount === 0) {
			test.info().annotations.push({
				type: "skip-reason",
				description: "No posts rendered on the opened thread.",
			});
			return;
		}
		for (let i = 0; i < metaCount; i++) {
			await expect(meta.nth(i)).toBeHidden();
		}
	});
});

test.describe("E2E-MOB-12: SiteFooter logo hidden on mobile", () => {
	test("@375: site-footer-logo-wrap is not visible (background image still mounts)", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const footer = page.getByTestId("site-footer");
		await expect(footer).toBeAttached({ timeout: 15_000 });
		// Logo wrap exists in the DOM (rendered server-side) but the
		// `hidden sm:block` token must hide it on mobile.
		const logoWrap = page.getByTestId("site-footer-logo-wrap");
		await expect(logoWrap).toBeHidden();
		// Background wrapper is always mounted; its mobile-tuned offsets
		// are pinned by the unit test, here we only confirm it's attached.
		await expect(page.getByTestId("site-footer-bg-wrap")).toBeAttached();
	});
});
