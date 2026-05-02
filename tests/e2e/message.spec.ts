// tests/e2e/message.spec.ts — E2E-MS Message Flow Tests
// Covers: messages module breadth (inbox loads, compose dialog opens)

import { expect, test } from "./fixtures/base";
import { MessagePage } from "./pages/message.page";

test.describe("E2E-MS: Message Flow", () => {
	/**
	 * E2E-MS-01: Messages Inbox Loads
	 * Given I am logged in
	 * When I navigate to /messages
	 * Then I should see "站内信" heading
	 * And I should see message list or empty state
	 */
	test("E2E-MS-01: messages inbox loads with heading", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const messagePage = new MessagePage(page);
		await messagePage.goto();

		// Should have "站内信" heading
		await expect(messagePage.heading).toContainText("站内信");

		// Should have messages or empty state
		const hasMessages = await messagePage.messageItems
			.first()
			.isVisible()
			.catch(() => false);
		const hasEmpty = await messagePage.emptyState.isVisible().catch(() => false);
		expect(hasMessages || hasEmpty).toBe(true);
	});

	/**
	 * E2E-MS-02: Compose Dialog Opens
	 * Given I am on /messages
	 * When I click "写站内信" button
	 * Then compose dialog should open
	 */
	test("E2E-MS-02: compose dialog opens", async ({ page, loginAs }) => {
		await loginAs("e2etest");

		const messagePage = new MessagePage(page);
		await messagePage.goto();

		// Click compose button
		await messagePage.composeButton.click();

		// Dialog should be visible
		await expect(messagePage.composeDialog).toBeVisible();
	});
});
