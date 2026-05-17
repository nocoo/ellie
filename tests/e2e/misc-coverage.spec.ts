// tests/e2e/misc-coverage.spec.ts — E2E-MX Miscellaneous user-visible flows
//
// Stateless tests that cover small but visible bits of behaviour that the
// other specs don't touch directly. Kept as a single suite so we don't sprawl
// across too many one-off files.
//
//   • E2E-MX-01: search with an obscure query renders the empty-state copy
//   • E2E-MX-02: /me page exposes both account sections (#email + #avatar)
//   • E2E-MX-03: clicking the site logo on /forums/[id] returns to home
//   • E2E-MX-04: /digest page renders the digest hub heading + content

import { expect, test } from "./fixtures/base";

const POPULATED_FORUM_ID = 114;

test.describe("E2E-MX: Miscellaneous user-visible flows", () => {
	test("E2E-MX-01: search with no-match query shows 未找到相关结果", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		// A long high-entropy ascii query is virtually guaranteed not to
		// match any seeded thread title or body.
		const query = "zzzz-no-such-thread-xxx-9876543210";
		await page.goto(`/search?q=${encodeURIComponent(query)}`);

		const emptyMessage = page.getByText("未找到相关结果").first();
		await expect(emptyMessage).toBeVisible({ timeout: 20_000 });
	});

	test("E2E-MX-02: /me page exposes both #email and #avatar account sections", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.goto("/me");
		await page.waitForURL("**/me");

		// Page-object E2E-UJ-02 covers section#email; we extend by also
		// asserting section#avatar to lock in the broader account layout.
		const emailSection = page.locator("section#email");
		const avatarSection = page.locator("section#avatar");
		await expect(emailSection).toBeVisible({ timeout: 15_000 });
		await expect(avatarSection).toBeVisible({ timeout: 15_000 });
	});

	test("E2E-MX-03: clicking site logo on /forums/[id] returns to /", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// Logo is the first anchor with href="/" inside the page header.
		// Selectors stay broad so mobile/desktop layouts both match.
		const logo = page.locator('header a[href="/"], nav a[href="/"]').first();
		await expect(logo).toBeVisible({ timeout: 15_000 });

		await logo.click();
		await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
		expect(new URL(page.url()).pathname).toBe("/");
	});

	test("E2E-MX-04: /digest page renders heading + content", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		await page.goto("/digest");

		// h1 should be present (existing E2E-NV-05 only checks that the page
		// is reachable — extend with content assertions).
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

		// Either a digest list-item (link to a thread) is visible, or the
		// page falls back to an explicit empty state. Both are valid
		// outcomes depending on seed data.
		const indicator = page
			.locator('a[href^="/threads/"], :text("暂无内容"), :text("暂无精华")')
			.first();
		await expect(indicator).toBeVisible({ timeout: 15_000 });
	});
});
