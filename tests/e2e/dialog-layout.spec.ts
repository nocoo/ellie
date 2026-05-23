// tests/e2e/dialog-layout.spec.ts — E2E-DL Dialog layout smoke (B4)
//
// Visual/layout regression for the post-editor dialog overhaul. Asserts:
//   - new-thread + reply + edit dialogs render at desktop width capped
//     at 1200px and stay within max-h:90vh
//   - the dialog content does not overflow the viewport horizontally on
//     375px (the smoke that B4 specifically targets — pre-B4 the footer
//     buttons + hint pushed beyond the viewport)
//   - the smiley toolbar button opens a popover on click (replacing the
//     old always-on smiley panel)
//
// Stateless: this spec only opens dialogs; it does not submit, so it
// can run before any stateful CRUD.

import { expect, test } from "./fixtures/base";
import { ForumPage } from "./pages/forum.page";
import { ThreadPage } from "./pages/thread.page";

const FORUM_ID = 1;
const THREAD_ID = 1;

const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 375, height: 800 };

/**
 * Common layout invariants we want to hold for every editor dialog,
 * at every viewport: the dialog must fit within the viewport (no
 * horizontal scroll) and stay within max-h:90vh vertically.
 */
async function assertDialogFitsViewport(
	dialog: ReturnType<ReturnType<typeof test>["info"]> extends never
		? never
		: import("@playwright/test").Locator,
	viewport: { width: number; height: number },
) {
	const box = await dialog.boundingBox();
	expect(box).not.toBeNull();
	if (!box) return;
	// Width within viewport (allow ±1px for sub-pixel rounding).
	expect(box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.x).toBeGreaterThanOrEqual(-1);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
	// Capped at 1200px on wide screens.
	expect(box.width).toBeLessThanOrEqual(1200 + 1);
	// Height respects max-h:90vh.
	expect(box.height).toBeLessThanOrEqual(viewport.height * 0.9 + 1);
}

/**
 * Every button rendered inside the dialog must stay inside the dialog
 * bounds — both horizontally (the 375px footer overflow B4 targets)
 * and vertically (so a footer/toolbar clipped by the dialog's
 * `overflow-hidden` is caught instead of silently passing).
 */
async function assertFooterFitsDialog(dialog: import("@playwright/test").Locator) {
	const dialogBox = await dialog.boundingBox();
	expect(dialogBox).not.toBeNull();
	if (!dialogBox) return;

	// The submit text differs per dialog (发布主题 / 发送回复 / 保存)
	// so just match any button inside the dialog and check none extend
	// past the dialog box on either axis.
	// Tolerance: 4px accounts for sub-pixel rounding differences across
	// runs (flexbox gap + justify-end can shift by 1-3px depending on
	// fractional layout). The original B4 regression was 20+ px overflow,
	// so 4px tolerance still catches real layout bugs.
	const TOLERANCE = 4;
	const buttons = dialog.locator("button");
	const count = await buttons.count();
	for (let i = 0; i < count; i++) {
		const btn = buttons.nth(i);
		const btnBox = await btn.boundingBox();
		if (!btnBox) continue;
		// Horizontal containment.
		expect(btnBox.x).toBeGreaterThanOrEqual(dialogBox.x - TOLERANCE);
		expect(btnBox.x + btnBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + TOLERANCE);
		// Vertical containment — catches footer/toolbar clipped by
		// `overflow-hidden` on the dialog content.
		expect(btnBox.y).toBeGreaterThanOrEqual(dialogBox.y - TOLERANCE);
		expect(btnBox.y + btnBox.height).toBeLessThanOrEqual(
			dialogBox.y + dialogBox.height + TOLERANCE,
		);
	}
}

test.describe("E2E-DL: Dialog layout (B4)", () => {
	test("E2E-DL-01: new-thread dialog fits desktop and 375px viewports", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		const forumPage = new ForumPage(page);
		await forumPage.goto(FORUM_ID);

		// Desktop pass
		await page.setViewportSize(DESKTOP);
		await forumPage.newThreadButton.click();
		const dialog = page.locator('[data-slot="dialog-content"]');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByText("发表新帖")).toBeVisible();
		await assertDialogFitsViewport(dialog, DESKTOP);
		await assertFooterFitsDialog(dialog);

		// Narrow pass — same dialog, just resize the window.
		// Use toPass() to retry until CSS media queries settle after resize.
		await page.setViewportSize(NARROW);
		await expect(async () => {
			await assertDialogFitsViewport(dialog, NARROW);
		}).toPass({ timeout: 5000 });
		await assertFooterFitsDialog(dialog);

		// Close with Cancel so we don't pollute server state.
		await dialog.getByRole("button", { name: /取消/ }).click();
		await expect(dialog).not.toBeVisible();
	});

	test("E2E-DL-02: reply dialog fits desktop and 375px viewports + smiley popover opens", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");

		const threadPage = new ThreadPage(page);
		await threadPage.goto(THREAD_ID);

		await page.setViewportSize(DESKTOP);
		await threadPage.replyButton.click();
		const dialog = page.locator('[data-slot="dialog-content"]');
		await expect(dialog).toBeVisible();
		await assertDialogFitsViewport(dialog, DESKTOP);
		await assertFooterFitsDialog(dialog);

		// Single emoji toolbar entry — `UnifiedEmojiPicker` (Forum +
		// Emoji + Recent), named "插入表情" (aria-label + tooltip).
		const smileyTrigger = dialog.getByRole("button", { name: "插入表情" });
		await expect(smileyTrigger).toBeVisible();
		await smileyTrigger.click();
		// Popover content lives outside the dialog (Portal). The forum
		// tab is the default landing view, so its pack labels
		// 默认 / 酷猴 / 兔斯基 must be visible immediately.
		await expect(page.getByText("酷猴", { exact: true }).first()).toBeVisible({
			timeout: 5000,
		});
		// Close popover by pressing Escape so the dialog itself stays open.
		await page.keyboard.press("Escape");

		// Narrow pass.
		// Use toPass() to retry until CSS media queries settle after resize.
		await page.setViewportSize(NARROW);
		await expect(async () => {
			await assertDialogFitsViewport(dialog, NARROW);
		}).toPass({ timeout: 5000 });
		await assertFooterFitsDialog(dialog);

		await dialog.getByRole("button", { name: /取消/ }).click();
		await expect(dialog).not.toBeVisible();
	});
});
