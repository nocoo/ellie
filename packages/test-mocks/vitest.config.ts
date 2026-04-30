import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "test-mocks",
		root: __dirname,
		include: ["tests/**/*.test.ts"],
		passWithNoTests: true,
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.d.ts", "src/index.ts"],
			thresholds: {
				statements: 0,
				lines: 0,
				functions: 0,
				branches: 0,
			},
		},
	},
});
