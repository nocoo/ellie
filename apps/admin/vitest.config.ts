import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
		},
	},
	test: {
		name: "admin",
		root: __dirname,
		include: ["tests/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/lib/**/*.ts", "src/viewmodels/**/*.ts", "src/hooks/**/*.ts", "src/auth.ts"],
			exclude: ["src/**/*.d.ts", "src/components/**", "src/app/**"],
			thresholds: {
				statements: 0,
				lines: 0,
				functions: 0,
				branches: 0,
			},
		},
	},
});
