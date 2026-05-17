// tests/e2e/user-actions.spec.ts — E2E-UA User-action flows that round-trip
// across the auth/preferences boundary.
//
// Coverage added by this file:
//   • E2E-UA-01: theme choice persists across client-side navigation
//   • E2E-UA-02: logout from forum header lands on home with logged-out UI
//   • E2E-UA-03: login with ?redirect=/messages lands on /messages, not on /
//
// These are all stateless wrt the database (no thread/post creation), but
// E2E-UA-02 / E2E-UA-03 do exercise the real form-login flow rather than the
// cached storageState fast path. That's intentional — we want the form login
// itself under test, and the per-test cost (3–4s) is acceptable for two
// tests.

import { expect, test } from "./fixtures/base";
import { FORM } from "./fixtures/selectors";

test.describe("E2E-UA: User-action flows", () => {
	/**
	 * E2E-UA-01: Theme choice persists across navigation
	 *
	 * The theme toggle button reflects the active theme via its aria-label
	 * (Sun=Light mode / Moon=Dark mode / Monitor=System theme). After we cycle
	 * it once and navigate to a different route, the label should stay put —
	 * the choice is persisted in localStorage by useTheme.
	 */
	test("E2E-UA-01: theme choice persists across client-side navigation", async ({ page }) => {
		await page.goto("/login"); // /login renders the same header → same toggle

		const themeToggle = page
			.locator('button[aria-label*="mode"], button[aria-label*="theme"]')
			.first();
		await expect(themeToggle).toBeVisible();

		const initialLabel = await themeToggle.getAttribute("aria-label");
		// Cycle once → label must change.
		await themeToggle.click();
		await expect(themeToggle).not.toHaveAttribute("aria-label", initialLabel ?? "");
		const afterClickLabel = await themeToggle.getAttribute("aria-label");
		expect(afterClickLabel).toBeTruthy();
		expect(afterClickLabel).not.toBe(initialLabel);

		// Navigate to a different route (full page nav, not just push).
		await page.goto("/");

		// The new page's toggle must still carry the cycled label, proving the
		// theme is persisted (and not just held in component state).
		const themeToggleAfter = page
			.locator('button[aria-label*="mode"], button[aria-label*="theme"]')
			.first();
		await expect(themeToggleAfter).toHaveAttribute("aria-label", afterClickLabel ?? "", {
			timeout: 10_000,
		});

		// Cycle back to original so subsequent tests aren't affected by our
		// localStorage write (Playwright contexts are fresh per test, so this
		// is belt-and-suspenders, but it documents intent).
		await themeToggleAfter.click();
		await themeToggleAfter.click();
		await expect(themeToggleAfter).toHaveAttribute("aria-label", initialLabel ?? "");
	});

	/**
	 * E2E-UA-02: Logout from forum header
	 *
	 * Clicks the "退出登录" icon button in the header, then verifies that the
	 * page lands on / with logged-out UI (the header now shows a Login link
	 * instead of the logout button).
	 */
	test("E2E-UA-02: logout from header lands on / with logged-out UI", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		await page.goto("/");

		// Logout button is identified by its title attribute (icon-only).
		const logoutBtn = page.locator('button[title="退出登录"]').first();
		await expect(logoutBtn).toBeVisible({ timeout: 15_000 });

		await logoutBtn.click();

		// signOut({ callbackUrl: "/" }) returns to home. Wait until we're back
		// on / and the logged-out marker (a /login link) is in the header.
		await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });

		// Logged-out state: a "登录" link to /login appears in the header. The
		// logout button must be gone.
		const loginLink = page.locator('a[href="/login"]').first();
		await expect(loginLink).toBeVisible({ timeout: 15_000 });
		await expect(page.locator('button[title="退出登录"]')).toHaveCount(0);
	});

	/**
	 * E2E-UA-03: Login form preserves ?redirect and lands the user there.
	 *
	 * Goes through the real form login (not the storageState shortcut) so
	 * that NextAuth's redirect callback is exercised end-to-end.
	 */
	test("E2E-UA-03: login with ?redirect=/messages lands on /messages", async ({ page }) => {
		await page.goto("/login?redirect=/messages");

		await page.fill(FORM.usernameInput, "e2etest");
		await page.fill(FORM.passwordInput, "e2etest123");
		await page.click(FORM.submitButton);

		// Wait for navigation to /messages (not /). 30s mirrors loginAs.
		await page.waitForURL(/\/messages(\?|$)/, { timeout: 30_000 });

		// Sanity: messages page rendered (h1 or empty state visible).
		const indicator = page.locator('h1, :text("收信箱为空"), :text("发信箱为空")').first();
		await expect(indicator).toBeVisible({ timeout: 15_000 });
	});
});
