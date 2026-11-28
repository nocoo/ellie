import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"server-only": resolve(__dirname, "../../tests/stubs/server-only.ts"),
		},
	},
	test: {
		name: "web",
		root: __dirname,
		allowOnly: false,
		pool: "threads",
		isolate: true,
		include: ["tests/**/*.test.{ts,tsx}"],
		exclude: [],
		passWithNoTests: false,
		environment: "node",
		setupFiles: ["./tests/setup.ts"],
		coverage: {
			provider: "v8",
			include: [
				"src/lib/**/*.ts",
				"src/viewmodels/**/*.ts",
				"src/hooks/**/*.ts",
				"src/auth.ts",
				"src/proxy.ts",
			],
			exclude: [
				"src/**/*.d.ts",
				"src/components/**",
				"src/app/**",
				"src/contexts/**",
				"src/actions/**",
				"src/lib/version.ts",
				"src/viewmodels/shared/breadcrumbs.ts",
			],
			thresholds: {
				statements: 90,
				lines: 90,
				functions: 90,
				branches: 85,
			},
		},
	},
});
