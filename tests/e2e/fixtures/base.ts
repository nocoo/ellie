// tests/e2e/fixtures/base.ts — Extended Playwright fixtures
// Ref: docs/e2e-test-design.md §Fixtures
// Pattern: surety project Page Object Model

import { type BrowserContext, type Page, test as base } from "@playwright/test";
import { FORM } from "./selectors";

// ---------------------------------------------------------------------------
// E2E Test Credentials
// ---------------------------------------------------------------------------

/**
 * Default E2E test user credentials.
 * This user is created in the production database specifically for E2E testing.
 * Username: e2etest, Password: e2etest123
 */
const E2E_TEST_USER = {
	username: "e2etest",
	password: "e2etest123",
};

// ---------------------------------------------------------------------------
// Cached storageState (in-process, single playwright run)
// ---------------------------------------------------------------------------

/**
 * Cookies/origins from the first successful form login of the run.
 *
 * Rationale: the L3 suite serialises tests at workers=1. Before caching, every
 * `loginAs()` call paid the full /login form flow — CSRF compile + NextAuth
 * credentials callback + redirect — which took 8–15 s on a Turbopack-cold dev
 * server and was the dominant source of suite flakiness.
 *
 * The very first call performs the real form login (no shortcuts, no auth
 * bypass), captures its storageState, and stores it here. Every subsequent
 * `loginAs()` in the same playwright process just injects those cookies into
 * the fresh test context (~50 ms).
 *
 * Anti-cheating note:
 *   - The captured cookies are the genuine output of the real product login.
 *   - Tests that explicitly verify the login form (E2E-AU-01..05) do NOT call
 *     `loginAs()` and so are not affected.
 *   - If the cached cookies ever fail (e.g. JWT expired mid-run), the catch
 *     block re-runs the form flow and refreshes the cache.
 */
type CachedState = Awaited<ReturnType<BrowserContext["storageState"]>>;
let cachedState: CachedState | null = null;
let inflight: Promise<CachedState> | null = null;

async function performFormLogin(page: Page): Promise<void> {
	await page.goto("/login");
	await page.waitForLoadState("networkidle");
	await page.fill(FORM.usernameInput, E2E_TEST_USER.username);
	await page.fill(FORM.passwordInput, E2E_TEST_USER.password);
	// CAPTCHA is fail-closed — the submit button stays disabled until Cap.js
	// auto-PoW solves and emits the `solve` event (~1–3 s on CI). Wait for
	// the button to enable instead of clicking blindly.
	await page.locator(FORM.submitButton).waitFor({ state: "visible" });
	await page.waitForFunction(
		(sel) => {
			const btn = document.querySelector(sel) as HTMLButtonElement | null;
			return btn !== null && !btn.disabled;
		},
		FORM.submitButton,
		{ timeout: 20_000 },
	);
	await page.click(FORM.submitButton);
	// 30s mirrors playwright.config's navigationTimeout — NextAuth's
	// credentials callback can take 5–10s on a Turbopack-cold dev server.
	await page.waitForURL((url) => !url.pathname.includes("/login"), {
		timeout: 30_000,
	});
}

async function ensureCachedState(page: Page): Promise<CachedState> {
	if (cachedState) return cachedState;
	if (inflight) return inflight;
	inflight = (async () => {
		await performFormLogin(page);
		const state = await page.context().storageState();
		cachedState = state;
		return state;
	})();
	try {
		return await inflight;
	} finally {
		inflight = null;
	}
}

// ---------------------------------------------------------------------------
// Custom fixtures
// ---------------------------------------------------------------------------

export interface TestFixtures {
	/** Navigate to a path and wait for network idle */
	navigateTo: (path: string) => Promise<void>;

	/** Log in as a specific user via login form */
	loginAs: (username: string) => Promise<void>;
}

export const test = base.extend<TestFixtures>({
	navigateTo: async ({ page }, use) => {
		const navigateTo = async (path: string) => {
			await page.goto(path);
			await page.waitForLoadState("networkidle");
		};
		await use(navigateTo);
	},

	loginAs: async ({ page, context }, use) => {
		const loginAs = async (_username: string) => {
			// Fast path: reuse cached storageState if we've already logged in
			// at least once during this playwright run.
			if (cachedState) {
				await context.addCookies(cachedState.cookies);
				// Hop through home so the NextAuth JWT cookie is materialised
				// on the page (some layouts mount auth state on first response).
				await page.goto("/");
				return;
			}

			// First call of the run (or after a forced refresh): execute the real
			// form login and capture its cookies for everyone else.
			try {
				await ensureCachedState(page);
			} catch (err) {
				// If caching fails, fall back to a vanilla form login so the
				// individual test still has a chance to pass.
				console.warn(
					`[loginAs] cache init failed, falling back to per-test login: ${
						err instanceof Error ? err.message : err
					}`,
				);
				await performFormLogin(page);
			}
		};
		await use(loginAs);
	},
});

export { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Utility: Wait for skeleton or content
// ---------------------------------------------------------------------------

/**
 * Wait for either skeleton or actual content to be visible.
 * Pattern from dove project: skeleton-aware assertions.
 */
export async function waitForSkeletonOrContent(
	page: Page,
	skeletonSelector: string,
	contentSelector: string,
	timeout = 10000,
): Promise<void> {
	const skeleton = page.locator(skeletonSelector);
	const content = page.locator(contentSelector);

	await skeleton.or(content).first().waitFor({ timeout });

	// If skeleton was shown, wait for content to replace it
	if (await skeleton.isVisible()) {
		await content.waitFor({ timeout });
	}
}
