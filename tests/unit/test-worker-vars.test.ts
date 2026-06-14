import { describe, expect, test } from "vitest";
import { TEST_WORKER_VARS } from "../../scripts/lib/test-worker-vars";

describe("TEST_WORKER_VARS", () => {
	test("includes the keys required for D1 isolation + CORS", () => {
		// These two MUST be present — without them the worker falls back to
		// prod [vars] (ENVIRONMENT=production / ALLOWED_ORIGINS pointing at
		// the prod domain) and L2/L3 D1 isolation guards fail. See
		// docs/23-local-test-stack.md §2.5 review v4 #1.
		expect(TEST_WORKER_VARS.ENVIRONMENT).toBe("test");
		expect(TEST_WORKER_VARS.ALLOWED_ORIGINS).toBe("*");
	});

	test("includes the API keys + JWT secret used by tests/integration/setup.ts", () => {
		expect(TEST_WORKER_VARS.API_KEY).toBe("test-api-key");
		expect(TEST_WORKER_VARS.ADMIN_API_KEY).toBe("test-admin-api-key");
		expect(TEST_WORKER_VARS.JWT_SECRET).toBe("test-secret-key-for-jwt-hs256");
	});

	test("placeholder Dove token is set so worker boot logs stay clean", () => {
		expect(TEST_WORKER_VARS.DOVE_WEBHOOK_TOKEN).toBe("test-token-not-real");
	});

	test("frozen so callers can't mutate the shared object", () => {
		expect(Object.isFrozen(TEST_WORKER_VARS)).toBe(true);
	});
});
