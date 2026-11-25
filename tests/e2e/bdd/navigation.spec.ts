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
	test("Given I am logged in, When I open / and /digest, Then I see forum groups, showcases, footer, and digest stats", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		const homePage = new HomePage(page);
		expect(await homePage.isLoaded()).toBe(true);
		await expect(homePage.digestShowcase).toBeVisible();

		const footer = page.locator("footer").first();
		await expect(footer).toBeVisible({ timeout: 15_000 });

		await page.goto("/digest");
		await page.waitForLoadState("networkidle");
		await expect(page.getByText("精华帖列表")).toBeVisible();
		await expect(page.getByRole("heading", { name: "论坛精华", exact: true })).toBeVisible();
	});

	test("Given I am logged in, When I open a forum, thread, and user profile, Then navigation, pagination, posts, and stats render", async ({
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

		const pageTwoLink = page
			.locator(
				`a[href*="/forums/${POPULATED_FORUM_ID}?page=2"], a[href*="/forums/${POPULATED_FORUM_ID}?"][href*="page=2"]`,
			)
			.first();
		const gate = emptyDataGate(
			await pageTwoLink.count(),
			"second page of threads on forum 114 (forum does not currently span 2 pages in test data)",
		);
		// biome-ignore lint/suspicious/noSkippedTests: data gate — skip when seed has <2 pages
		test.skip(gate.skip, gate.reason);

		const threadPage = new ThreadPage(page);
		await threadPage.goto(POPULATED_THREAD_ID);
		await expect(threadPage.heading).toBeVisible();
		await expect(threadPage.postCards.first()).toBeVisible();

		await page.goto(`/threads/${THREAD_WITH_FORUM_LINK}`);
		const forumLink = page.locator('a[href^="/forums/"]').first();
		await expect(forumLink).toBeVisible({ timeout: 15_000 });
		expect(await forumLink.getAttribute("href")).toMatch(/^\/forums\/\d+/);

		const userPage = new UserPage(page);
		await userPage.goto(POPULATED_USER_ID);
		await expect(userPage.username).toBeVisible();
		await expect(userPage.statsCards).toHaveCount(5);
	});
});
