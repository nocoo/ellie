// tests/e2e/pages/login.page.ts — LoginPage Page Object
// Ref: docs/e2e-test-design.md §E2E-AU specs

import type { Page } from "@playwright/test";

export class LoginPage {
	constructor(private page: Page) {}

	async goto() {
		await this.page.goto("/login");
		await this.page.waitForLoadState("networkidle");
	}

	/** Username input field */
	get usernameInput() {
		return this.page.locator('input[id="username"]');
	}

	/** Password input field */
	get passwordInput() {
		return this.page.locator('input[id="password"]');
	}

	/** Submit button */
	get submitButton() {
		return this.page.locator('button[type="submit"]');
	}

	/** Error message display */
	get errorMessage() {
		return this.page.locator(".text-destructive");
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

	/** Submit the login form */
	async submit() {
		await this.submitButton.click();
	}

	/** Login with given credentials and wait for redirect */
	async login(username: string, password: string) {
		await this.fillCredentials(username, password);
		await this.submit();
		await this.page.waitForURL((url) => !url.pathname.includes("/login"), {
			timeout: 10000,
		});
	}
}
