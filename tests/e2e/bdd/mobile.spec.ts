// tests/e2e/bdd/mobile.spec.ts — Feature: Mobile Layout Drift Guards (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 3.2), §5.3 (合并表)
//
// Refactors the legacy mobile-layout spec (13 describe blocks, 20 tests
// counting per-viewport variants) into 12 BDD scenarios:
//   - 3 viewport-parameterized scenarios that loop their own widths
//     internally (MOB-01 across 4 iPhone widths; MOB-03 + MOB-13 across
//     320 / 375)
//   - 3 setup-shared merges (anonymous / @375 hide-on-mobile assertions;
//     populated forum 114 @375 hide-on-mobile assertions; thread detail
//     @375 hide-on-mobile assertions)
// Traceability map lives in the commit body.
//
// Doc count drift: docs/23 §5.3 lists mobile as 15 legacy tests; the
// actual file carries 20 (13 describe blocks with per-viewport loops in
// MOB-01 / MOB-03 / MOB-13). Source of truth is the spec → 20 → 12 BDD
// scenarios. Reconcile in task #12.
//
// Runs under the `mobile` Playwright project, which pins iPhone 14 base
// (390×844) + chromium browser. Each scenario calls page.setViewportSize
// to land at the specific width under test.

import { ForumPage } from "../pages/forum.page";
import { HomePage } from "../pages/home.page";
import { expect, test } from "./fixtures";

const POPULATED_FORUM_ID = 114;

// Reviewer-required viewport widths (freeze msg=8b90cb85).
const MOBILE_WIDTHS = [
	{ width: 320, height: 568, label: "iPhone SE 1st gen" },
	{ width: 375, height: 667, label: "iPhone SE 2nd/3rd gen" },
	{ width: 390, height: 844, label: "iPhone 14" },
	{ width: 430, height: 932, label: "iPhone 14 Pro Max" },
] as const;

test.describe("Feature: Mobile Layout Drift Guards", () => {
	test("Given I am logged in on the homepage across iPhone widths (320 / 375 / 390 / 430), Then the document never overflows the viewport horizontally", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user (homepage gate). We collapse MOB-01's 4
		// per-viewport tests into one parameterized scenario because all 4
		// exercise the same invariant (scrollWidth <= innerWidth + 1) — the
		// only real product question is "does the body stay within the
		// viewport at every iPhone width?", which one scenario answers as
		// well as four.
		await loginAs("e2etest");
		const homePage = new HomePage(page);

		for (const vp of MOBILE_WIDTHS) {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await homePage.goto();
			await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
			expect(await homePage.isLoaded()).toBe(true);
			await expect(homePage.digestShowcase).toBeVisible({ timeout: 15_000 });

			const overflow = await page.evaluate(() => ({
				scroll: document.documentElement.scrollWidth,
				inner: window.innerWidth,
			}));
			// Reviewer's exact invariant: 1px rounding slack.
			expect(
				overflow.scroll,
				`width=${vp.width} (${vp.label}) overflows: scroll=${overflow.scroll} inner=${overflow.inner}`,
			).toBeLessThanOrEqual(overflow.inner + 1);
		}
	});

	test("Given I open the homepage as anonymous at 375px, Then the TopBar collapses to h-14, the search-stats bar is hidden, and the SiteFooter logo wrap is hidden", async ({
		page,
	}) => {
		// Given: anonymous mobile viewport. Merges MOB-02-A (TopBar h-14 +
		// SearchStatsBar hidden) with MOB-12 (SiteFooter logo wrap hidden)
		// because both assert hide-on-mobile invariants against the same /
		// anonymous landing — splitting them would re-pay the goto + header
		// wait for two strict-CSS assertions.
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		// Then: TopBar height ≤ 72px (h-14 is ~56px, slack for descenders).
		const topBar = page.locator('[data-testid="forum-top-bar"]');
		await expect(topBar).toBeVisible({ timeout: 15_000 });
		const box = await topBar.boundingBox();
		expect(box).not.toBeNull();
		if (box) expect(box.height).toBeLessThan(72);

		// Then: SearchStatsBar (hidden sm:block) is not visible.
		await expect(page.locator('[data-testid="forum-search-stats-bar"]')).toBeHidden();

		// Then: SiteFooter logo wrap (hidden sm:block) is not visible, but
		// the footer itself + background wrap are mounted.
		await expect(page.getByTestId("site-footer")).toBeAttached({ timeout: 15_000 });
		await expect(page.getByTestId("site-footer-logo-wrap")).toBeHidden();
		await expect(page.getByTestId("site-footer-bg-wrap")).toBeAttached();
	});

	test("Given I open the homepage at 375px, Then the nav-bar links sit on a single line (bar may scroll horizontally, body must not)", async ({
		page,
	}) => {
		// Given: anonymous mobile viewport
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");

		const nav = page.locator('[data-testid="forum-nav-bar"]');
		await expect(nav).toBeVisible({ timeout: 15_000 });

		// Then: every nav-link shares the same Y (within 4px slack).
		const tops = await nav
			.locator('[data-testid="forum-nav-link"]')
			.evaluateAll((els: Element[]) =>
				els.map((el) => (el as HTMLElement).getBoundingClientRect().top),
			);
		expect(tops.length).toBeGreaterThan(0);
		const minTop = Math.min(...tops);
		const maxTop = Math.max(...tops);
		expect(maxTop - minTop).toBeLessThanOrEqual(4);

		// Then: overflow-x must be auto or scroll — the bar may scroll
		// horizontally per reviewer freeze msg=8b90cb85.
		const overflowX = await nav.evaluate(
			(el) => window.getComputedStyle(el as HTMLElement).overflowX,
		);
		expect(["auto", "scroll"]).toContain(overflowX);
	});

	test("Given I am logged in on the homepage at 320 / 375, Then ForumCard surfaces a 2-line layout with Row 2 visible, no horizontal scroll, and inline 帖/回 stats hidden", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user. Collapses MOB-03's 2-viewport loop
		// because both widths assert the same Row-2 contract.
		await loginAs("e2etest");
		const homePage = new HomePage(page);

		for (const width of [320, 375] as const) {
			await page.setViewportSize({ width, height: 720 });
			await homePage.goto();
			await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
			expect(await homePage.isLoaded()).toBe(true);

			const card = page.locator('[data-testid="forum-card"]').first();
			const hasCard = (await card.count()) > 0;
			if (!hasCard) {
				// Data-conditional skip — empty forum tree on L3 backend.
				test.info().annotations.push({
					type: "skip-reason",
					description: `width=${width}: no forum-card rendered (empty forum tree).`,
				});
				continue;
			}
			await expect(card).toBeVisible({ timeout: 15_000 });

			// Then: page-level invariant — no horizontal scroll.
			const overflowing = await page.evaluate(
				() => document.documentElement.scrollWidth > window.innerWidth,
			);
			expect(overflowing, `width=${width} overflows`).toBe(false);

			// Then: inline stats span moved off Row 1 (hidden via class).
			const inlineStats = page.getByTestId("forum-stats-inline");
			const statsCount = await inlineStats.count();
			for (let i = 0; i < statsCount; i++) {
				await expect(inlineStats.nth(i)).toBeHidden();
			}

			// Then: Row 2 surfaces either populated row or empty placeholder
			// (both keep the card at exactly 2 lines).
			const rowOrEmpty = page
				.locator('[data-testid="mobile-last-post-row"], [data-testid="mobile-last-post-empty"]')
				.first();
			await expect(rowOrEmpty).toBeVisible({ timeout: 5_000 });

			// Then: when populated, title + date stay single-line (height < 26px).
			const populatedRow = page.getByTestId("mobile-last-post-row").first();
			if ((await populatedRow.count()) > 0 && (await populatedRow.isVisible())) {
				const title = populatedRow.getByTestId("mobile-last-thread-link");
				const date = populatedRow.getByTestId("mobile-last-post-date");
				await expect(title).toBeVisible();
				await expect(date).toBeVisible();
				const titleHeight = await title.evaluate((el) => el.getBoundingClientRect().height);
				expect(titleHeight).toBeLessThan(26);
				const dateHeight = await date.evaluate((el) => el.getBoundingClientRect().height);
				expect(dateHeight).toBeLessThan(26);
			}
		}
	});

	test("Given I am on a populated forum at 375px, Then the mobile thread row hides 阅读/回复/推荐数 and the forum-new-post button is hidden", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on the populated forum at 375px. Merges
		// MOB-04 (thread-row-stats-mobile absent) with MOB-08 (new-post-button
		// hidden) because both load the same forum 114 page at 375px and
		// assert hide-on-mobile invariants — splitting would re-pay the
		// loginAs + goto + thread-item-render wait.
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("thread-item").first()).toBeVisible({ timeout: 15_000 });

		// Then: ThreadRowStats mobile variant must not be rendered at all
		// (count===0 is stricter than text-content regex against drift).
		await expect(page.getByTestId("thread-row-stats-mobile")).toHaveCount(0);

		// Then: ForumNewPostButton (hidden sm:inline-block) is mounted twice
		// (top + bottom toolbars); both copies must be CSS-hidden. Existence-
		// conditional because group/read-only forums skip the button.
		const button = page.getByTestId("forum-new-post-button");
		const count = await button.count();
		if (count === 0) {
			test.info().annotations.push({
				type: "skip-reason",
				description: "Populated forum rendered without a new-post-button (likely isGroup forum).",
			});
		} else {
			for (let i = 0; i < count; i++) {
				await expect(button.nth(i)).toBeHidden();
			}
		}
	});

	test("Given I open the homepage at 1280px desktop width, Then the search-stats bar is visible", async ({
		page,
	}) => {
		// Given: desktop viewport — sanity check that mobile-only fixes
		// haven't accidentally hidden the desktop branch.
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		// Then: SearchStatsBar (hidden sm:block) is visible at ≥sm.
		await expect(page.getByTestId("forum-search-stats-bar")).toBeVisible();
	});

	test("Given I am logged in on a populated forum at 1280px, Then the footer logo, nav-bar bbox, PostContent meta bar, and new-post button remain visible", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on the populated forum at desktop width.
		// Reviewer wave-2 PC-not-regressed gate (msg=5a91dfd3) — each
		// assertion has a mobile counterpart elsewhere in this feature; this
		// scenario proves the desktop branch is intact.
		await page.setViewportSize({ width: 1280, height: 800 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		// Then: NavBar gradient strip is centered (x > 0) and capped at
		// content-max-width 1200px.
		const navStrip = page.locator(".nav-gradient").first();
		await expect(navStrip).toBeVisible({ timeout: 15_000 });
		const navBox = await navStrip.boundingBox();
		expect(navBox).not.toBeNull();
		if (navBox) {
			expect(navBox.x).toBeGreaterThan(0);
			expect(navBox.width).toBeLessThanOrEqual(1200 + 1);
		}

		// Then: new-post button visible at ≥sm (existence-conditional).
		const newPostBtn = page.getByTestId("forum-new-post-button");
		const newPostCount = await newPostBtn.count();
		if (newPostCount > 0) {
			await expect(newPostBtn.first()).toBeVisible({ timeout: 15_000 });
		} else {
			test.info().annotations.push({
				type: "skip-reason",
				description: "Populated forum has no new-post button (likely group/read-only).",
			});
		}

		// Then: opening the first thread surfaces a visible PostContent meta bar.
		const firstThread = page.getByTestId("thread-item").first();
		const tCount = await firstThread.count();
		if (tCount > 0) {
			await firstThread.locator('a[href^="/threads/"]').first().click();
			await page.waitForLoadState("load");
			const meta = page.getByTestId("post-content-meta-bar");
			const metaCount = await meta.count();
			if (metaCount > 0) {
				await expect(meta.first()).toBeVisible({ timeout: 15_000 });
			} else {
				test.info().annotations.push({
					type: "skip-reason",
					description: "Opened thread has no posts — PostContent meta gate skipped.",
				});
			}
		} else {
			test.info().annotations.push({
				type: "skip-reason",
				description: "Populated forum has no threads — PostContent meta gate skipped.",
			});
		}

		// Then: footer logo wrap (hidden sm:block) is visible at ≥sm.
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		await expect(page.getByTestId("site-footer-logo-wrap")).toBeVisible();
	});

	test("Given I open the homepage at 375px, Then the nav-gradient strip leaves at least 8px of edge padding (no edge-to-edge layout)", async ({
		page,
	}) => {
		// Given: anonymous mobile viewport
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		// Then: nav-gradient must align with content cards (≥8px each side).
		const navStrip = page.locator(".nav-gradient").first();
		await expect(navStrip).toBeVisible({ timeout: 15_000 });
		const box = await navStrip.boundingBox();
		expect(box).not.toBeNull();
		if (!box) return;
		expect(box.x).toBeGreaterThanOrEqual(8);
		expect(box.width).toBeLessThanOrEqual(375 - 8);
	});

	test("Given I am on the populated forum at 375px, Then any rendered 推荐主题 author/reply meta spans are hidden", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on the populated forum at 375px
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const meta = page.getByTestId("forum-recommended-meta");
		const metaCount = await meta.count();
		if (metaCount === 0) {
			// Data-conditional skip — recommended-thread section may be empty.
			test.info().annotations.push({
				type: "skip-reason",
				description: "No recommended threads on the populated forum.",
			});
			return;
		}
		for (let i = 0; i < metaCount; i++) {
			await expect(meta.nth(i)).toBeHidden();
		}
	});

	test("Given I am on the populated forum at 375px, Then the ThreadItem mobile avatar link is visible and shares its Y coordinate with the username row", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on the populated forum at 375px
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

		// Then: avatar's parent flex row siblings share the same Y (8px slack).
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

	test("Given I open a thread on a populated forum at 375px, Then breadcrumb-segment-mobile-hidden tokens are CSS-hidden and the PostContent meta bar is hidden", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on the populated forum at 375px. Merges
		// MOB-10 (breadcrumb collapse) with MOB-11 (PostContent meta hidden)
		// because both open the *same* first thread from forum 114 and
		// assert hide-on-mobile invariants on the resulting thread-detail
		// page — splitting them would re-pay the forum goto + mobile-title
		// click + load wait.
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const firstThread = page.getByTestId("thread-item").first();
		const threadCount = await firstThread.count();
		if (threadCount === 0) {
			test.info().annotations.push({
				type: "skip-reason",
				description: "No threads on the populated forum — thread-detail gates skipped.",
			});
			return;
		}

		// When: click via the stable mobile testid. The desktop title link is
		// `hidden sm:flex` at 375px, so `.first()` against a[href^="/threads/"]
		// would resolve to the invisible desktop branch and time out.
		await page.getByTestId("thread-item-mobile-title-link").first().click();
		await page.waitForLoadState("load");

		// Then: breadcrumb is rendered, hidden-segment tokens are CSS-hidden.
		await expect(page.getByTestId("breadcrumb-segment").first()).toBeVisible({
			timeout: 15_000,
		});
		const hidden = page.getByTestId("breadcrumb-segment-mobile-hidden");
		const hiddenCount = await hidden.count();
		// Shallow chains (home → forum → thread) may legitimately render 0
		// mobile-hidden segments; the contract is "if present, they must be
		// CSS-hidden", not "≥1 must be present".
		for (let i = 0; i < hiddenCount; i++) {
			await expect(hidden.nth(i)).toBeHidden();
		}

		// Then: PostContent meta bar (hidden md:flex) is not visible on mobile.
		const meta = page.getByTestId("post-content-meta-bar");
		const metaCount = await meta.count();
		if (metaCount === 0) {
			test.info().annotations.push({
				type: "skip-reason",
				description: "No posts rendered on the opened thread — PostContent meta gate skipped.",
			});
		} else {
			for (let i = 0; i < metaCount; i++) {
				await expect(meta.nth(i)).toBeHidden();
			}
		}
	});

	test("Given I am logged in on the homepage at 320 / 375, Then the online-stats line stays single-line and drops the 在线会员 prefix", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user. Collapses MOB-13's 2-viewport loop —
		// both widths assert the same single-line contract.
		await loginAs("e2etest");
		const homePage = new HomePage(page);

		for (const width of [320, 375] as const) {
			await page.setViewportSize({ width, height: 720 });
			await homePage.goto();
			await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
			expect(await homePage.isLoaded()).toBe(true);

			const line = page.getByTestId("online-stats-line");
			await expect(line).toBeVisible({ timeout: 10_000 });

			// Then: prefix dropped.
			const text = (await line.textContent())?.trim() ?? "";
			expect(text.startsWith("在线会员"), `width=${width} still has prefix`).toBe(false);
			// Then: numeric payload survives.
			expect(text).toMatch(/人在线/);

			// Then: single-line height (text-sm 14px + leading-5 20px + py-2 ≈
			// 32px ceiling; wrap would push to ~40+).
			const height = await line.evaluate((el) => el.getBoundingClientRect().height);
			expect(height, `width=${width} appears wrapped (height=${height})`).toBeLessThan(32);
		}
	});
});
