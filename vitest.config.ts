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
		include: [
			"tests/unit/**/*.test.ts",
			"apps/worker/tests/**/*.test.ts",
			"apps/admin/tests/**/*.test.ts",
		],
		exclude: [
			"tests/unit/loader.test.ts",
			"tests/unit/verify.test.ts",
			"tests/unit/proxy.test.ts",
			"tests/unit/auth-callbacks.test.ts",
			"tests/unit/hooks/use-is-mobile.test.ts",
			"tests/unit/hooks/use-theme.test.ts",
		],
		environment: "node",
		coverage: {
			provider: "v8",
			include: [
				"apps/web/src/**/*.ts",
				"apps/web/src/**/*.tsx",
				"apps/worker/src/**/*.ts",
				"packages/*/src/**/*.ts",
			],
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
				"packages/cli/**",
				"packages/db/**",
				"packages/migrate/**",
			],
			thresholds: {
				lines: 49,
				functions: 42,
				branches: 45,
			},
		},
	},
});
