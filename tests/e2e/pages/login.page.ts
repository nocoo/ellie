// tests/e2e/pages/login.page.ts — LoginPage Page Object
// Ref: docs/e2e-test-design.md §E2E-AU specs

import type { Page } from "@playwright/test";
import { FORM } from "../fixtures/selectors";

export class LoginPage {
	constructor(private page: Page) {}

	async goto() {
		await this.page.goto("/login");
		await this.page.waitForLoadState("load");
	}

	/** Username input field */
	get usernameInput() {
		return this.page.locator(FORM.usernameInput);
	}

	/** Password input field */
	get passwordInput() {
		return this.page.locator(FORM.passwordInput);
	}

	/** Submit button */
	get submitButton() {
		return this.page.locator(FORM.submitButton);
	}

	/** Error message display */
	get errorMessage() {
		return this.page.locator('[data-testid="error-message"], .text-destructive');
	}

	/** Fill username field */
	async fillUsername(username: string) {
		await this.usernameInput.fill(username);
	}

	/** Fill password field */
	async fillPassword(password: string) {
		await this.passwordInput.fill(password);
	}

	/** Fill both fields */
	async fillCredentials(username: string, password: string) {
		await this.fillUsername(username);
		await this.fillPassword(password);
	}

	/** Submit the login form (waits for CAPTCHA to solve and button to enable). */
	async submit() {
		await this.submitButton.waitFor({ state: "visible" });
		await this.page.waitForFunction(
			(sel) => {
				const btn = document.querySelector(sel) as HTMLButtonElement | null;
				return btn !== null && !btn.disabled;
			},
			FORM.submitButton,
			{ timeout: 20_000 },
		);
		await this.submitButton.click();
	}

	/**
	 * Login with given credentials and wait for redirect
	 * @deprecated Use the `loginAs` fixture from fixtures/base.ts instead
	 */
	async login(username: string, password: string) {
		await this.fillCredentials(username, password);
		await this.submit();
		await this.page.waitForURL((url) => !url.pathname.includes("/login"), {
			timeout: 10000,
		});
	}
}
