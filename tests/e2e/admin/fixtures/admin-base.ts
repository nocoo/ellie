// tests/e2e/admin/fixtures/admin-base.ts — Admin Playwright fixtures
//
// Provides `loginAsAdmin(email?)` which mints an Auth.js v5 session JWT using
// the same `@auth/core/jwt` encode() the admin app uses to verify, then sets
// it as the `authjs.session-token` cookie on the test browser context.
//
// Why this approach (vs filling Google OAuth or adding a /api/test-login):
//   - Admin uses Google OAuth + ADMIN_EMAILS whitelist; OAuth flow is not
//     scriptable in CI without real Google credentials.
//   - A dev-only test-login route adds a permanent prod attack surface even
//     under NODE_ENV gating. Cookie injection happens entirely in the test
//     runner process — no admin source code change required.
//   - Same `AUTH_SECRET` + same `salt = "authjs.session-token"` => the gate
//     decodes our cookie identically to a real Google sign-in session.
//
// Hard guards (raised before the fixture mints a cookie):
//   - NODE_ENV must be "test"
//   - AUTH_SECRET must be set
//   - The chosen email must be in ADMIN_EMAILS (otherwise the gate would
//     redirect and the test would fail with a confusing message)

import { encode } from "@auth/core/jwt";
import { test as base } from "@playwright/test";

const SESSION_COOKIE_NAME = "authjs.session-token"; // Auth.js v5 default (HTTP)
const DEFAULT_TEST_ADMIN_EMAIL = "e2e-admin@test.local";
const SESSION_MAX_AGE_S = 60 * 60; // 1h is plenty for a test run

export interface AdminTestFixtures {
	/**
	 * Mint an Auth.js v5 session JWT for the given email and inject it as the
	 * session cookie on the active browser context. After this resolves, the
	 * page can navigate to /admin and the layout gate will accept the session.
	 *
	 * If `email` is omitted, uses E2E_ADMIN_EMAIL or the built-in default.
	 * The email must be in ADMIN_EMAILS for the gate to allow access — pass an
	 * out-of-whitelist email to test the deny path.
	 */
	loginAsAdmin: (email?: string) => Promise<void>;
}

function readWhitelist(): Set<string> {
	return new Set(
		(process.env.ADMIN_EMAILS ?? "")
			.split(",")
			.map((e) => e.trim().toLowerCase())
			.filter(Boolean),
	);
}

function assertTestEnvironment(): { secret: string } {
	if (process.env.NODE_ENV !== "test") {
		throw new Error(
			`loginAsAdmin requires NODE_ENV=test, got "${process.env.NODE_ENV}". This fixture must never run in dev or prod.`,
		);
	}
	const secret = process.env.AUTH_SECRET;
	if (!secret) {
		throw new Error("loginAsAdmin requires AUTH_SECRET to be set (same value as the admin app).");
	}
	return { secret };
}

export const test = base.extend<AdminTestFixtures>({
	loginAsAdmin: async ({ context, baseURL }, use) => {
		const loginAsAdmin = async (emailArg?: string) => {
			const { secret } = assertTestEnvironment();

			const email = (emailArg ?? process.env.E2E_ADMIN_EMAIL ?? DEFAULT_TEST_ADMIN_EMAIL).trim();
			// Inject the cookie regardless of whitelist membership — passing an
			// out-of-whitelist email is the supported deny-path test. We only
			// warn (don't throw) if the caller asked for an email that the gate
			// will reject; that's by design.
			if (!emailArg) {
				const whitelist = readWhitelist();
				if (!whitelist.has(email.toLowerCase())) {
					throw new Error(
						`Default test admin email "${email}" is not in ADMIN_EMAILS. Add it to .env.test or pass an email explicitly.`,
					);
				}
			}

			const now = Math.floor(Date.now() / 1000);
			const token = await encode({
				secret,
				salt: SESSION_COOKIE_NAME,
				maxAge: SESSION_MAX_AGE_S,
				token: {
					// Mirror the shape Auth.js writes for a Google sign-in (see
					// apps/admin/src/auth.ts jwtCallback): sub/email/name/picture.
					sub: `e2e-${email}`,
					email,
					name: "E2E Admin",
					picture: undefined,
					iat: now,
					exp: now + SESSION_MAX_AGE_S,
					jti: `e2e-${now}-${Math.random().toString(36).slice(2, 10)}`,
				},
			});

			// Use Playwright's `url` form rather than hand-setting `domain` —
			// it sidesteps localhost domain quirks and lets Playwright derive
			// host/port/path itself. baseURL is set per-project in
			// playwright.config.ts → admin → http://localhost:7032.
			const cookieUrl = baseURL ?? "http://localhost:7032";
			await context.addCookies([
				{
					name: SESSION_COOKIE_NAME,
					value: token,
					url: cookieUrl,
					httpOnly: true,
					sameSite: "Lax",
					secure: false, // dev server is HTTP
					expires: now + SESSION_MAX_AGE_S,
				},
			]);
		};
		await use(loginAsAdmin);
	},
});

export { expect } from "@playwright/test";
