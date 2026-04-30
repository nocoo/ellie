import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"server-only": resolve(__dirname, "../../tests/stubs/server-only.ts"),
		},
	},
	test: {
		name: "worker",
		root: __dirname,
		include: ["tests/**/*.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.d.ts"],
			thresholds: {
				statements: 70,
				lines: 70,
				functions: 70,
				branches: 60,
			},
		},
	},
});
