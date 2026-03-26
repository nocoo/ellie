// tests/e2e/critical-path.spec.ts — E2E page reachability
// Ref: 04-application §4.9.2
//
// Current scope: Verifies that all critical pages render without errors.
// These are SHALLOW tests — they confirm pages load, not that full
// functionality works (e.g. we check login form renders, not that
// login actually authenticates).
//
// Phase 2 TODO: Deepen to test actual flows (login → session → create
// thread → see it in list → reply → see reply). This requires pages
// to be fully wired to ViewModels with real data flow.

import { expect, test } from "@playwright/test";

test.describe("Page reachability — forum", () => {
	test("homepage loads with forum layout", async ({ page }) => {
		await page.goto("/");
		await expect(page.locator("text=Ellie")).toBeVisible();
		await expect(page.locator("text=Home")).toBeVisible();
	});

	test("digest page loads", async ({ page }) => {
		await page.goto("/digest");
		await expect(page.locator("text=Digest")).toBeVisible();
		await expect(page.locator("text=Featured threads")).toBeVisible();
	});

	test("search page loads", async ({ page }) => {
		await page.goto("/search");
		await expect(page.locator("text=Search")).toBeVisible();
	});

	test("login page renders form fields", async ({ page }) => {
		await page.goto("/login");
		await expect(page.locator("text=Ellie")).toBeVisible();
		await expect(page.locator('input[id="username"]')).toBeVisible();
		await expect(page.locator('input[id="password"]')).toBeVisible();
	});

	test("login form disables submit when fields are empty", async ({ page }) => {
		await page.goto("/login");
		const submitButton = page.locator('button[type="submit"]');
		await expect(submitButton).toBeDisabled();
	});

	test("login form enables submit with input", async ({ page }) => {
		await page.goto("/login");
		await page.fill('input[id="username"]', "admin");
		await page.fill('input[id="password"]', "admin");
		const submitButton = page.locator('button[type="submit"]');
		await expect(submitButton).toBeEnabled();
	});

	test("forum thread list page loads", async ({ page }) => {
		await page.goto("/forums/10");
		await expect(page).toHaveURL(/\/forums\/10/);
	});

	test("thread detail page loads", async ({ page }) => {
		await page.goto("/threads/50001");
		await expect(page).toHaveURL(/\/threads\/50001/);
	});

	test("user profile page loads", async ({ page }) => {
		await page.goto("/users/1");
		await expect(page).toHaveURL(/\/users\/1/);
	});
});
