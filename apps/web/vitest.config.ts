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
		passWithNoTests: true,
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
				statements: 0,
				lines: 0,
				functions: 0,
				branches: 0,
			},
		},
	},
});
