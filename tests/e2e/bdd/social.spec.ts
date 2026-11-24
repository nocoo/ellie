// tests/e2e/bdd/social.spec.ts — Feature: Social & User Journey (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 2.2), §5.3 (合并表)
//
// Merges 3 legacy specs (message + user-actions + user-journey, 8 tests) into
// tests/e2e/bdd/social.spec.ts. The former `skipOnCI` real-form login
// scenario (UA-03) is now `test.skip` — driving the real /login form means
// fighting Cap's anti-automation defences (see auth.spec.ts header for the
// full rationale). NextAuth's redirect-callback correctness is instead
// covered by unit tests against apps/web/src/lib/safe-redirect.ts and
// apps/web/tests/unit/auth.test.ts. Runs under the `stateful` project
// because UA-02 mutates the browser session.

import { MessagePage } from "../pages/message.page";
import { expect, test } from "./fixtures";

const PROFILE_USER_ID = 64495;

test.describe("Feature: Social & User Journey", () => {
	test("Given I am logged in, When I open /messages, Then the 站内信 heading renders, an inbox or empty-state surfaces, and clicking 写站内信 opens the compose dialog", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");
		const messagePage = new MessagePage(page);

		// When: open /messages
		await messagePage.goto();

		// Then: 站内信 heading
		await expect(messagePage.heading).toContainText("站内信");

		// Then: inbox list or explicit empty-state — both prove the /messages
		// data round-trip succeeded.
		const hasMessages = await messagePage.messageItems.first().isVisible();
		const hasEmpty = await messagePage.emptyState.isVisible();
		expect(hasMessages || hasEmpty).toBe(true);

		// When: click 写站内信
		await messagePage.composeButton.click();

		// Then: compose dialog opens
		await expect(messagePage.composeDialog).toBeVisible();
	});

	test("Given I am logged in on /, When I click the header 退出登录 button, Then I land on / with logged-out UI (Login link visible, logout button gone)", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on /
		await loginAs("e2etest");
		await page.goto("/");

		// When: click the icon-only logout button by its accessible name
		const logoutBtn = page.getByRole("button", { name: "退出登录", exact: true });
		await expect(logoutBtn).toBeVisible({ timeout: 15_000 });
		await logoutBtn.click();

		// Then: signOut({ callbackUrl: "/" }) returns to home
		await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });

		// Then: logged-out marker (login link visible, logout button gone)
		await expect(page.locator('a[href="/login"]').first()).toBeVisible({ timeout: 15_000 });
		await expect(logoutBtn).toHaveCount(0);
	});

	test("Given I am logged in, When I open /me, Then the 我的账号 breadcrumb and the email verification card render", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: navigate to /me
		await page.goto("/me");
		await page.waitForURL("**/me");

		// Then: breadcrumb copy
		await expect(page.getByRole("heading", { name: "我的账号", exact: true })).toBeVisible();

		// Then: section#email renders. (Avatar card is covered by the system
		// spec UJ-02 follow-up — keep this scenario focused on the legacy
		// UJ-02 assertion to preserve 1:1 traceability.)
		await expect(page.locator("section#email")).toBeVisible();
	});

	test("Given I am on a user profile, When I click each tab (回帖 / 精华 / 主题), Then the URL updates with the corresponding ?tab= value", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on the seed e2eprofile (id 64495 has 1
		// thread + 1 post per seed, so every tab has something to render)
		await loginAs("e2etest");
		await page.goto(`/users/${PROFILE_USER_ID}`);
		await page.waitForURL(`**/users/${PROFILE_USER_ID}**`);

		// Then: username heading first (breadcrumb also contains it, so .first())
		await expect(page.getByText("e2eprofile").first()).toBeVisible();

		// When/Then: cycle through the three tabs. .first() because mobile +
		// desktop tab bars both match the same anchor href pattern.
		const postsTab = page.locator('a[href*="tab=posts"]').first();
		await expect(postsTab).toBeVisible();
		await postsTab.click();
		await page.waitForURL(/tab=posts/);

		const digestTab = page.locator('a[href*="tab=digest"]').first();
		await expect(digestTab).toBeVisible();
		await digestTab.click();
		await page.waitForURL(/tab=digest/);

		const threadsTab = page.locator('a[href*="tab=threads"]').first();
		await expect(threadsTab).toBeVisible();
		await threadsTab.click();
		await page.waitForURL(/tab=threads/);
	});
});
