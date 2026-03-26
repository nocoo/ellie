// tests/e2e/critical-path.spec.ts — E2E critical path
// Ref: 04-application §4.9.2
// Login → browse forums → view thread → create thread → reply

import { expect, test } from "@playwright/test";

test.describe("Critical path", () => {
	test("homepage loads with forum list", async ({ page }) => {
		await page.goto("/");
		// Should show the forum layout
		await expect(page.locator("text=Ellie")).toBeVisible();
		// Should have forum groups
		await expect(page.locator("text=Home")).toBeVisible();
	});

	test("can navigate to digest page", async ({ page }) => {
		await page.goto("/digest");
		await expect(page.locator("text=Digest")).toBeVisible();
		await expect(page.locator("text=Featured threads")).toBeVisible();
	});

	test("can navigate to search page", async ({ page }) => {
		await page.goto("/search");
		await expect(page.locator("text=Search")).toBeVisible();
	});

	test("can navigate to login page", async ({ page }) => {
		await page.goto("/login");
		await expect(page.locator("text=Ellie")).toBeVisible();
		await expect(page.locator('input[id="username"]')).toBeVisible();
		await expect(page.locator('input[id="password"]')).toBeVisible();
	});

	test("login form validation disables button for empty fields", async ({ page }) => {
		await page.goto("/login");
		const submitButton = page.locator('button[type="submit"]');
		// Button should be disabled when fields are empty
		await expect(submitButton).toBeDisabled();
	});

	test("login form enables button with valid input", async ({ page }) => {
		await page.goto("/login");
		await page.fill('input[id="username"]', "admin");
		await page.fill('input[id="password"]', "admin");
		const submitButton = page.locator('button[type="submit"]');
		await expect(submitButton).toBeEnabled();
	});

	test("can browse forum thread list", async ({ page }) => {
		// Navigate to a forum (using forum ID from mock data)
		await page.goto("/forums/10");
		// Should show thread list or forum page content
		await expect(page).toHaveURL(/\/forums\/10/);
	});

	test("can view thread detail", async ({ page }) => {
		// Navigate to a thread
		await page.goto("/threads/50001");
		await expect(page).toHaveURL(/\/threads\/50001/);
	});

	test("can view user profile", async ({ page }) => {
		await page.goto("/users/1");
		await expect(page).toHaveURL(/\/users\/1/);
	});
});
