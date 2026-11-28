import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "shared",
		root: __dirname,
		allowOnly: false,
		pool: "threads",
		isolate: false,
		include: ["tests/**/*.test.ts"],
		passWithNoTests: false,
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.d.ts", "src/index.ts"],
			thresholds: {
				statements: 90,
				lines: 90,
				functions: 90,
				branches: 85,
			},
		},
	},
});
