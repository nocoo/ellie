// tests/e2e/navigation-extra.spec.ts — E2E-NX Extended navigation coverage.
//
// Complements the existing E2E-NV / E2E-PG / E2E-UJ specs by exercising:
//   • E2E-NX-01: forum page renders a breadcrumb link back to home
//   • E2E-NX-02: thread page exposes a link to its parent forum
//   • E2E-NX-03: clicking the second-page pagination link on a forum
//                updates ?page=2 (skips if seed has only 1 page)
//   • E2E-NX-04: header search box is also present on a forum page
//
// All four are stateless (read-only) and use the cached storageState fast
// path. Retries=1 in playwright.config absorbs the occasional dev-server
// jitter for these multi-navigation tests.

import { expect, test } from "./fixtures/base";

// Forum 114 is the populated test forum used by E2E-NV-02 — has enough
// threads for pagination assertions, and a real heading + breadcrumb.
const POPULATED_FORUM_ID = 114;
const THREAD_WITH_FORUM_LINK = 1;

test.describe("E2E-NX: Extended navigation coverage", () => {
	test("E2E-NX-01: forum page breadcrumb contains a link back to home", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// Breadcrumb root link → "/" should exist on the forum page header.
		// We scope to nav/header/breadcrumb regions to avoid matching arbitrary
		// home links in thread rows further down the page.
		const homeLink = page
			.locator('nav a[href="/"], [aria-label="Breadcrumb"] a[href="/"], header a[href="/"]')
			.first();
		await expect(homeLink).toBeVisible({ timeout: 15_000 });
	});

	test("E2E-NX-02: thread page exposes a link to its parent forum", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		await page.goto(`/threads/${THREAD_WITH_FORUM_LINK}`);

		// The thread layout renders a "版块" anchor below the title pointing
		// at /forums/<thread.forumId>. We don't care which forum — only that
		// SOME forum link exists and points back to /forums/<digits>.
		const forumLink = page.locator('a[href^="/forums/"]').first();
		await expect(forumLink).toBeVisible({ timeout: 15_000 });

		const href = await forumLink.getAttribute("href");
		expect(href).toMatch(/^\/forums\/\d+/);
	});

	test("E2E-NX-03: clicking page-2 link on a forum updates ?page=2", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// PagePagination renders `<a href="/forums/X?page=2">2</a>` once the
		// forum has ≥2 pages. If the seed shrinks, skip rather than fail.
		const pageTwoLink = page
			.locator(
				`a[href*="/forums/${POPULATED_FORUM_ID}?page=2"], a[href*="/forums/${POPULATED_FORUM_ID}?"][href*="page=2"]`,
			)
			.first();

		const visible = await pageTwoLink.isVisible({ timeout: 5_000 }).catch(() => false);
		// biome-ignore lint/suspicious/noSkippedTests: skip when seed data has fewer than 2 pages
		test.skip(!visible, "forum does not currently span 2 pages in test data");

		await pageTwoLink.click();
		await page.waitForURL(/\?(.*&)?page=2/);
		expect(page.url()).toMatch(/page=2/);
	});

	test("E2E-NX-04: header search box on a forum page navigates to /search", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// Same aria-labelled control E2E-SI-01 uses on /. The header is
		// shared across forum routes; use the first visible match
		// (mobile/desktop layouts both render one).
		const searchInput = page.locator('input[aria-label="搜索主题和用户"]').first();
		await expect(searchInput).toBeVisible({ timeout: 15_000 });

		await searchInput.fill("测试");
		await searchInput.press("Enter");

		await page.waitForURL(/\/search\?q=/);
		expect(page.url()).toContain("q=");
	});
});
