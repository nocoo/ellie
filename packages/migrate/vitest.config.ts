import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "migrate",
		root: __dirname,
		pool: "threads",
		isolate: false,
		include: ["tests/**/*.test.ts"],
		passWithNoTests: true,
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/extract/**/*.ts", "src/transform/**/*.ts"],
			exclude: ["src/**/*.d.ts"],
			thresholds: {
				statements: 95,
				lines: 95,
				functions: 95,
				branches: 90,
			},
		},
	},
});
