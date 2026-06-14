// tests/e2e/bdd/social.spec.ts — Feature: Social & User Journey (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 2.2), §5.3 (合并表)
//
// Merges 3 legacy specs (message + user-actions + user-journey, 8 tests) into
// tests/e2e/bdd/social.spec.ts (7 BDD scenarios). Preserves the legacy
// `skipOnCI` switch for the real-form login scenario (UA-03). Runs under the
// `stateful` project because UA-02 and UA-03 mutate the browser session.
// Traceability map lives in the commit message body.
//
// Doc count drift: docs/23 §5.3 says social was 7 tests (= message 2 +
// user-actions 2 + user-journey 3). The actual files carry 8 (user-actions
// has 3 tests; one is skipOnCI). Source-of-truth is the spec; total 8 → 7
// BDD scenarios with 1 merge.

import { FORM } from "../fixtures/selectors";
import { HomePage } from "../pages/home.page";
import { MessagePage } from "../pages/message.page";
import { expect, test } from "./fixtures";

// Cap.js auto-PoW takes 30–45s on the free GitHub Actions runner. UA-03
// drives the real /login form so it must skip on CI just like in legacy.
const skipOnCI = process.env.CI ? test.skip : test;

const POPULATED_FORUM_ID = 114;
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
		// Merges MS-02 here because both old tests start from goto('/messages')
		// and the compose-button assertion is the natural next step after the
		// inbox renders — keeping them split would re-pay the goto + load wait.
		await messagePage.composeButton.click();

		// Then: compose dialog opens
		await expect(messagePage.composeDialog).toBeVisible();
	});

	test("Given I cycled the theme on /login, When I navigate to /, Then the theme choice persists on the new page", async ({
		page,
	}) => {
		// Given: anonymous user on /login (same header renders the toggle).
		await page.goto("/login");

		// CSS fallback: ThemeToggle aria-label encodes the active mode; there
		// is no role-based name shared across light/dark/system states.
		const themeToggle = page
			.locator('button[aria-label*="mode"], button[aria-label*="theme"]')
			.first();
		await expect(themeToggle).toBeVisible();

		// When: cycle once and confirm the label changed
		const initialLabel = await themeToggle.getAttribute("aria-label");
		await themeToggle.click();
		await expect(themeToggle).not.toHaveAttribute("aria-label", initialLabel ?? "");
		const afterClickLabel = await themeToggle.getAttribute("aria-label");
		expect(afterClickLabel).toBeTruthy();
		expect(afterClickLabel).not.toBe(initialLabel);

		// When: full-page nav to /
		await page.goto("/");

		// Then: the toggle on the new page carries the cycled label — proving
		// the choice is persisted in localStorage by useTheme rather than held
		// in component state.
		const themeToggleAfter = page
			.locator('button[aria-label*="mode"], button[aria-label*="theme"]')
			.first();
		await expect(themeToggleAfter).toHaveAttribute("aria-label", afterClickLabel ?? "", {
			timeout: 10_000,
		});

		// Cleanup: cycle back to the initial state so we don't leak the
		// localStorage write into other tests. Playwright contexts are
		// per-test so this is belt-and-suspenders but documents intent.
		await themeToggleAfter.click();
		await themeToggleAfter.click();
		await expect(themeToggleAfter).toHaveAttribute("aria-label", initialLabel ?? "");
	});

	test("Given I am logged in on /, When I click the header 退出登录 button, Then I land on / with logged-out UI (Login link visible, logout button gone)", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on /
		await loginAs("e2etest");
		await page.goto("/");

		// When: click the icon-only logout button (matched by title attribute)
		const logoutBtn = page.locator('button[title="退出登录"]').first();
		await expect(logoutBtn).toBeVisible({ timeout: 15_000 });
		await logoutBtn.click();

		// Then: signOut({ callbackUrl: "/" }) returns to home
		await page.waitForURL((url) => url.pathname === "/", { timeout: 30_000 });

		// Then: logged-out marker (login link visible, logout button gone)
		await expect(page.locator('a[href="/login"]').first()).toBeVisible({ timeout: 15_000 });
		await expect(page.locator('button[title="退出登录"]')).toHaveCount(0);
	});

	skipOnCI(
		"Given I open /login?redirect=/messages, When I submit valid credentials via the real form, Then NextAuth lands me on /messages and the messages UI renders",
		async ({ page }) => {
			// Given: anonymous user on /login with the redirect param preserved
			await page.goto("/login?redirect=/messages");

			// When: drive the real form (skipping the loginAs API shortcut)
			// so NextAuth's redirect callback is exercised end-to-end.
			await page.fill(FORM.usernameInput, "e2etest");
			await page.fill(FORM.passwordInput, "e2etest123");
			await page.click(FORM.submitButton);

			// Then: landed on /messages, not / (the redirect callback honored
			// the ?redirect= param)
			await page.waitForURL(/\/messages(\?|$)/, { timeout: 30_000 });

			// Then: messages page actually rendered something (heading or
			// empty-state, depending on inbox content)
			const indicator = page.locator('h1, :text("收信箱为空"), :text("发信箱为空")').first();
			await expect(indicator).toBeVisible({ timeout: 15_000 });
		},
	);

	test("Given I am logged in, When I click into a forum and then into a thread, Then I can navigate back via the breadcrumb link to the forum", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on /
		await loginAs("e2etest");
		const homePage = new HomePage(page);
		await homePage.goto();
		expect(await homePage.isLoaded()).toBe(true);

		// When: click into populated forum
		const forumLink = page.locator(`a[href="/forums/${POPULATED_FORUM_ID}"]`);
		await expect(forumLink).toBeVisible();
		await forumLink.click();
		await page.waitForURL(new RegExp(`/forums/${POPULATED_FORUM_ID}`));

		// When: click into the first thread
		const threadLink = page.locator('a[href^="/threads/"]').first();
		await expect(threadLink).toBeVisible();
		await threadLink.click();
		await page.waitForURL(/\/threads\/\d+/);
		await expect(page.locator("h1")).toBeVisible();

		// When: click the breadcrumb back to /forums/<id>
		// CSS fallback: the breadcrumb container is scoped via its layout
		// classes; bare a[href^="/forums/"] would match thread-row links too.
		const breadcrumbForumLink = page
			.locator("nav.flex.items-center.gap-1")
			.locator('a[href^="/forums/"]')
			.first();
		await expect(breadcrumbForumLink).toBeVisible();
		await breadcrumbForumLink.click();

		// Then: back on a /forums/<digits> page
		await page.waitForURL(/\/forums\/\d+/);
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
		await expect(page.getByText("我的账号")).toBeVisible();

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
