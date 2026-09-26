// tests/e2e/bdd/system.spec.ts — Feature: System & Layout (BDD)
// Ref: docs/23-l3-bdd-refactor.md §3 (Phase 1.3), §5.3 (合并表)
//
// Merges 3 legacy specs (system + dialog-layout + misc-coverage, 11 tests)
// into tests/e2e/bdd/system.spec.ts (9 BDD scenarios). The 4 viewport-load
// tests in system.spec.ts collapse to 1 parameterized scenario (3 viewports
// proving the same invariant) + the dedicated mobile login layout scenario.
// Traceability map lives in the commit message body.

import { ForumPage } from "../pages/forum.page";
import { ThreadPage } from "../pages/thread.page";
import { expect, test } from "./fixtures";

const POPULATED_FORUM_ID = 114;
const FORUM_WITH_NEW_THREAD = 1;
const THREAD_WITH_REPLY = 1;
const THREAD_WITH_OWN_REPLY = 662174;
const OWN_REPLY_POST_ID = 700001;

const DESKTOP = { width: 1440, height: 900 };
const TABLET = { width: 768, height: 1024 };
const MOBILE = { width: 375, height: 812 };
const NARROW_DIALOG = { width: 375, height: 800 };

// Dialog invariants — same helpers as legacy dialog-layout.spec.ts, kept here
// because they are dialog-specific and not generally useful elsewhere.
async function assertDialogFitsViewport(
	dialog: import("@playwright/test").Locator,
	viewport: { width: number; height: number },
) {
	const box = await dialog.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	expect(box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.x).toBeGreaterThanOrEqual(-1);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
	expect(box.width).toBeLessThanOrEqual(1200 + 1);
	expect(box.height).toBeLessThanOrEqual(viewport.height * 0.9 + 1);
}

async function assertFooterFitsDialog(dialog: import("@playwright/test").Locator) {
	const dialogBox = await dialog.boundingBox();
	expect(dialogBox).not.toBeNull();
	if (!dialogBox) return;
	// 4px tolerance for sub-pixel rounding; B4 regression was 20+ px so this
	// still catches real layout breaks.
	const TOLERANCE = 4;
	const buttons = dialog.locator("button");
	const count = await buttons.count();
	for (let i = 0; i < count; i++) {
		const btn = buttons.nth(i);
		const btnBox = await btn.boundingBox();
		if (!btnBox) continue;
		expect(btnBox.x).toBeGreaterThanOrEqual(dialogBox.x - TOLERANCE);
		expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + TOLERANCE);
		expect(btnBox.y).toBeGreaterThanOrEqual(dialogBox.y - TOLERANCE);
		expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(
			dialogBox.y + dialogBox.height + TOLERANCE,
		);
	}
}

test.describe("Feature: System & Layout", () => {
	test("Given I am on the home page, When I click the theme toggle three times, Then the icon cycles through three distinct states and returns to the initial state", async ({
		page,
	}) => {
		// Given: home page rendered (no login required — theme toggle is public)
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// CSS fallback: ThemeToggle aria-label encodes the current mode
		// ("Switch to dark mode" etc.); there is no role-based name shared
		// across the three states.
		const themeToggle = page
			.locator('button[aria-label*="mode"], button[aria-label*="theme"]')
			.first();
		await expect(themeToggle).toBeVisible();

		// When: capture initial state and cycle 3 times
		const initialLabel = await themeToggle.getAttribute("aria-label");

		await themeToggle.click();
		await expect(themeToggle).not.toHaveAttribute("aria-label", initialLabel ?? "");
		const secondLabel = await themeToggle.getAttribute("aria-label");
		expect(secondLabel).not.toBe(initialLabel);

		await themeToggle.click();
		await expect(themeToggle).not.toHaveAttribute("aria-label", secondLabel ?? "");
		const thirdLabel = await themeToggle.getAttribute("aria-label");
		expect(thirdLabel).not.toBe(secondLabel);

		// Then: third click cycles back to initial
		await themeToggle.click();
		await expect(themeToggle).toHaveAttribute("aria-label", initialLabel ?? "");
	});

	test("Given I am logged in, When I load the home page across mobile / tablet / desktop viewports, Then header, main, and forum links remain visible", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: cycle through the three legacy viewports. We collapse mobile +
		// tablet + desktop into a single scenario because all three exercised
		// the same invariants (main visible, forum link visible, header visible)
		// against different widths — the only real product question is
		// "does the layout survive a width change?", which 3 viewports answer
		// just as well as 3 separate tests.
		for (const viewport of [MOBILE, TABLET, DESKTOP]) {
			await page.setViewportSize(viewport);
			await page.goto("/");
			await page.waitForLoadState("networkidle");

			// Then: same invariants at every width
			await expect(page.locator("main")).toBeVisible();
			await expect(page.locator('a[href^="/forums/"]').first()).toBeVisible();
			await expect(page.locator("header")).toBeVisible();
		}
	});

	test("Given I am on a mobile viewport, When I open /login, Then the username, password, and submit controls render in the form", async ({
		page,
	}) => {
		// Given: mobile viewport without login (the login page itself is the target)
		await page.setViewportSize(MOBILE);

		// When: open /login
		await page.goto("/login");

		// Then: form is laid out with both inputs and the submit button visible
		await expect(page.locator('input[id="username"]')).toBeVisible();
		await expect(page.locator('input[id="password"]')).toBeVisible();
		await expect(page.locator('button[type="submit"]')).toBeVisible();
	});

	test("Given a narrow phone, When I open registration as a page or dialog, Then the create-account button keeps its 44px touch target", async ({
		page,
	}) => {
		for (const width of [320, 375, 390]) {
			await page.setViewportSize({ width, height: 844 });
			for (const variant of ["page", "dialog"]) {
				await page.goto(variant === "page" ? "/register" : "/login");
				if (variant === "dialog") {
					await page.getByRole("button", { name: "创建新账号", exact: true }).click();
				}
				const submit = page.getByRole("button", { name: "创建账号", exact: true });
				await submit.scrollIntoViewIfNeeded();
				await expect(submit).toBeInViewport();
				// The dialog scales in; measure its settled touch target, not an animation frame.
				await expect
					.poll(async () => (await submit.boundingBox())?.height ?? 0, {
						message: `${variant} registration at ${width}px`,
					})
					.toBeGreaterThanOrEqual(44);
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
					width + 1,
				);
			}
		}
	});

	test("Given I am on a populated forum page, When I open the new-thread dialog at desktop and 375px, Then the dialog fits the viewport and its footer buttons stay inside the dialog box", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on forum 1 (stable id for dialog smoke)
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(FORUM_WITH_NEW_THREAD);

		// When: open dialog at desktop
		await page.setViewportSize(DESKTOP);
		await forumPage.newThreadButton.click();
		// CSS fallback: Radix dialog content has no aria-label; data-slot is
		// the only stable hook shared by all editor dialogs.
		const dialog = page.locator('[data-slot="dialog-content"]');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText("发表新帖")).toBeVisible();

		// Then: desktop layout invariants
		await assertDialogFitsViewport(dialog, DESKTOP);
		await assertFooterFitsDialog(dialog);

		// When: resize to narrow (the B4 regression target)
		await page.setViewportSize(NARROW_DIALOG);
		await expect(async () => {
			await assertDialogFitsViewport(dialog, NARROW_DIALOG);
		}).toPass({ timeout: 5000 });

		// Then: footer fits at 375px (the bug B4 fixed — pre-B4 footer overflowed)
		await assertFooterFitsDialog(dialog);

		// Cleanup: close via Cancel so we don't pollute server state
		await dialog.getByRole("button", { name: /取消/ }).click();
		await expect(dialog).not.toBeVisible();
	});

	test("Given a short viewport, When I write or edit a post, Then validation feedback and editor actions remain visible", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		const mutations: string[] = [];
		page.on("request", (request) => {
			if (
				["POST", "PUT", "PATCH", "DELETE"].includes(request.method()) &&
				new URL(request.url()).pathname.startsWith("/api/v1/")
			) {
				mutations.push(request.url());
			}
		});
		for (const scenario of [
			{
				kind: "new-thread",
				path: `/forums/${FORUM_WITH_NEW_THREAD}`,
				postId: null,
				openLabel: "发表新帖",
				submitLabel: "发布主题",
			},
			{
				kind: "quoted-reply",
				path: `/threads/${THREAD_WITH_REPLY}`,
				postId: 1,
				openLabel: "回复",
				submitLabel: "发送回复",
			},
			{
				kind: "post-edit",
				path: `/threads/${THREAD_WITH_OWN_REPLY}`,
				postId: OWN_REPLY_POST_ID,
				openLabel: "编辑",
				submitLabel: "保存",
			},
		]) {
			for (const viewport of [
				{ width: 667, height: 375 },
				{ width: 390, height: 400 },
				{ width: 320, height: 568 },
			]) {
				await page.setViewportSize(viewport);
				await page.goto(scenario.path);
				const entry = scenario.postId ? page.locator(`#post-${scenario.postId}`) : page;
				await entry.getByRole("button", { name: scenario.openLabel, exact: true }).first().click();
				const dialog = page.locator('[data-slot="dialog-content"]');
				await expect(dialog).toBeVisible();
				if (scenario.kind === "new-thread") {
					await dialog.getByRole("textbox", { name: "主题标题", exact: true }).fill("Valid title");
				}
				const editor = dialog.getByRole("textbox", { name: "正文", exact: true });
				await editor.scrollIntoViewIfNeeded();
				const box = await dialog.locator(".tiptap-content-wrap").boundingBox();
				expect(
					box?.height,
					`${scenario.kind} at ${viewport.width}×${viewport.height}`,
				).toBeGreaterThanOrEqual(120);
				await expect(editor).toBeInViewport({ ratio: 0.4 });
				await editor.click();
				await editor.fill("A");
				await editor.press("Control+Enter");
				const feedback = page.getByRole("alert");
				await expect(feedback).toHaveCount(1);
				await expect(feedback).toContainText("内容太短，请输入更多内容");
				await expect(feedback).toBeInViewport({ ratio: 1 });
				await expect(dialog).toBeVisible();
				const draft = `Usable ${scenario.kind} draft at ${viewport.width} pixels.`;
				await editor.fill(draft);
				await expect(editor).toContainText(draft);
				await expect(dialog.getByRole("button", { name: "取消", exact: true })).toBeInViewport();
				await expect(
					dialog.getByRole("button", {
						name: scenario.submitLabel,
						exact: true,
					}),
				).toBeInViewport();
				await dialog.getByRole("button", { name: "取消", exact: true }).click();
				await expect(dialog).toBeHidden();
			}
		}
		expect(mutations).toEqual([]);
	});

	test("Given I am on a thread page, When I open the reply dialog at desktop and 375px, Then the dialog fits the viewport, the footer stays inside, and the smiley popover opens", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on thread 1
		await loginAs("e2etest");
		const threadPage = new ThreadPage(page);
		await threadPage.goto(THREAD_WITH_REPLY);

		// When: open reply dialog at desktop
		await page.setViewportSize(DESKTOP);
		await threadPage.replyButton.click();
		const dialog = page.locator('[data-slot="dialog-content"]');
		await expect(dialog).toBeVisible();

		// Then: desktop dialog + footer invariants
		await assertDialogFitsViewport(dialog, DESKTOP);
		await assertFooterFitsDialog(dialog);

		// When: trigger the unified emoji picker
		const smileyTrigger = dialog.getByRole("button", { name: "插入表情" });
		await expect(smileyTrigger).toBeVisible();
		await smileyTrigger.click();

		const picker = page.locator('[data-slot="popover-content"]');
		await expect(picker.getByRole("tab")).toHaveText(["论坛", "Emoji"]);
		await expect(picker.getByRole("tab", { name: "论坛", exact: true })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(picker.getByRole("textbox", { name: "搜索论坛表情" })).toBeVisible();
		await expect(picker.getByRole("region", { name: "最近使用的表情" })).toBeVisible();
		await page.keyboard.press("Escape");

		// When: resize to narrow
		await page.setViewportSize(NARROW_DIALOG);
		await expect(async () => {
			await assertDialogFitsViewport(dialog, NARROW_DIALOG);
		}).toPass({ timeout: 5000 });
		await assertFooterFitsDialog(dialog);

		// Cleanup
		await dialog.getByRole("button", { name: /取消/ }).click();
		await expect(dialog).not.toBeVisible();
	});

	test("Given I am logged in, When I search for a high-entropy query that cannot match any seeded thread, Then the 未找到相关结果 empty-state renders", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: send a query that the FTS5 index cannot hit
		// High-entropy ASCII = virtually guaranteed miss without depending on
		// seed shape (which evolves between versions).
		const query = "zzzz-no-such-thread-xxx-9876543210";
		await page.goto(`/search?q=${encodeURIComponent(query)}`);

		// Then: explicit empty-state copy
		await expect(page.getByText("未找到相关结果").first()).toBeVisible({ timeout: 20_000 });
	});

	test("Given I am logged in, When I open /me, Then both the email section and the avatar section render", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: navigate to /me
		await page.goto("/me");
		await page.waitForURL("**/me");

		// Then: legacy E2E-UJ-02 only covered #email; we lock in both sections
		// so a future refactor that drops the avatar block fails loudly.
		await expect(page.locator("section#email")).toBeVisible({ timeout: 15_000 });
		await expect(page.locator("section#avatar")).toBeVisible({ timeout: 15_000 });
	});

	test("Given I am on a forum page, When I click the site logo in the header, Then I return to the home page", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user on a populated forum
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// When: click the first header/nav link to "/"
		// CSS fallback: logo anchor has no accessible role/name; matching the
		// first header/nav link to "/" covers both mobile + desktop layouts.
		const logo = page.locator('header a[href="/"], nav a[href="/"]').first();
		await expect(logo).toBeVisible({ timeout: 15_000 });
		await logo.click();

		// Then: URL pathname is exactly /
		await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
		expect(new URL(page.url()).pathname).toBe("/");
	});

	test("Given I am logged in, When I open /digest, Then I see a heading and either a digest list or an empty-state", async ({
		page,
		loginAs,
	}) => {
		// Given: authenticated user
		await loginAs("e2etest");

		// When: navigate to /digest
		await page.goto("/digest");

		// Then: hero heading renders
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

		// Then: either a digest thread link OR the empty-state appears. The
		// seed may or may not contain digest entries on a given day, so we
		// accept both — the assertion of interest is that the page produced
		// usable content, not that the seed had digests.
		const indicator = page
			.locator('a[href^="/threads/"], :text("暂无内容"), :text("暂无精华")')
			.first();
		await expect(indicator).toBeVisible({ timeout: 15_000 });
	});
});
