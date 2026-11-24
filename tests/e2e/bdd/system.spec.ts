// tests/e2e/bdd/system.spec.ts — Feature: System & Layout (BDD)
// Ref: docs/23-l3-bdd-refactor.md

import { ForumPage } from "../pages/forum.page";
import { ThreadPage } from "../pages/thread.page";
import { expect, test } from "./fixtures";

test("Given an anonymous visitor, Then the local default avatar is an image without authentication", async ({
	request,
}) => {
	const response = await request.get("/default-avatar.gif", { maxRedirects: 0 });
	expect(response.status()).toBe(200);
	expect(response.headers()["content-type"]).toContain("image/gif");
	const bytes = await response.body();
	expect(bytes.subarray(0, 6).toString()).toMatch(/^GIF8[79]a$/);
});

const FORUM_WITH_NEW_THREAD = 1;
const THREAD_WITH_REPLY = 1;

const DESKTOP = { width: 1440, height: 900 };
const NARROW_DIALOG = { width: 375, height: 800 };

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
	test("Given dark theme and light system, When I refresh before external scripts load, Then the first frame is dark, and theme toggle cycles states", async ({
		page,
	}) => {
		await page.emulateMedia({ colorScheme: "light" });
		await page.goto("/login");
		await page.evaluate(() => {
			localStorage.setItem("theme", "dark");
			localStorage.setItem("width-mode", "full");
		});
		await page.route("**/*", (route) =>
			route.request().resourceType() === "script" ? route.abort() : route.continue(),
		);
		await page.reload({ waitUntil: "domcontentloaded" });
		const frame = await page.evaluate(
			() =>
				new Promise((resolve) => {
					requestAnimationFrame(() => {
						const root = document.documentElement;
						resolve({
							dark: root.classList.contains("dark"),
							colorScheme: getComputedStyle(root).colorScheme,
							background: getComputedStyle(root).backgroundColor,
							widthMode: root.dataset.widthMode,
						});
					});
				}),
		);
		expect(frame).toEqual({
			dark: true,
			colorScheme: "dark",
			background: "rgb(19, 19, 19)",
			widthMode: "full",
		});

		await page.unroute("**/*");
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		const themeToggle = page
			.locator('button[aria-label*="mode"], button[aria-label*="theme"]')
			.first();
		await expect(themeToggle).toBeVisible();
		const initialLabel = await themeToggle.getAttribute("aria-label");

		await themeToggle.click();
		await expect(themeToggle).not.toHaveAttribute("aria-label", initialLabel ?? "");
		const secondLabel = await themeToggle.getAttribute("aria-label");
		expect(secondLabel).not.toBe(initialLabel);

		await themeToggle.click();
		await expect(themeToggle).not.toHaveAttribute("aria-label", secondLabel ?? "");

		await themeToggle.click();
		await expect(themeToggle).toHaveAttribute("aria-label", initialLabel ?? "");
	});

	test("Given I am on a forum or thread page, When I open composer dialogs at desktop and 375px, Then dialogs fit the viewport and the smiley picker opens", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		const forumPage = new ForumPage(page);
		await forumPage.goto(FORUM_WITH_NEW_THREAD);

		await page.setViewportSize(DESKTOP);
		await forumPage.newThreadButton.click();
		const newThreadDialog = page.locator('[role="dialog"]');
		await expect(newThreadDialog).toBeVisible();
		await expect(newThreadDialog.getByText("发表新帖")).toBeVisible();
		await assertDialogFitsViewport(newThreadDialog, DESKTOP);
		await assertFooterFitsDialog(newThreadDialog);

		await page.setViewportSize(NARROW_DIALOG);
		await expect(async () => {
			await assertDialogFitsViewport(newThreadDialog, NARROW_DIALOG);
		}).toPass({ timeout: 5000 });
		await assertFooterFitsDialog(newThreadDialog);
		await newThreadDialog.getByRole("button", { name: /取消/ }).click();
		await expect(newThreadDialog).not.toBeVisible();

		const threadPage = new ThreadPage(page);
		await threadPage.goto(THREAD_WITH_REPLY);
		await page.setViewportSize(DESKTOP);
		await threadPage.replyButton.click();
		const replyDialog = page.locator('[role="dialog"]');
		await expect(replyDialog).toBeVisible();
		await assertDialogFitsViewport(replyDialog, DESKTOP);

		const smileyTrigger = replyDialog.getByRole("button", { name: "插入表情" });
		await expect(smileyTrigger).toBeVisible();
		await smileyTrigger.click();
		const picker = page.locator('[data-radix-popper-content-wrapper] [role="dialog"]');
		await expect(picker.getByRole("tab")).toHaveText(["论坛", "Emoji"]);
		await expect(picker.getByRole("textbox", { name: "搜索论坛表情" })).toBeVisible();
		await page.keyboard.press("Escape");

		await page.setViewportSize(NARROW_DIALOG);
		await expect(async () => {
			await assertDialogFitsViewport(replyDialog, NARROW_DIALOG);
		}).toPass({ timeout: 5000 });
		await assertFooterFitsDialog(replyDialog);
		await replyDialog.getByRole("button", { name: /取消/ }).click();
		await expect(replyDialog).not.toBeVisible();
	});
});
