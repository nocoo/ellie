// tests/e2e/redirect.spec.ts — E2E-RD Redirect & Security Tests
// Covers: #5 unauthenticated redirect stays same-origin (open-redirect fix)

import { expect, test } from "./fixtures/base";

test.describe("E2E-RD: Redirect Security", () => {
	/**
	 * E2E-RD-01: Unauthenticated Access Redirects to Login
	 * Given I am NOT logged in
	 * When I navigate to /messages (protected route)
	 * Then I should be redirected to /login
	 * And the URL should be on the same origin (not an external domain)
	 */
	test("E2E-RD-01: unauthenticated access to /messages redirects to /login", async ({ page }) => {
		// Navigate directly without logging in
		await page.goto("/messages");
		await page.waitForLoadState("networkidle");

		// Should end up on /login
		const url = new URL(page.url());
		expect(url.pathname).toBe("/login");

		// Origin must be same as base (localhost:27031)
		expect(url.origin).toContain("localhost");
	});

	/**
	 * E2E-RD-02: Redirect Preserves Return URL
	 * Given I am NOT logged in
	 * When I navigate to /messages
	 * Then the redirect should include ?redirect=/messages
	 */
	test("E2E-RD-02: redirect preserves return URL parameter", async ({ page }) => {
		await page.goto("/messages");
		await page.waitForLoadState("networkidle");

		const url = new URL(page.url());
		expect(url.pathname).toBe("/login");

		// Should have redirect parameter pointing back to /messages
		const redirect = url.searchParams.get("redirect");
		expect(redirect).toContain("/messages");
	});

	/**
	 * E2E-RD-03: Logged-in User Not Redirected From Protected Route
	 * Given I am logged in
	 * When I navigate to /messages
	 * Then I should stay on /messages (not redirected)
	 */
	test("E2E-RD-03: logged-in user accesses /messages without redirect", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		await page.goto("/messages");
		await page.waitForLoadState("networkidle");

		// Should be on /messages, not redirected
		expect(page.url()).toContain("/messages");
		expect(page.url()).not.toContain("/login");
	});
});
