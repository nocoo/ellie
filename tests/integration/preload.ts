// tests/integration/preload.ts — Global preload for L2 tests.
//
// The Worker lifecycle is now owned by scripts/run-l2.ts (which boots
// `wrangler dev --local --persist-to .wrangler/state/e2e` with secrets
// injected via --var). This preload only needs to make sure the test
// client uses the same secret values when no environment override exists.

const TEST_DEFAULTS: Record<string, string> = {
	API_KEY: "test-api-key",
	ADMIN_API_KEY: "test-admin-api-key",
	JWT_SECRET: "test-secret-key-for-jwt-hs256",
};

for (const [key, value] of Object.entries(TEST_DEFAULTS)) {
	if (!process.env[key]) {
		process.env[key] = value;
	}
}
