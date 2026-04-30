import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "apps/web/src"),
			"server-only": resolve(__dirname, "tests/stubs/server-only.ts"),
		},
	},
	test: {
		pool: "threads",
		isolate: false,
		projects: [
			"apps/worker",
			"apps/web",
			"apps/admin",
			"packages/shared",
			"packages/test-mocks",
			{
				extends: true,
				test: {
					name: "root",
					include: ["tests/unit/**/*.test.ts"],
					exclude: ["tests/unit/loader.test.ts", "tests/unit/verify.test.ts"],
					environment: "node",
				},
			},
		],
	},
});
