// tests/e2e/functional-flows.spec.ts — E2E functional flow tests
// Ref: 04-application §4.9.2
//
// Tests that interactive features work end-to-end:
// - Sort controls change URL and reload data
// - Search returns results
// - Reply form submits and new reply appears in post list
// - Admin actions execute and produce observable state changes
//
// Uses loginAs() helper for tests that require authentication.

import { expect, test } from "@playwright/test";
import { loginAs } from "./auth-setup";

test.describe("Forum sort controls", () => {
	test("sort buttons update URL and page re-renders", async ({ page }) => {
		await page.goto("/forums/10");

		// Click "Newest" sort button
		const newestBtn = page.locator("button", { hasText: "Newest" });
		await expect(newestBtn).toBeVisible();
		await newestBtn.click();

		// URL should contain ?sort=newest
		await expect(page).toHaveURL(/sort=newest/);
		// Page still renders thread list (not an error page)
		await expect(page.locator("button", { hasText: "Newest" })).toBeVisible();
	});

	test("digest toggle updates URL", async ({ page }) => {
		await page.goto("/forums/10");

		const digestBtn = page.locator("button", { hasText: "Digest Only" });
		await expect(digestBtn).toBeVisible();
		await digestBtn.click();

		await expect(page).toHaveURL(/digest=true/);
	});
});

test.describe("Search interaction", () => {
	test("typing triggers API search and shows result count", async ({ page }) => {
		await page.goto("/search");
		const input = page.locator("input[placeholder*='Search']");
		await input.fill("test");

		// Wait for debounce (300ms) + response
		// Should show either "X results found" or "No results found"
		const resultText = page.locator("text=result").or(page.locator("text=No results"));
		await expect(resultText.first()).toBeVisible({ timeout: 5000 });
	});

	test("switching to author search changes placeholder", async ({ page }) => {
		await page.goto("/search");
		await page.click("button:has-text('By Author')");
		await expect(page.locator("input[placeholder*='author']")).toBeVisible();
	});
});

test.describe("Thread detail — reply submission", () => {
	test("logged-in user can submit reply and see it appear", async ({ page }) => {
		await loginAs(page, "admin");

		await page.goto("/threads/50001");
		await expect(page.locator("h2", { hasText: "Reply" })).toBeVisible();

		// Count existing posts before submitting
		const postCards = page.locator(".bg-secondary .prose");
		const countBefore = await postCards.count();

		// Type reply content with unique text
		const textarea = page.locator("textarea[placeholder*='reply']");
		await expect(textarea).toBeVisible();
		const replyText = `E2E test reply ${Date.now()}`;
		await textarea.fill(replyText);

		// Click submit
		const submitBtn = page.locator("button", { hasText: "Post Reply" });
		await expect(submitBtn).toBeEnabled();
		await submitBtn.click();

		// After router.refresh(), the textarea should be cleared
		await expect(textarea).toHaveValue("", { timeout: 10000 });

		// The new reply text should appear in the post list
		await expect(page.locator(".prose", { hasText: replyText })).toBeVisible({ timeout: 10000 });

		// Post count should have increased by 1
		await expect(postCards).toHaveCount(countBefore + 1, { timeout: 10000 });
	});
});

test.describe("Admin actions — logged in as admin", () => {
	test("admin can click Ban and user status changes to Banned", async ({ page }) => {
		await loginAs(page, "admin");

		await page.goto("/admin/users");
		await expect(page.locator("h2", { hasText: "User Management" })).toBeVisible();

		// Find the first row with a Ban button (non-banned user)
		const banBtn = page.locator("button", { hasText: "Ban" }).first();
		await expect(banBtn).toBeVisible({ timeout: 5000 });

		// Get the row containing this Ban button to track its state change
		const targetRow = banBtn.locator("xpath=ancestor::tr");
		// Verify the row does NOT have a "Banned" badge before clicking
		await expect(targetRow.locator("text=Banned")).not.toBeVisible();

		// Click Ban
		await banBtn.click();

		// After refresh, the same row should show:
		// 1. "Banned" status badge
		await expect(targetRow.locator("text=Banned")).toBeVisible({ timeout: 10000 });
		// 2. "Unban" button instead of "Ban"
		await expect(targetRow.locator("button", { hasText: "Unban" })).toBeVisible({
			timeout: 10000,
		});
	});

	test("admin can delete a thread and row count decreases", async ({ page }) => {
		await loginAs(page, "admin");

		await page.goto("/admin/content");
		await expect(page.locator("h2", { hasText: "Content Moderation" })).toBeVisible();

		// Count rows before delete
		const rows = page.locator("tbody tr");
		const countBefore = await rows.count();
		expect(countBefore).toBeGreaterThan(0);

		// Capture the subject text of the first thread to verify it disappears
		const firstRowSubject = await rows.first().locator("td").first().textContent();
		expect(firstRowSubject).toBeTruthy();

		// Click first Delete button and auto-accept the confirm dialog
		page.on("dialog", (dialog) => dialog.accept());
		const deleteBtn = page.locator("button", { hasText: "Delete" }).first();
		await deleteBtn.click();

		// After refresh: row count should decrease by 1
		await expect(rows).toHaveCount(countBefore - 1, { timeout: 10000 });

		// The specific thread subject should no longer appear in the first row
		// (it was either removed or replaced by the next thread)
		if (countBefore > 1) {
			const newFirstSubject = await rows.first().locator("td").first().textContent();
			expect(newFirstSubject).not.toBe(firstRowSubject);
		}
	});

	test("admin can toggle forum visibility and badge flips", async ({ page }) => {
		await loginAs(page, "admin");

		await page.goto("/admin/forums");
		await expect(page.locator("h2", { hasText: "Forum Management" })).toBeVisible();

		// Find the first toggle button and its containing context
		const toggleBtn = page.locator("button", { hasText: /^(Hide|Show)$/ }).first();
		await expect(toggleBtn).toBeVisible({ timeout: 5000 });
		const initialText = await toggleBtn.textContent();

		// Find the nearest status badge to verify it changes
		const parentContainer = toggleBtn.locator("xpath=ancestor::div[contains(@class,'flex')]");
		const initialBadge = initialText === "Hide" ? "Active" : "Hidden";
		await expect(parentContainer.locator(`text=${initialBadge}`)).toBeVisible();

		// Click toggle
		await toggleBtn.click();

		// After refresh, the button text should flip
		const expectedBtnText = initialText === "Hide" ? "Show" : "Hide";
		const expectedBadge = initialText === "Hide" ? "Hidden" : "Active";

		await expect(page.locator("button", { hasText: expectedBtnText }).first()).toBeVisible({
			timeout: 10000,
		});

		// The status badge should also flip
		await expect(parentContainer.locator(`text=${expectedBadge}`).first()).toBeVisible({
			timeout: 10000,
		});
	});
});
