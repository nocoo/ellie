// tests/e2e/bdd/navigation.spec.ts — Feature: Forum Navigation (BDD)
// Ref: docs/23-l3-bdd-refactor.md

import { ForumPage } from "../pages/forum.page";
import { HomePage } from "../pages/home.page";
import { ThreadPage } from "../pages/thread.page";
import { UserPage } from "../pages/user.page";
import { emptyDataGate, expect, test } from "./fixtures";

const POPULATED_FORUM_ID = 114;
const POPULATED_THREAD_ID = 662174;
const POPULATED_USER_ID = 64495;
const THREAD_WITH_FORUM_LINK = 1;

test.describe("Feature: Forum Navigation", () => {
	test("Given I am logged in, When I open the home page, Then I see forum groups, the digest showcase, and the site footer", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		const homePage = new HomePage(page);
		await homePage.goto();

		expect(await homePage.isLoaded()).toBe(true);
		await expect(homePage.digestShowcase).toBeVisible();
		const discussions = page
			.locator("[data-basalt-surface]")
			.filter({ has: page.getByText("最近讨论", { exact: true }) });
		const topics = discussions.locator('a[href^="/threads/"]');
		await expect(topics).toHaveCount(5);
		const viewport = discussions.getByRole("region", { name: "最近讨论" });
		await expect(viewport).not.toHaveAttribute("tabindex");
		await expect(viewport).toHaveCSS("overflow-y", "visible");
		await expect(topics.last()).toBeInViewport();

		const footer = page.locator("footer").first();
		await expect(footer).toBeVisible({ timeout: 15_000 });
		await expect(footer.getByText(/©|All rights reserved/).first()).toBeVisible({
			timeout: 5_000,
		});
	});

	test("Given I am logged in, When I open a populated forum page, Then I see the heading, thread list, breadcrumb, and pagination", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		const forumPage = new ForumPage(page);
		await forumPage.goto(POPULATED_FORUM_ID);

		await expect(forumPage.heading).toBeVisible();
		await expect(forumPage.newThreadButton).toBeVisible();

		const threadCount = await forumPage.threadList.count();
		const emptyCount = await forumPage.emptyState.count();
		expect(threadCount + emptyCount, "thread list or empty state must render").toBeGreaterThan(0);

		const homeLink = page
			.locator('nav a[href="/"], [aria-label="Breadcrumb"] a[href="/"], header a[href="/"]')
			.first();
		await expect(homeLink).toBeVisible({ timeout: 15_000 });

		const pageTwoLink = page
			.locator(
				`a[href*="/forums/${POPULATED_FORUM_ID}?page=2"], a[href*="/forums/${POPULATED_FORUM_ID}?"][href*="page=2"]`,
			)
			.first();
		const pageTwoCount = await pageTwoLink.count();
		const gate = emptyDataGate(
			pageTwoCount,
			"second page of threads on forum 114 (forum does not currently span 2 pages in test data)",
		);
		// biome-ignore lint/suspicious/noSkippedTests: data gate — skip when seed has <2 pages
		test.skip(gate.skip, gate.reason);

		await pageTwoLink.click();
		await page.waitForURL(/\?(.*&)?page=2/);
		expect(page.url()).toMatch(/page=2/);
	});

	test("Given I am logged in, When I open a thread page, Then I see the title, breadcrumbs, post cards, and a link to the parent forum", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		const threadPage = new ThreadPage(page);
		await threadPage.goto(POPULATED_THREAD_ID);

		await expect(threadPage.heading).toBeVisible();
		await expect(threadPage.breadcrumbs).toBeVisible();
		await expect(threadPage.postCards.first()).toBeVisible();

		await page.goto(`/threads/${THREAD_WITH_FORUM_LINK}`);
		const forumLink = page.locator('a[href^="/forums/"]').first();
		await expect(forumLink).toBeVisible({ timeout: 15_000 });
		const href = await forumLink.getAttribute("href");
		expect(href).toMatch(/^\/forums\/\d+/);
	});

	test("Given I am logged in, When I open a user profile, Then I see the username, five stats cards, and the tab navigation", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		const userPage = new UserPage(page);
		await userPage.goto(POPULATED_USER_ID);

		await expect(userPage.username).toBeVisible();
		await expect(userPage.statsCards).toHaveCount(5);
		await expect(userPage.tabNav).toBeVisible();
	});

	test("Given I am logged in, When I open the digest page, Then I see the 精华帖列表 heading and digest stats", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		await page.goto("/digest");
		await page.waitForLoadState("networkidle");

		await expect(page.getByText("精华帖列表")).toBeVisible();
		await expect(page.getByRole("heading", { name: "论坛精华", exact: true })).toBeVisible();
		for (const label of ["全部精华", "精华 I", "精华 II", "精华 III"]) {
			const metric = page
				.locator("dl > div")
				.filter({ has: page.getByText(label, { exact: true }) });
			await expect(metric.locator("dd")).toHaveText(/[\d,]+/);
		}
	});

	test("Given missing or non-numeric thread, forum, or user IDs, Then soft-fail error cards render with recovery links", async ({
		page,
	}) => {
		await page.goto("/threads/99999999");
		await expect(page.getByText(/主题不存在|无法加载主题|Thread not found/i).first()).toBeVisible({
			timeout: 15_000,
		});
		await expect(page.locator('a[href="/"]', { hasText: "返回首页" })).toBeVisible();

		await page.goto("/threads/not-a-number");
		await expect(page.getByText(/无效的主题/)).toBeVisible({ timeout: 10_000 });

		await page.goto("/forums/not-a-number");
		await expect(page.getByText(/无效的版块/)).toBeVisible({ timeout: 10_000 });

		await page.goto("/users/99999999");
		await expect(page.getByText(/用户不存在|无法加载用户|User not found/i).first()).toBeVisible({
			timeout: 15_000,
		});
	});
});
