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
		// These suites use the bun:test runner (mock.module, fast crypto, or
		// global fetch stubbing) and run via
		// `bun test`; exclude them from vitest to avoid `Cannot find package
		// 'bun:test'` failures during the `bunx vitest run` gate.
		exclude: [
			"tests/unit/handlers/email.test.ts",
			"tests/unit/lib/dove.test.ts",
			"tests/unit/lib/email-verify.test.ts",
		],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			// Excluded source modules are covered by the bun:test lane. They use
			// bun-native APIs such as `mock.module` (or globalThis.fetch stubs)
			// that vitest's runner cannot execute, so vitest never imports them and
			// v8 coverage would otherwise count them as 0% in the denominator.
			//
			// Hook / runner coverage map for the excluded files:
			//   - dove.ts, email-verify.ts, handlers/email.ts
			//       → covered by `.husky/pre-push` bun_tests list AND by
			//         `scripts/run-tests.sh` (= `bun run test`).
			//
			// Tech debt: pre-commit currently does NOT run the bun:test lane —
			// only pre-push does. Tracked as follow-up to unify hook semantics
			// (see docs/17 §12 review thread, path A1-).
			exclude: [
				"src/**/*.d.ts",
				"src/lib/dove.ts",
				"src/lib/email-verify.ts",
				"src/handlers/email.ts",
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
