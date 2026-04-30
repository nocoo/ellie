import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"server-only": resolve(__dirname, "../../tests/stubs/server-only.ts"),
		},
	},
	test: {
		name: "web",
		root: __dirname,
		include: ["tests/**/*.test.ts"],
		exclude: ["tests/unit/lib/avatar.test.ts", "tests/unit/lib/avatar-proxy.test.ts"],
		environment: "node",
		coverage: {
			provider: "v8",
			include: [
				"src/lib/**/*.ts",
				"src/viewmodels/**/*.ts",
				"src/hooks/**/*.ts",
				"src/auth.ts",
				"src/proxy.ts",
			],
			exclude: [
				"src/**/*.d.ts",
				"src/components/**",
				"src/app/**",
				"src/contexts/**",
				"src/actions/**",
			],
			thresholds: {
				statements: 45,
				lines: 45,
				functions: 40,
				branches: 40,
			},
		},
	},
});
