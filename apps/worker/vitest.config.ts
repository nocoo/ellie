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
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
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
