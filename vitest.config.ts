import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "apps/web/src"),
		},
	},
	test: {
		include: ["tests/unit/**/*.test.ts"],
		setupFiles: ["./tests/setup.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: ["apps/web/src/**/*.ts", "apps/web/src/**/*.tsx", "packages/*/src/**/*.ts"],
			exclude: [
				"**/node_modules/**",
				"**/.next/**",
				"**/dist/**",
				"apps/web/src/app/**/page.tsx",
				"apps/web/src/app/**/layout.tsx",
				"apps/web/src/components/ui/**",
				"scripts/**",
				"tests/**",
				"packages/types/**",
			],
			thresholds: {
				lines: 90,
				functions: 90,
				branches: 80,
			},
		},
	},
});
