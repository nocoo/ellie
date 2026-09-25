/**
 * scripts/lib/test-worker-vars — single source of truth for `--var` clauses
 * injected into local test workers (L2 / L3 / L3-admin).
 *
 * Pure data + no Bun imports so vitest (Node) can import it as well as the
 * Bun-only runner code in local-worker.ts.
 *
 * IMPORTANT: TEST_WORKER_VARS must include ENVIRONMENT:test and
 * ALLOWED_ORIGINS:*. Without them the worker falls back to the prod
 * \[vars\] block in apps/worker/wrangler.toml, which:
 *   - leaves \`env.ENVIRONMENT === "production"\` (D1 isolation guard
 *     fails; \`/api/live\` reports the wrong env);
 *   - restricts CORS to https://ellie.worker.hexly.ai (local test
 *     requests get blocked).
 * The legacy run-l2.ts:149 only injected API_KEY/ADMIN_API_KEY/JWT_SECRET
 * — this helper closes that gap.
 *
 * See docs/23-local-test-stack.md §2.5 (review v4 #1).
 */

export const TEST_WORKER_VARS: Readonly<Record<string, string>> = Object.freeze({
	API_KEY: "test-api-key",
	ADMIN_API_KEY: "test-admin-api-key",
	JWT_SECRET: "test-secret-key-for-jwt-hs256",
	WEB_STATISTICS_WRITE_KEY: "test-web-statistics-write-key",
	// Required: overrides prod [vars] in apps/worker/wrangler.toml so the
	// worker runs in test mode (D1 isolation guard, /api/live reporting,
	// any handler reading env.ENVIRONMENT).
	ENVIRONMENT: "test",
	// Required: overrides prod ALLOWED_ORIGINS so local L2/L3 requests
	// don't get blocked by CORS.
	ALLOWED_ORIGINS: "*",
	// Dove integration is mocked in tests but injecting a placeholder var
	// avoids any "missing var" warnings in worker boot logs.
	DOVE_WEBHOOK_TOKEN: "test-token-not-real",
});

export async function seedDailyStatistics(baseUrl: string): Promise<void> {
	const url = new URL(baseUrl);
	if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
		throw new Error("Local statistics fixture requires loopback");
	const response = await fetch(new URL("/api/internal/statistics/snapshot", url), {
		method: "POST",
		headers: { "X-Ellie-Statistics-Key": TEST_WORKER_VARS.WEB_STATISTICS_WRITE_KEY },
		signal: AbortSignal.timeout(10_000),
	});
	if (!response.ok) throw new Error(`Local daily statistics seed failed: ${response.status}`);
	await response.body?.cancel();
}
