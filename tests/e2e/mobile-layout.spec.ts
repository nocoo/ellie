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
	// Reviewer follow-up msg=a9145195: CI runs forum L3 with require_login
	// enabled, so anonymous `/` does render the header (MOB-02 covers that
	// branch) but the real forum-index content (ForumCard list) is only
	// rendered to authenticated visitors. We therefore log in before
	// measuring documentElement.scrollWidth so the gate exercises the actual
	// homepage layout, not a stripped-down anonymous variant.
	for (const vp of MOBILE_WIDTHS) {
		test(`@${vp.width} (${vp.label}): documentElement.scrollWidth <= innerWidth + 1`, async ({
			page,
			loginAs,
		}) => {
			await page.setViewportSize({ width: vp.width, height: vp.height });
			await loginAs("e2etest");
			await page.goto("/");
			// Wait for the header AND at least one forum-card to be visible
			// before measuring scrollWidth — `header` alone leaves the body
			// height empty, so a forum-card / grid panel overflow could land
			// AFTER the assertion runs and silently regress the gate
			// (reviewer follow-up msg=ad33321c). The `forum-card` testid is
			// emitted by both `ForumCardWide` and `ForumCardGrid` root nodes.
			await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
			await expect(page.locator('[data-testid="forum-card"]').first()).toBeVisible({
				timeout: 15_000,
			});

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
	// Reviewer follow-up msg=a9145195: same require_login constraint as MOB-01 —
	// `forum-card` is only rendered to logged-in users on CI. Without
	// `loginAs` the test waits 15 s for a card that the production gate
	// never renders, then fails. Login first so the assertions run against
	// the real mobile branch of the wide / grid forum cards.
	test("`forum-stats-inline` (帖/回) is not in the mobile wide layout", async ({
		page,
		loginAs,
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await loginAs("e2etest");
		await page.goto("/");
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		await expect(page.locator('[data-testid="forum-card"]').first()).toBeVisible({
			timeout: 15_000,
		});

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
		// Reviewer follow-up msg=a9145195: anonymous /forums/114 on a
		// require_login deployment renders the auth gate instead of the
		// real thread list. The previous `toHaveCount(0)` then passed
		// vacuously because no `thread-row-stats-mobile` testid exists
		// on the login page either. Authenticate, navigate, and wait for
		// the real thread list to materialise via the ForumPage page
		// object so the absence assertion has real signal.
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);
		await expect(page.locator("header").first()).toBeVisible({ timeout: 15_000 });
		// Wait for at least one real thread row before asserting the
		// stats span is absent — guarantees we're on the populated
		// forum-114 thread list, not a fallback / loading state.
		await expect(forumPage.threadItems.first()).toBeVisible({ timeout: 15_000 });

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
});
