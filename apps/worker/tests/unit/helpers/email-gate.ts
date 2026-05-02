// Shared helpers for docs/17 §5.4 email-verification gate regression tests.
//
// These helpers exist so each migrated write route can assert "unverified user
// → 403 + flat EMAIL_NOT_VERIFIED_PAYLOAD" without duplicating boilerplate.
// They deliberately do NOT mock the business SQL — the auth middleware should
// short-circuit before any business query runs, and we assert that by counting
// DB calls.

import { EMAIL_NOT_VERIFIED_PAYLOAD } from "@ellie/types";
import { expect } from "vitest";
import { createJwtForRole, createMockDb, makeEnv } from "../../helpers";

/**
 * Build an env where the auth row exists, role is regular User, status is OK,
 * but `email_verified_at` is the unverified sentinel `0`. Any write route
 * gated by `requireVerifiedEmail` / `withVerifiedEmail` MUST reject with the
 * §5.4 flat payload, before touching any business SQL.
 */
export function makeUnverifiedEnv(userId = 1) {
	const { db, calls } = createMockDb({
		firstResults: {
			// Matches BOTH the new `SELECT role, status, email_verified_at FROM users`
			// query (after Phase 5b) and the legacy `SELECT role, status FROM users`
			// query (other middlewares). The substring `"SELECT role, status"` is the
			// minimal common prefix; the extra `email_verified_at` field is harmless
			// for the legacy callers.
			"SELECT role, status": { role: 0, status: 0, email_verified_at: 0 },
		},
	});
	return { env: makeEnv({ DB: db }), calls, userId };
}

/**
 * Assert that a Response is the canonical docs/17 §5.4 EmailNotVerifiedPayload.
 * Use this in every migrated-route regression test so a future regression to
 * the wrapped `errorResponse` shape (or a route accidentally being switched
 * back to `withAuthVerified`) fails loudly.
 */
export async function expectEmailNotVerifiedResponse(response: Response): Promise<void> {
	expect(response.status).toBe(403);
	const data = await response.json();
	expect(data).toEqual(EMAIL_NOT_VERIFIED_PAYLOAD);
}

/**
 * Convenience: build a JWT for a regular user. Re-export for tests that only
 * need the unverified path without importing the full helpers module.
 */
export async function unverifiedUserJwt(userId = 1): Promise<string> {
	return createJwtForRole(0, userId);
}
