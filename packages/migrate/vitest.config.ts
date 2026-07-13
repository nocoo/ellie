import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "migrate",
		root: __dirname,
		pool: "threads",
		isolate: false,
		include: ["tests/**/*.test.ts"],
		passWithNoTests: true,
		environment: "node",
		// Migrate tests spawn bun subprocesses via execSync (30s internal timeout).
		// Vitest's 5s test / 10s hook defaults get eaten by bun cold-start under
		// parallel workspace load — raise both above the execSync ceiling so the
		// subprocess-side timeout is the one that fires.
		testTimeout: 60_000,
		hookTimeout: 60_000,
		coverage: {
			provider: "v8",
			include: ["src/extract/**/*.ts", "src/transform/**/*.ts"],
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
