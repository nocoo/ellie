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

import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { TEST_WORKER_VARS } from "../../../scripts/lib/test-worker-vars";
import { ForumPage } from "../pages/forum.page";
import { HomePage } from "../pages/home.page";
import { expect, test } from "./fixtures";

const POPULATED_FORUM_ID = 114;

// Evidence screenshots live outside the repo tree (.herdr-brief is
// git-excluded) so the L3 run never dirties the working tree.
const SHOT_DIR = path.resolve(process.cwd(), ".herdr-brief/screens");

async function shot(page: Page, name: string): Promise<void> {
	await mkdir(SHOT_DIR, { recursive: true });
	await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: false });
}

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

	test("Given I open the homepage as anonymous at 375px, Then the TopBar stays compact, search remains usable, and the SiteFooter logo wrap is hidden", async ({
		page,
	}) => {
		// Mobile keeps the search entry while collapsing auxiliary decoration.
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		// Then: TopBar height ≤ 72px (h-14 is ~56px, slack for descenders).
		const topBar = page.locator('[data-testid="forum-top-bar"]');
		await expect(topBar).toBeVisible({ timeout: 15_000 });
		const box = await topBar.boundingBox();
		expect(box).not.toBeNull();
		if (box) expect(box.height).toBeLessThan(72);

		// Then: the mobile search field and its submit control remain reachable.
		await expect(page.getByRole("searchbox", { name: "搜索主题", exact: true })).toBeVisible();
		await expect(page.getByRole("button", { name: "提交搜索", exact: true })).toBeVisible();

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

	test("Given I am on a populated forum at 375px, Then activity counts are visible and the secondary new-post button is hidden", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		await expect(page.getByTestId("thread-item").first()).toBeVisible({ timeout: 15_000 });

		await expect(page.getByTestId("thread-row-stats-mobile").first()).toBeVisible();
		await expect(page.getByTestId("thread-row-stats-mobile").first()).toContainText("回复");
		await expect(page.getByTestId("thread-row-stats-mobile").first()).toContainText("浏览");

		// Then: ForumNewPostButton is mounted twice
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

		// Then: navigation is centered (x > 0) and capped at
		// the forum's 1280px content width.
		const navStrip = page.getByRole("navigation", { name: "论坛导航" });
		await expect(navStrip).toBeVisible({ timeout: 15_000 });
		const navBox = await navStrip.boundingBox();
		expect(navBox).not.toBeNull();
		if (navBox) {
			expect(navBox.x).toBeGreaterThan(0);
			expect(navBox.width).toBeLessThanOrEqual(1280 + 1);
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

	test("Given I open the homepage at 375px, Then the navigation leaves at least 8px of edge padding", async ({
		page,
	}) => {
		// Given: anonymous mobile viewport
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		// Then: navigation aligns with content cards (≥8px each side).
		const navStrip = page.getByRole("navigation", { name: "论坛导航" });
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
			expect(text).toMatch(/上次统计时活跃会员约\s+[\d,]+\s+人/);

			// Then: single-line height (text-sm 14px + leading-5 20px + py-2 ≈
			// 32px ceiling; wrap would push to ~40+).
			const height = await line.evaluate((el) => el.getBoundingClientRect().height);
			expect(height, `width=${width} appears wrapped (height=${height})`).toBeLessThan(32);
		}
	});

	// ────────────────────────────────────────────────────────────────────────
});

// ────────────────────────────────────────────────────────────────────────────
// Mobile UX polish regressions (brief 2026-10-29, requirements 1-5).
// Own describe block: the disposable fixtures promote e2etest to admin, so
// they must not leak into the pre-existing drift-guard scenarios above.
// ────────────────────────────────────────────────────────────────────────────
test.describe("Feature: Mobile UX Polish", () => {
	test.describe.configure({ mode: "serial" });
	test("Given the homepage at iPhone width, Then the theme-color metadata matches the computed header background under OS and stored-override themes, and the viewport declares safe-area coverage", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ colorScheme: "light" });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		await setStoredTheme(page, null);
		await page.reload();
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const light = await readThemeState(page);
		expect(light.isDark, "OS light without override must stay light").toBe(false);
		expect(light.viewportMeta).toContain("viewport-fit=cover");
		expect(light.viewportMeta).toContain("width=device-width");
		expect(light.appleStatusBar, "apple status bar style meta missing").not.toBe("");
		expect(light.safeAreaUsed, "no safe-area-inset handling in the stylesheet").toBe(true);
		expect(
			light.effectiveNorm,
			`theme-color "${light.effective}" !== header bg "${light.headerBg}"`,
		).toBe(light.headerBgNorm);
		await expect(page.locator("html")).toHaveCSS("background-color", "rgb(245, 247, 250)");
		await expect(page.locator("body")).toHaveCSS("background-color", "rgb(245, 247, 250)");
		await shot(page, "req1-theme-light");

		// Stored override (dark) must win over the OS (light) and repaint the
		// status bar color with the dark header background.
		await setStoredTheme(page, "dark");
		await page.reload();
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		const overridden = await readThemeState(page);
		expect(overridden.isDark, "stored dark override must beat OS light").toBe(true);
		expect(
			overridden.effectiveNorm,
			`theme-color "${overridden.effective}" !== dark header bg "${overridden.headerBg}"`,
		).toBe(overridden.headerBgNorm);
		expect(overridden.effectiveNorm).not.toBe(light.headerBgNorm);
		await expect(page.locator("html")).toHaveCSS("background-color", "rgb(18, 22, 28)");
		await expect(page.locator("body")).toHaveCSS("background-color", "rgb(18, 22, 28)");
		await shot(page, "req1-theme-stored-dark");

		// OS dark without an override resolves to the dark theme as well.
		await setStoredTheme(page, null);
		await page.emulateMedia({ colorScheme: "dark" });
		await page.reload();
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		const dark = await readThemeState(page);
		expect(dark.isDark, "OS dark must resolve to the dark theme").toBe(true);
		expect(
			dark.effectiveNorm,
			`theme-color "${dark.effective}" !== dark header bg "${dark.headerBg}"`,
		).toBe(dark.headerBgNorm);
		expect(dark.effectiveNorm).not.toBe(light.headerBgNorm);
		await expect(page.locator("html")).toHaveCSS("background-color", "rgb(18, 22, 28)");
		await expect(page.locator("body")).toHaveCSS("background-color", "rgb(18, 22, 28)");
		await shot(page, "req1-theme-os-dark");
	});

	test("Given the homepage at mobile and desktop widths, Then the section chips stay on one horizontally scrollable row, the check-in button is right-aligned, and the 分区 count label is gone", async ({
		page,
	}) => {
		for (const width of [390, 1280] as const) {
			await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
			await page.goto("/");
			await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

			expect(
				await page.getByText(/\d+\s*个分区/).count(),
				`width=${width}: the 分区 count label is still rendered`,
			).toBe(0);

			const sections = page.locator("[data-home-sections]");
			await expect(sections, `width=${width}: section nav missing`).toBeVisible({
				timeout: 15_000,
			});
			const chips = sections.locator('a[href^="#forum-group-"]');
			await expect(chips, `width=${width}: no section chips rendered`).not.toHaveCount(0);

			// One row only: every chip shares the same Y.
			const chipTops = await chips.evaluateAll((els: Element[]) =>
				els.map((el) => el.getBoundingClientRect().top),
			);
			expect(
				Math.max(...chipTops) - Math.min(...chipTops),
				`width=${width}: section chips wrapped onto multiple rows`,
			).toBeLessThanOrEqual(4);

			// The chip strip scrolls sideways instead of wrapping.
			const nav = await readNavState(page);
			expect(nav.chipWhiteSpace, `width=${width}: chips are not nowrap`).toBe("nowrap");
			expect(nav.scrollerFound, `width=${width}: no overflow-x scroller for the chips`).toBe(true);
			expect(["auto", "scroll"], `width=${width}: overflow-x=${nav.scrollerOverflowX}`).toContain(
				nav.scrollerOverflowX,
			);
			expect(
				nav.pageScrollWidth,
				`width=${width}: the page scrolls horizontally`,
			).toBeLessThanOrEqual(nav.innerWidth + 1);

			// The check-in button is the right-most element of the row.
			const checkin = sections.locator('a[href="/checkin"]');
			await expect(checkin, `width=${width}: check-in button missing`).toBeVisible({
				timeout: 15_000,
			});
			const checkinBox = await checkin.boundingBox();
			const scrollBox = await chips.first().locator("..").boundingBox();
			const navBox = await sections.boundingBox();
			expect(checkinBox).not.toBeNull();
			expect(scrollBox).not.toBeNull();
			expect(navBox).not.toBeNull();
			if (checkinBox && scrollBox && navBox) {
				expect(checkinBox.x).toBeGreaterThanOrEqual(scrollBox.x + scrollBox.width);
				expect(
					Math.abs(checkinBox.x + checkinBox.width - navBox.x - navBox.width),
				).toBeLessThanOrEqual(1);
			}
			await shot(page, `req2-sections-${width}`);
		}
	});

	test("Given the homepage at iPhone width, Then both showcases show exactly 5 of their 7 rows without an inner vertical scroller, and desktop keeps all 7 rows", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const sections = page.locator("section[aria-label]");
		await expect(sections, "expected exactly two showcase sections").toHaveCount(2);
		const labels = await sections.evaluateAll((els: Element[]) =>
			els.map((el) => el.getAttribute("aria-label") ?? ""),
		);
		expect(
			labels.some((l) => /精华/.test(l)),
			`labels=${labels}`,
		).toBe(true);
		expect(
			labels.some((l) => /最近/.test(l)),
			`labels=${labels}`,
		).toBe(true);

		for (let i = 0; i < 2; i++) {
			const items = sections.nth(i).locator('[data-testid="home-showcase-item"]');
			await expect(items, `${labels[i]}: showcase rows missing`).toHaveCount(7);
			const visible = await items.evaluateAll(
				(els: Element[]) => els.filter((el) => el.getClientRects().length > 0).length,
			);
			expect(visible, `${labels[i]}: ${visible} rows visible on mobile (expected 5)`).toBe(5);
			const box = await sections.nth(i).evaluate((el) => {
				let scroller: string | null = null;
				let node = el.parentElement;
				while (node && node !== document.body) {
					const cs = getComputedStyle(node);
					if (
						(cs.overflowY === "auto" || cs.overflowY === "scroll") &&
						node.scrollHeight > node.clientHeight + 2
					) {
						scroller = node.tagName.toLowerCase();
					}
					node = node.parentElement;
				}
				return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scroller };
			});
			expect(box.scroller, `${labels[i]}: an inner vertical scroller clips the list`).toBeNull();
			expect(box.scrollHeight, `${labels[i]}: content overflows its own box`).toBeLessThanOrEqual(
				box.clientHeight + 2,
			);
		}
		await shot(page, "req3-showcase-mobile");
		await sections.nth(1).scrollIntoViewIfNeeded();
		await shot(page, "req3-recent-mobile");

		// Desktop keeps the full list.
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.reload();
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		const desktopSections = page.locator("section[aria-label]");
		await expect(desktopSections).toHaveCount(2);
		for (let i = 0; i < 2; i++) {
			const items = desktopSections.nth(i).locator('[data-testid="home-showcase-item"]');
			await expect(items).toHaveCount(7);
			const visible = await items.evaluateAll(
				(els: Element[]) => els.filter((el) => el.getClientRects().length > 0).length,
			);
			expect(visible, "desktop must keep all 7 showcase rows").toBe(7);
		}
		await shot(page, "req3-showcase-desktop");
	});

	test("Given the homepage at iPhone width, Then wide-layout and grid-layout forum cards render the same mobile row structure and density", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });

		const cards = page.locator('[data-testid="forum-card"]');
		await expect(cards, "expected the disposable wide + grid forums").toHaveCount(
			WIDE_CHILDREN + GRID_CHILDREN,
		);
		const gridCards = page.locator('[data-testid="forum-card"]:has([data-testid="grid-row1"])');
		await expect(gridCards, "expected grid-layout cards").toHaveCount(GRID_CHILDREN);
		const wideCards = page.locator(
			`[data-testid="forum-card"]:not(:has([data-testid="grid-row1"]))`,
		);
		await expect(wideCards, "expected wide-layout cards").toHaveCount(WIDE_CHILDREN);

		const measure = async (locator: Locator) =>
			locator.evaluateAll((els: Element[]) =>
				els.map((el) => {
					const row = el.querySelector(
						'[data-testid="mobile-last-post-row"], [data-testid="mobile-last-post-empty"]',
					);
					return {
						height: el.getBoundingClientRect().height,
						rowVisible: row ? row.getClientRects().length > 0 : false,
					};
				}),
			);

		for (const [label, list] of [
			["wide", await measure(wideCards)],
			["grid", await measure(gridCards)],
		] as const) {
			for (const card of list) {
				expect(card.rowVisible, `${label} card row-2 is not visible at 390px`).toBe(true);
				expect(card.height, `${label} card height ${card.height}`).toBeGreaterThan(40);
				expect(card.height, `${label} card height ${card.height}`).toBeLessThan(170);
			}
		}

		const avg = (list: { height: number }[]) =>
			list.reduce((sum, c) => sum + c.height, 0) / list.length;
		const wideAvg = avg(await measure(wideCards));
		const gridAvg = avg(await measure(gridCards));
		expect(
			Math.abs(wideAvg - gridAvg),
			`wide avg ${wideAvg.toFixed(1)}px vs grid avg ${gridAvg.toFixed(1)}px`,
		).toBeLessThanOrEqual(1);
		await wideCards.first().scrollIntoViewIfNeeded();
		await shot(page, "req4-card-density");
	});

	test("Given I am logged in as a privileged user on a thread at iPhone width, Then the top and bottom thread toolbars and every post action bar stay on one line with the overflowing controls reachable by horizontal scroll", async ({
		page,
		baseURL,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await loginPrivileged(page, baseURL ?? "http://localhost:27031");
		await page.goto("/threads/662174");
		await expect(page.getByTestId("thread-toolbar").first()).toBeVisible({ timeout: 15_000 });

		const toolbars = page.getByTestId("thread-toolbar");
		await expect(toolbars, "expected a top and a bottom thread toolbar").toHaveCount(2);
		const bars = page.getByTestId("post-action-bar");
		expect(await bars.count(), "expected at least one post action bar").toBeGreaterThanOrEqual(1);

		let overflowing = 0;
		let overflowingPosts = 0;
		for (const [testid, count] of [
			["thread-toolbar", await toolbars.count()],
			["post-action-bar", await bars.count()],
		] as const) {
			for (let i = 0; i < count; i++) {
				const state = await inspectBar(page, testid, i);
				expect(state, `${testid} ${i} missing`).not.toBeNull();
				if (!state) continue;
				expect(state.flexWrap, `${testid} ${i} wraps`).toBe("nowrap");
				expect(state.whiteSpace, `${testid} ${i} is not nowrap`).toBe("nowrap");
				expect(["auto", "scroll"], `${testid} ${i} overflow-x=${state.overflowX}`).toContain(
					state.overflowX,
				);
				expect(
					state.controlSpread,
					`${testid} ${i} controls wrapped onto multiple lines`,
				).toBeLessThanOrEqual(4);
				expect(
					state.pageScrollWidth,
					`${testid} ${i}: the page scrolls horizontally instead of the bar`,
				).toBeLessThanOrEqual(state.innerWidth + 1);
				if (state.overflowing) {
					overflowing++;
					if (testid === "post-action-bar") overflowingPosts++;
					expect(
						state.lastControlReachable,
						`${testid} ${i}: overflowing controls are not reachable`,
					).toBe(true);
				}
			}
		}
		// The horizontal-scroll path must actually be exercised, not just
		// declared — otherwise the reachability branch above never runs.
		expect(
			overflowing,
			"no toolbar overflowed, so the scroll path was never exercised",
		).toBeGreaterThan(0);
		expect(
			overflowingPosts,
			"non-self post controls must exercise horizontal scrolling",
		).toBeGreaterThan(0);
		await shot(page, "req5-thread-toolbars");
		await bars.first().evaluate((element) => element.scrollIntoView({ block: "center" }));
		await shot(page, "req5-post-actions");
		await toolbars.last().scrollIntoViewIfNeeded();
		await shot(page, "req5-bottom-toolbar");
	});

	// ────────────────────────────────────────────────────────────────────────
	// Disposable L3 fixtures — created through the local admin API, promoted
	// e2etest to admin for the privileged session, and restored afterwards.
	// ────────────────────────────────────────────────────────────────────────

	const WORKER_URL = "http://localhost:8788";
	const ADMIN_KEY = TEST_WORKER_VARS.ADMIN_API_KEY;
	const E2E = { username: "e2etest", password: "e2etest123" };
	const E2E_USER_ID = 100;
	const WIDE_CHILDREN = 2;
	const GRID_CHILDREN = 11;
	const SHOWCASE_ROWS = 7;

	let promoted = false;
	const createdForums: number[] = [];
	const createdThreads: number[] = [];

	async function adminPost(
		request: APIRequestContext,
		path: string,
		data: unknown,
	): Promise<Record<string, unknown>> {
		const res = await request.post(`${WORKER_URL}${path}`, {
			headers: { "x-api-key": ADMIN_KEY },
			data,
		});
		expect(res.ok(), `admin POST ${path} failed: ${res.status()} ${await res.text()}`).toBe(true);
		const body = (await res.json()) as { data: Record<string, unknown> };
		return body.data;
	}

	async function adminPatch(
		request: APIRequestContext,
		path: string,
		data: unknown,
	): Promise<void> {
		const res = await request.patch(`${WORKER_URL}${path}`, {
			headers: { "x-api-key": ADMIN_KEY },
			data,
		});
		expect(res.ok(), `admin PATCH ${path} failed: ${res.status()} ${await res.text()}`).toBe(true);
	}

	async function createForum(
		request: APIRequestContext,
		name: string,
		parentId: number,
	): Promise<number> {
		const created = await adminPost(request, "/api/admin/forums", {
			name,
			type: parentId === 0 ? "group" : "forum",
			parentId,
			displayOrder: 900 + parentId,
		});
		const id = Number(created.id);
		expect(Number.isInteger(id), `forum ${name} created without an id`).toBe(true);
		createdForums.push(id);
		return id;
	}

	/** Fresh credentials login (bypasses the shared storageState cache). */
	async function loginPrivileged(page: Page, baseURL: string): Promise<void> {
		await page.context().clearCookies();
		const csrfRes = await page.request.get(`${baseURL}/api/auth/csrf`);
		expect(csrfRes.ok(), "csrf fetch failed").toBe(true);
		const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
		const loginRes = await page.request.post(`${baseURL}/api/auth/callback/credentials`, {
			form: {
				csrfToken,
				username: E2E.username,
				password: E2E.password,
				callbackUrl: `${baseURL}/`,
				json: "true",
			},
			headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
		});
		expect(loginRes.ok(), "privileged login failed").toBe(true);
		await page.goto("/");
	}

	test.beforeAll(async ({ browser, request }) => {
		// Guard: the disposable fixtures must only ever hit the local test stack.
		const workerHost = new URL(WORKER_URL).hostname;
		expect(
			["localhost", "127.0.0.1", "[::1]"],
			`refusing to touch non-loopback worker ${WORKER_URL}`,
		).toContain(workerHost);
		const liveRes = await request.get(`${WORKER_URL}/api/live`);
		expect(liveRes.ok(), "worker /api/live is not reachable").toBe(true);
		const live = (await liveRes.json()) as { environment?: string };
		expect(live.environment, "worker is not running with ENVIRONMENT=test").toBe("test");

		// Promote the seeded e2etest to admin so the thread/post toolbars render
		// their moderation controls (the overflow case under test).
		await adminPatch(request, `/api/admin/users/${E2E_USER_ID}`, { role: 2 });
		promoted = true;

		// Two disposable groups: one wide (few children), one grid (> 10).
		const wideGroup = await createForum(request, "移动端回归宽版组", 0);
		const gridGroup = await createForum(request, "移动端回归网格组", 0);
		let wideChild = 0;
		for (let i = 0; i < WIDE_CHILDREN; i++) {
			const id = await createForum(request, `移动端回归宽版子版${i}`, wideGroup);
			if (i === 0) wideChild = id;
		}
		for (let i = 0; i < GRID_CHILDREN; i++) {
			await createForum(request, `移动端回归网格子版${i}`, gridGroup);
		}

		// Real threads in a disposable forum give the showcases fresh rows
		// (the seeded threads are too old to count as recent activity).
		const context = await browser.newContext();
		const page = await context.newPage();
		await loginPrivileged(page, "http://localhost:27031");
		for (let i = 0; i < SHOWCASE_ROWS; i++) {
			const res = await page.request.post("http://localhost:27031/api/v1/threads", {
				headers: { origin: "http://localhost:27031" },
				data: {
					forumId: wideChild,
					subject: `移动端回归主题 ${i}`,
					content: "移动端体验回归用的真实主题内容，长度足够。",
				},
			});
			expect(res.ok(), `thread create failed: ${res.status()} ${await res.text()}`).toBe(true);
			const body = (await res.json()) as { data?: { id?: number } };
			const threadId = Number(body.data?.id);
			expect(Number.isInteger(threadId), "thread create returned no id").toBe(true);
			createdThreads.push(threadId);
			// Promote to 精华 so the digest showcase has rows as well.
			await adminPatch(request, `/api/admin/threads/${threadId}`, { digest: 1 });
		}
		await context.close();
	});

	test.afterAll(async ({ request }) => {
		if (!promoted) return;
		await adminPatch(request, `/api/admin/users/${E2E_USER_ID}`, { role: 0 });
		for (const [resource, ids] of [
			["threads", createdThreads],
			["forums", createdForums],
		] as const) {
			for (const id of ids.toReversed()) {
				const response = await request.delete(`${WORKER_URL}/api/admin/${resource}/${id}`, {
					headers: { "x-api-key": ADMIN_KEY },
				});
				expect(response.ok(), `cleanup ${resource}/${id} failed`).toBe(true);
			}
		}
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Page-side probes
// ────────────────────────────────────────────────────────────────────────────

async function setStoredTheme(page: Page, theme: "light" | "dark" | null): Promise<void> {
	await page.evaluate((value) => {
		try {
			if (value === null) localStorage.removeItem("theme");
			else localStorage.setItem("theme", value);
		} catch {
			/* storage unavailable */
		}
	}, theme);
}

interface ThemeState {
	effective: string;
	headerBg: string;
	headerBgNorm: string;
	effectiveNorm: string;
	isDark: boolean;
	viewportMeta: string;
	appleStatusBar: string;
	safeAreaUsed: boolean;
}

async function readThemeState(page: Page): Promise<ThemeState> {
	return page.evaluate(() => {
		const norm = (css: string): string => {
			const probe = document.createElement("span");
			probe.style.color = "";
			probe.style.color = css;
			if (!probe.style.color) return "";
			document.body.appendChild(probe);
			const computed = getComputedStyle(probe).color;
			probe.remove();
			return computed;
		};
		const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
		// The color iOS Safari paints in the status bar is the first
		// theme-color meta whose media query matches the OS.
		const effective =
			metas
				.find((m) => {
					const media = m.getAttribute("media");
					return !media || window.matchMedia(media).matches;
				})
				?.getAttribute("content") ?? "";
		const header = document.querySelector("header");
		const headerBg = header ? getComputedStyle(header).backgroundColor : "";
		let css = "";
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				for (const rule of Array.from(sheet.cssRules)) css += rule.cssText;
			} catch {
				/* cross-origin sheet */
			}
		}
		return {
			effective,
			headerBg,
			headerBgNorm: norm(headerBg),
			effectiveNorm: norm(effective),
			isDark: document.documentElement.classList.contains("dark"),
			viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
			appleStatusBar:
				document
					.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
					?.getAttribute("content") ?? "",
			safeAreaUsed: css.includes("safe-area-inset"),
		};
	});
}

interface NavState {
	chipWhiteSpace: string;
	scrollerFound: boolean;
	scrollerOverflowX: string;
	pageScrollWidth: number;
	innerWidth: number;
}

async function readNavState(page: Page): Promise<NavState> {
	return page.evaluate(() => {
		const el = document.querySelector("[data-home-sections]");
		const chip = el?.querySelector('a[href^="#forum-group-"]');
		let scroller: HTMLElement | null = null;
		let node: HTMLElement | null = chip?.parentElement ?? null;
		while (node && !scroller) {
			const cs = getComputedStyle(node);
			if (cs.overflowX === "auto" || cs.overflowX === "scroll") scroller = node;
			if (node === el) break;
			node = node.parentElement;
		}
		return {
			chipWhiteSpace: chip ? getComputedStyle(chip).whiteSpace : "",
			scrollerFound: scroller !== null,
			scrollerOverflowX: scroller ? getComputedStyle(scroller).overflowX : "",
			pageScrollWidth: document.documentElement.scrollWidth,
			innerWidth: window.innerWidth,
		};
	});
}

interface BarState {
	whiteSpace: string;
	flexWrap: string;
	overflowX: string;
	overflowing: boolean;
	controlSpread: number;
	lastControlReachable: boolean;
	pageScrollWidth: number;
	innerWidth: number;
}

async function inspectBar(page: Page, testid: string, index: number): Promise<BarState | null> {
	return page.evaluate(
		({ testid, index }) => {
			const el = document.querySelectorAll(`[data-testid="${testid}"]`)[index] as
				| HTMLElement
				| undefined;
			if (!el) return null;
			const cs = getComputedStyle(el);
			const rect = el.getBoundingClientRect();
			const controlTops = Array.from(el.querySelectorAll("button, a")).map(
				(c) => c.getBoundingClientRect().top,
			);
			const spread = controlTops.length ? Math.max(...controlTops) - Math.min(...controlTops) : 0;
			const overflowing = el.scrollWidth > el.clientWidth + 1;
			let lastControlReachable = true;
			if (overflowing) {
				el.scrollLeft = el.scrollWidth;
				const controls = Array.from(el.querySelectorAll("button, a"));
				const last = controls[controls.length - 1];
				if (last) {
					lastControlReachable = last.getBoundingClientRect().right <= rect.right + 1;
				}
				el.scrollLeft = 0;
			}
			return {
				whiteSpace: cs.whiteSpace,
				flexWrap: cs.flexWrap,
				overflowX: cs.overflowX,
				overflowing,
				controlSpread: spread,
				lastControlReachable,
				pageScrollWidth: document.documentElement.scrollWidth,
				innerWidth: window.innerWidth,
			};
		},
		{ testid, index },
	);
}
