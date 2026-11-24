import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "test-mocks",
		root: __dirname,
		allowOnly: false,
		pool: "threads",
		isolate: false,
		include: ["tests/**/*.test.ts"],
		passWithNoTests: false,
		environment: "node",
	},
});
