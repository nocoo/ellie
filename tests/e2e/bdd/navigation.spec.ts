// tests/e2e/bdd/navigation.spec.ts — Feature: Forum Navigation (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 1.1), §5.3 (合并表), §2.3/§2.5/§2.6
//
// Merges 4 legacy specs (navigation + navigation-extra + header-actions +
// not-found, 18 tests) into 14 BDD scenarios. Traceability map lives in the
// commit message body.

import { FORUM } from "../fixtures/selectors";
import { ForumPage } from "../pages/forum.page";
import { HomePage } from "../pages/home.page";
import { SearchPage } from "../pages/search.page";
import { ThreadPage } from "../pages/thread.page";
import { UserPage } from "../pages/user.page";
import { emptyDataGate, expect, test } from "./fixtures";

// Forum 114 is the populated test forum used across navigation specs — has a
// real heading, breadcrumb, and (usually) ≥2 pages of threads.
const POPULATED_FORUM_ID = 114;
const POPULATED_THREAD_ID = 662174;
const POPULATED_USER_ID = 64495;
const THREAD_WITH_FORUM_LINK = 1;

test.describe("Feature: Forum Navigation", () => {
	test("Given I am logged in, When I open the home page, Then I see forum groups, the digest showcase, and the site footer", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user (require_login is on in test env)
		await loginAs("e2etest");

		// When: navigate to /
		const homePage = new HomePage(page);
		await homePage.goto();

		// Then: forum groups (or the empty-state copy) render
		expect(await homePage.isLoaded()).toBe(true);

		// Then: digest showcase link is visible
		await expect(homePage.digestShowcase).toBeVisible();

		// Then: site footer carries copyright text (© or "All rights reserved")
		const footer = page.locator("footer").first();
		await expect(footer).toBeVisible({ timeout: 15_000 });
		await expect(footer.getByText(/©|All rights reserved/).first()).toBeVisible({
			timeout: 5_000,
		});
	});

	test("Given I am on the home page, When I click the header message-badge icon, Then I land on /messages", async ({
		page,
		loginAs,
	}) => {
		// Given: home page
		await loginAs("e2etest");
		await page.goto("/");

		// When: click the message link in the header (first matching anchor)
		// CSS fallback: MessageBadgeIcon renders an icon-only <Link href="/messages">
		// without an accessible name, so getByRole({name}) cannot target it.
		const messagesLink = page.locator('header a[href="/messages"], a[href="/messages"]').first();
		await expect(messagesLink).toBeVisible({ timeout: 15_000 });
		await messagesLink.click();

		// Then: URL is on /messages
		await page.waitForURL((url) => url.pathname.startsWith("/messages"), { timeout: 15_000 });
		expect(new URL(page.url()).pathname).toMatch(/^\/messages/);
	});

	test("Given I am logged in, When I open a populated forum page, Then I see the heading, the new-thread button, the thread list, and a breadcrumb back to home", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: open the populated forum
		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);

		// Then: forum heading + 发表新帖 button render
		await expect(forumPage.heading).toBeVisible();
		await expect(forumPage.newThreadButton).toBeVisible();

		// Then: either the thread list OR the empty-state is rendered. Missing
		// BOTH is a product regression, not a seed gap, so we hard-fail here
		// rather than calling emptyDataGate — a populated-forum page that
		// renders neither list nor empty-state should never pass silently.
		const threadCount = await forumPage.threadList.count();
		const emptyCount = await forumPage.emptyState.count();
		expect(threadCount + emptyCount, "thread list or empty state must render").toBeGreaterThan(0);

		// Then: breadcrumb exposes a link back to /
		// CSS fallback: header/breadcrumb anchors are scoped to nav/header regions
		// to avoid matching the many "/" links inside thread rows below the fold.
		const homeLink = page
			.locator('nav a[href="/"], [aria-label="Breadcrumb"] a[href="/"], header a[href="/"]')
			.first();
		await expect(homeLink).toBeVisible({ timeout: 15_000 });
	});

	test("Given I am on a forum page, When I click the header 精华帖 button, Then I navigate to /digest", async ({
		page,
		loginAs,
	}) => {
		// Given: on the populated forum
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// When: click the 精华帖 link in the header
		// CSS fallback: the link wraps an icon + text, but the anchor itself has
		// no accessible role/name so we match via href + visible text.
		const digestLink = page.locator('a[href="/digest"]:has-text("精华帖")').first();
		await expect(digestLink).toBeVisible({ timeout: 15_000 });
		await digestLink.click();

		// Then: URL is on /digest
		await page.waitForURL((url) => url.pathname.startsWith("/digest"), { timeout: 15_000 });
		expect(new URL(page.url()).pathname).toMatch(/^\/digest/);
	});

	test("Given I am on a forum page, When I submit a query in the header search box, Then I land on /search with q=", async ({
		page,
		loginAs,
	}) => {
		// Given: on the populated forum
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// When: type into the header search input and press Enter
		// CSS fallback: header renders two copies (mobile + desktop); aria-label
		// is the only stable hook shared by both.
		const searchInput = page.locator('input[aria-label="搜索主题和用户"]').first();
		await expect(searchInput).toBeVisible({ timeout: 15_000 });
		await searchInput.fill("测试");
		await searchInput.press("Enter");

		// Then: URL is on /search?q=...
		await page.waitForURL(/\/search\?q=/);
		expect(page.url()).toContain("q=");
	});

	test("Given I am on a forum page, When I click 发表新帖, Then the new-thread dialog opens", async ({
		page,
		loginAs,
	}) => {
		// Given: on the populated forum
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// When: click the new-thread button
		const newThreadBtn = page.locator(FORUM.newThreadButton).first();
		await expect(newThreadBtn).toBeVisible({ timeout: 15_000 });
		await newThreadBtn.click();

		// Then: Radix dialog renders with the 发表新帖 title
		// CSS fallback: Radix exposes [data-slot="dialog-content"] (same hook as
		// dialog-layout.spec.ts) since the dialog has no aria-label.
		const dialog = page.locator('[data-slot="dialog-content"]').first();
		await expect(dialog).toBeVisible({ timeout: 10_000 });
		await expect(dialog.getByText("发表新帖").first()).toBeVisible();
	});

	test("Given I am on a populated forum page, When I click the page-2 pagination link, Then the URL updates to ?page=2", async ({
		page,
		loginAs,
	}) => {
		// Given: on the populated forum
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// When: locate the page-2 pagination link
		// CSS fallback: PagePagination renders raw <a href="/forums/X?page=2">2</a>
		// — there is no accessible "Go to page 2" role/name attached.
		const pageTwoLink = page
			.locator(
				`a[href*="/forums/${POPULATED_FORUM_ID}?page=2"], a[href*="/forums/${POPULATED_FORUM_ID}?"][href*="page=2"]`,
			)
			.first();

		// Skip cleanly when the seed has shrunk below 2 pages.
		const pageTwoCount = await pageTwoLink.count();
		const gate = emptyDataGate(
			pageTwoCount,
			"second page of threads on forum 114 (forum does not currently span 2 pages in test data)",
		);
		// biome-ignore lint/suspicious/noSkippedTests: data gate — skip when seed has <2 pages
		test.skip(gate.skip, gate.reason);

		await pageTwoLink.click();

		// Then: URL contains page=2
		await page.waitForURL(/\?(.*&)?page=2/);
		expect(page.url()).toMatch(/page=2/);
	});

	test("Given I am logged in, When I open a thread page, Then I see the title, breadcrumbs, post cards, and a link to the parent forum", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: open a populated thread
		const threadPage = new ThreadPage(page);
		await threadPage.goto(POPULATED_THREAD_ID);

		// Then: title + breadcrumb + ≥1 post card render
		await expect(threadPage.heading).toBeVisible();
		await expect(threadPage.breadcrumbs).toBeVisible();
		await expect(threadPage.postCards.first()).toBeVisible();

		// Then: there is a link back to /forums/<digits>. Use a fixed thread for
		// this assertion because POPULATED_THREAD_ID may belong to any forum.
		await page.goto(`/threads/${THREAD_WITH_FORUM_LINK}`);
		// CSS fallback: the 版块 link is a bare anchor without an aria-label.
		const forumLink = page.locator('a[href^="/forums/"]').first();
		await expect(forumLink).toBeVisible({ timeout: 15_000 });
		const href = await forumLink.getAttribute("href");
		expect(href).toMatch(/^\/forums\/\d+/);
	});

	test("Given I am logged in, When I open a user profile, Then I see the username, five stats cards, and the tab navigation", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: open a real active user profile
		const userPage = new UserPage(page);
		await userPage.goto(POPULATED_USER_ID);

		// Then: username heading renders
		await expect(userPage.username).toBeVisible();

		// Then: 5 stats cards (threads/posts/digest/credits/coins)
		await expect(userPage.statsCards).toHaveCount(5);

		// Then: tab navigation renders
		await expect(userPage.tabNav).toBeVisible();
	});

	test("Given I am logged in, When I open the digest page, Then I see the 精华帖列表 heading and digest stats", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: navigate to /digest
		await page.goto("/digest");
		await page.waitForLoadState("networkidle");

		// Then: heading, hero stat block, and section tagline render
		await expect(page.getByText("精华帖列表")).toBeVisible();
		await expect(page.getByText("篇精华")).toBeVisible();
		await expect(page.getByText("论坛精华 · 知识殿堂")).toBeVisible();
	});

	test("Given I am logged in, When I open the search page, Then I see the search input, the 搜索 button, and the empty-state prompt", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: navigate to /search
		const searchPage = new SearchPage(page);
		await searchPage.goto();

		// Then: input + submit button + empty-state prompt render (tabs appear
		// only after a query is submitted, so we explicitly assert their absence
		// of dependency here by asserting the prompt instead).
		await expect(searchPage.searchInput).toBeVisible();
		await expect(searchPage.searchButton).toBeVisible();
		await expect(searchPage.emptyPrompt).toBeVisible();
	});

	test("Given a thread id does not exist, When I open it, Then I see the 主题不存在 error card and a 返回首页 link", async ({
		page,
	}) => {
		// Given: 99,999,999 is past the seeded thread id range.

		// When: navigate to the missing thread
		await page.goto("/threads/99999999");

		// Then: soft-fail error UI is shown with a recovery link
		await expect(page.getByText(/主题不存在|无法加载主题|Thread not found/i).first()).toBeVisible({
			timeout: 15_000,
		});
		// CSS fallback: the recovery link is a bare anchor; getByRole("link",{name:"返回首页"})
		// fails here because the link is rendered with mixed text + icon children
		// without an accessible-name override.
		await expect(page.locator('a[href="/"]', { hasText: "返回首页" })).toBeVisible();
	});

	test("Given a non-numeric thread or forum id, When I open it, Then I see the 无效 ID error card with a 返回首页 link", async ({
		page,
	}) => {
		// /threads/<non-numeric>: 无效的主题 ID
		// When
		await page.goto("/threads/not-a-number");
		// Then
		await expect(page.getByText(/无效的主题/)).toBeVisible({ timeout: 10_000 });
		await expect(page.locator('a[href="/"]', { hasText: "返回首页" })).toBeVisible();

		// /forums/<non-numeric>: 无效的版块 ID (same defensive UI path)
		// When
		await page.goto("/forums/not-a-number");
		// Then
		await expect(page.getByText(/无效的版块/)).toBeVisible({ timeout: 10_000 });
		await expect(page.locator('a[href="/"]', { hasText: "返回首页" })).toBeVisible();
	});

	test("Given a user id does not exist, When I open the profile, Then I see the 用户不存在 error", async ({
		page,
	}) => {
		// When: navigate to the missing user
		await page.goto("/users/99999999");

		// Then: soft-fail error UI surfaces
		await expect(page.getByText(/用户不存在|无法加载用户|User not found/i).first()).toBeVisible({
			timeout: 15_000,
		});
	});
});
