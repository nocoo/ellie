import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

process.env.PBKDF2_ITERATIONS = process.env.PBKDF2_ITERATIONS || "1000";

export default defineConfig({
	resolve: {
		alias: {
			"server-only": resolve(__dirname, "../../tests/stubs/server-only.ts"),
		},
	},
	test: {
		name: "worker",
		root: __dirname,
		pool: "threads",
		include: ["tests/**/*.test.ts"],
		// *.bun.test.ts use bun:sqlite / bun:test and run under `bun test`,
		// not vitest. See apps/worker/tests/unit/test-support/d1-shim.bun.test.ts.
		exclude: ["tests/**/*.bun.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: [
				"src/**/*.d.ts",
				// Test-only adapters that run under `bun test`, not vitest.
				// See apps/worker/src/test-support/d1-shim.ts (uses bun:sqlite).
				"src/test-support/d1-shim.ts",
				// Auto-generated SQL constant for L2-fast; equivalence checked by
				// tests/unit/init-sql-equiv.test.ts (Phase A5) against wrangler.
				"src/test-support/init-sql.generated.ts",
			],
			thresholds: {
				statements: 95,
				lines: 95,
				functions: 95,
				branches: 90,
			},
		},
	},
});
