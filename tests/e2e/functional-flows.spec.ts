// tests/e2e/functional-flows.spec.ts — E2E functional flow tests
// Ref: 04-application §4.9.2
//
// Tests that interactive features work end-to-end, not just that pages load.
// Covers sort controls, search, reply form, and admin actions.

import { expect, test } from "@playwright/test";

test.describe("Forum sort controls", () => {
	test("sort buttons update URL params", async ({ page }) => {
		await page.goto("/forums/10");

		// Click "Newest" sort button
		const newestBtn = page.locator("button", { hasText: "Newest" });
		await expect(newestBtn).toBeVisible();
		await newestBtn.click();

		// URL should now contain ?sort=newest
		await expect(page).toHaveURL(/sort=newest/);
	});

	test("digest toggle updates URL params", async ({ page }) => {
		await page.goto("/forums/10");

		// Click "Digest Only" button
		const digestBtn = page.locator("button", { hasText: "Digest Only" });
		await expect(digestBtn).toBeVisible();
		await digestBtn.click();

		// URL should now contain ?digest=true
		await expect(page).toHaveURL(/digest=true/);
	});

	test("forum page shows New Thread link", async ({ page }) => {
		await page.goto("/forums/10");
		const newThreadLink = page.locator("a", { hasText: "New Thread" });
		await expect(newThreadLink).toBeVisible();
		await expect(newThreadLink).toHaveAttribute("href", /threads\/new\?forumId=10/);
	});
});

test.describe("Search interaction", () => {
	test("search page has input and type buttons", async ({ page }) => {
		await page.goto("/search");
		await expect(page.locator("input[placeholder*='Search']")).toBeVisible();
		await expect(page.locator("button", { hasText: "By Title" })).toBeVisible();
		await expect(page.locator("button", { hasText: "By Author" })).toBeVisible();
	});

	test("typing in search shows results or empty state", async ({ page }) => {
		await page.goto("/search");
		const input = page.locator("input[placeholder*='Search']");
		await input.fill("test");

		// Wait for debounce + API response (300ms debounce + network)
		await page.waitForTimeout(1000);

		// Should show either results or "No results found"
		const resultOrEmpty = page.locator("text=result").or(page.locator("text=No results"));
		await expect(resultOrEmpty.first()).toBeVisible({ timeout: 5000 });
	});
});

test.describe("Thread detail — reply form", () => {
	test("thread page shows reply section", async ({ page }) => {
		await page.goto("/threads/50001");
		await expect(page.locator("text=Reply")).toBeVisible();
	});

	test("thread page shows reply textarea", async ({ page }) => {
		await page.goto("/threads/50001");
		const textarea = page.locator("textarea[placeholder*='reply']");
		await expect(textarea).toBeVisible();
	});

	test("thread page shows Post Reply button", async ({ page }) => {
		await page.goto("/threads/50001");
		const submitBtn = page.locator("button", { hasText: "Post Reply" });
		await expect(submitBtn).toBeVisible();
	});
});

test.describe("Admin pages — action buttons", () => {
	test("admin users page has Ban buttons", async ({ page }) => {
		await page.goto("/admin/users");
		// Should have at least one action button
		const actionBtn = page.locator("button", { hasText: /Ban|Unban/ });
		await expect(actionBtn.first()).toBeVisible({ timeout: 5000 });
	});

	test("admin content page has Delete buttons", async ({ page }) => {
		await page.goto("/admin/content");
		const deleteBtn = page.locator("button", { hasText: "Delete" });
		await expect(deleteBtn.first()).toBeVisible({ timeout: 5000 });
	});

	test("admin forums page has Show/Hide buttons", async ({ page }) => {
		await page.goto("/admin/forums");
		const toggleBtn = page.locator("button", { hasText: /Show|Hide/ });
		await expect(toggleBtn.first()).toBeVisible({ timeout: 5000 });
	});
});
