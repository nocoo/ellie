import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "types",
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
			exclude: ["src/**/*.d.ts", "src/index.ts", "src/types.ts", "src/version.ts"],
			thresholds: {
				statements: 80,
				lines: 80,
				functions: 80,
				branches: 80,
			},
		},
	},
});
