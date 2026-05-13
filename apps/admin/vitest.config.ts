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
		pool: "threads",
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/lib/**/*.ts", "src/viewmodels/**/*.ts"],
			exclude: ["src/**/*.d.ts", "src/components/**", "src/app/**"],
			thresholds: {
				statements: 95,
				lines: 95,
				functions: 95,
				branches: 90,
			},
		},
	},
});
