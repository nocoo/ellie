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
		chaiConfig: { includeStack: false, truncateThreshold: 200 },
		projects: [
			"apps/worker",
			"apps/web",
			"apps/admin",
			"packages/shared",
			"packages/test-mocks",
			"packages/types",
			"packages/migrate",
			{
				extends: true,
				test: {
					name: "root",
					include: ["tests/unit/**/*.test.ts"],
					exclude: [
						"tests/unit/loader.test.ts",
						"tests/unit/verify.test.ts",
						"tests/unit/migration-0029-schema.test.ts",
						"tests/unit/migration-0036-schema.test.ts",
						"tests/unit/migration-0037-schema.test.ts",
						"tests/unit/migration-0038-schema.test.ts",
						"tests/unit/migration-0039-schema.test.ts",
						"tests/unit/migration-0041-schema.test.ts",
					],
					environment: "node",
				},
			},
		],
	},
});
