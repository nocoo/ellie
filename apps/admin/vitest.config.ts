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
		name: "admin",
		root: __dirname,
		allowOnly: false,
		passWithNoTests: false,
		pool: "threads",
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/lib/**/*.ts", "src/viewmodels/**/*.ts"],
			exclude: ["src/**/*.d.ts", "src/components/**", "src/app/**", "src/lib/version.ts"],
			thresholds: {
				statements: 90,
				lines: 90,
				functions: 90,
				branches: 85,
			},
		},
	},
});
