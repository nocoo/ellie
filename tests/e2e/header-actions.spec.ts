// tests/e2e/header-actions.spec.ts — E2E-HA Header action elements.
//
// Stateless tests for header-region links/buttons that aren't covered by
// other specs:
//
//   • E2E-HA-01: header "精华帖" button on /forums/[id] navigates to /digest
//   • E2E-HA-02: header message-badge icon on home navigates to /messages
//   • E2E-HA-03: site footer is present on / and renders ©copyright text
//   • E2E-HA-04: forum new-thread button on /forums/[id] opens the dialog
//     (lighter-touch counterpart of E2E-DL-01 — single viewport, no layout
//     measurement, so faster and complements the dialog-layout suite)

import { expect, test } from "./fixtures/base";
import { FORUM } from "./fixtures/selectors";

const POPULATED_FORUM_ID = 114;

test.describe("E2E-HA: Header / footer action elements", () => {
	test("E2E-HA-01: header 精华帖 button on a forum page navigates to /digest", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		// The header renders a "精华帖" button inside a <Link href="/digest">.
		// Match the anchor wrapper or the inline button text.
		const digestLink = page.locator('a[href="/digest"]:has-text("精华帖")').first();
		await expect(digestLink).toBeVisible({ timeout: 15_000 });

		await digestLink.click();
		await page.waitForURL((url) => url.pathname.startsWith("/digest"), { timeout: 15_000 });
		expect(new URL(page.url()).pathname).toMatch(/^\/digest/);
	});

	test("E2E-HA-02: header message-badge icon on / navigates to /messages", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.goto("/");

		// MessageBadgeIcon renders a Link to /messages with an icon. Use the
		// first matching anchor inside the header.
		const messagesLink = page.locator('header a[href="/messages"], a[href="/messages"]').first();
		await expect(messagesLink).toBeVisible({ timeout: 15_000 });

		await messagesLink.click();
		await page.waitForURL((url) => url.pathname.startsWith("/messages"), { timeout: 15_000 });
		expect(new URL(page.url()).pathname).toMatch(/^\/messages/);
	});

	test("E2E-HA-03: site footer is present on / with copyright text", async ({ page, loginAs }) => {
		await loginAs("e2etest");
		await page.goto("/");

		const footer = page.locator("footer").first();
		await expect(footer).toBeVisible({ timeout: 15_000 });

		// SiteFooter always renders an &copy; line. The year text varies by
		// build, so use the universal © character + "All rights reserved" string.
		const copy = footer.getByText(/©|All rights reserved/);
		await expect(copy.first()).toBeVisible({ timeout: 5_000 });
	});

	test("E2E-HA-04: forum new-thread button opens the new-thread dialog", async ({
		page,
		loginAs,
	}) => {
		await loginAs("e2etest");
		await page.goto(`/forums/${POPULATED_FORUM_ID}`);

		const newThreadBtn = page.locator(FORUM.newThreadButton).first();
		await expect(newThreadBtn).toBeVisible({ timeout: 15_000 });

		await newThreadBtn.click();

		// Dialog opens — use the data-slot Radix exposes (same selector as
		// dialog-layout.spec.ts uses for layout assertions).
		const dialog = page.locator('[data-slot="dialog-content"]').first();
		await expect(dialog).toBeVisible({ timeout: 10_000 });

		// And the dialog header text is "发表新帖" (matches the button label).
		await expect(dialog.getByText("发表新帖").first()).toBeVisible();
	});
});
