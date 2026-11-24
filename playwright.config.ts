// playwright.config.ts — E2E test configuration
// Ref: docs/e2e-test-design.md §Port Convention, §Test Isolation Strategy

import { defineConfig, devices } from "@playwright/test";

const PORT = 27031; // BDD E2E port (dev + 20000)
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: "tests/e2e",
	forbidOnly: !!process.env.CI,
	retries: 1,
	workers: 2,
	reporter: "html",

	// Per-test timeout. Default (30s) is not enough for the auth specs: the
	// Cap.js auto-PoW takes up to 60 s on the free GitHub runner, and the
	// loginAs fixture waits for the submit button to enable before clicking.
	// 90 s leaves headroom for that wait + the NextAuth credentials callback
	// + first-compile navigation, while still cutting off true hangs.
	timeout: 90_000,

	expect: {
		// Match CI's 15s expect.timeout in local runs too. The prior 5s value
		// was a fast-feedback default for individual devs running a single spec,
		// but the autoresearch loop (and `bun run test:e2e:browser`) executes the
		// full suite against a Turbopack dev server, where the first paint after
		// a route compile can legitimately take 6–12s. With 5s we flake on every
		// full run; with 15s the suite is stable and we still surface real
		// product regressions because the *navigation* timeout (30s) is what
		// catches genuine hangs.
		timeout: 15_000,
	},

	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
		locale: "zh-CN",
		timezoneId: "Asia/Shanghai",
		navigationTimeout: 30_000,
	},

	// ---------------------------------------------------------------------------
	// Projects: stateless (parallel within file) vs stateful (sequential)
	//           vs admin (separate dev server on 7032, own runner)
	//
	// Stage 2 of the L3 → BDD migration (docs/23 §4.1 / §4.2 / §7.2): all
	// legacy specs have been deleted, so each project's testMatch now pins
	// the exact BDD filenames it owns. The forum runner passes --project=
	// stateless / stateful / mobile; the admin runner passes --project=admin.
	// The four projects remain strictly non-overlapping by construction.
	//   - stateless: bdd/auth, bdd/navigation, bdd/search, bdd/system, bdd/legacy-colors.
	//     The four legacy stateless-only specs (pagination, digest-filter,
	//     message, user-journey) merged into bdd/content + bdd/social and
	//     therefore moved to the stateful project — docs/23 §4.1 records the
	//     tradeoff (semantic grouping > per-file parallelism under workers=1).
	//   - stateful: bdd/content, bdd/social (CRUD scenarios use describe.serial).
	//   - mobile:   bdd/mobile.
	//   - admin:    testDir collapsed back to tests/e2e/bdd/admin so the
	//               regex stays tight to BDD specs only.
	// ---------------------------------------------------------------------------
	projects: [
		{
			name: "stateless",
			testMatch: /\/bdd\/(auth|navigation|search|system)\.spec\.ts$/,
			fullyParallel: true, // Tests within same file can run in parallel
			use: { ...devices["Desktop Chrome"] },
		},
		{
			name: "stateful",
			testMatch: /\/bdd\/(content|social|editor|interactions)\.spec\.ts$/,
			fullyParallel: false,
			dependencies: ["stateless"], // Run after stateless completes
			use: { ...devices["Desktop Chrome"] },
		},
		{
			// Mobile layout drift guard — iPhone-targeted polish (msg=037192fa).
			// Runs only `bdd/mobile.spec.ts`. Explicit allowlist guarantees
			// that desktop-only specs cannot accidentally run inside a 390×844
			// viewport, and the dedicated project name lets `run-l3.ts` opt-in
			// the gate without affecting `--project=admin`. Default mobile
			// device is iPhone 14 (390×844); the spec itself iterates through
			// 375 / 390 widths via `page.setViewportSize`.
			name: "mobile",
			testMatch: /\/bdd\/mobile\.spec\.ts$/,
			fullyParallel: false,
			dependencies: ["stateful"],
			use: { ...devices["iPhone 14"], browserName: "chromium" },
		},
		{
			// Admin specs live under tests/e2e/bdd/admin/. They target apps/admin
			// on port 7032 and are run only by scripts/run-l3-admin.ts; the forum
			// runner passes --project=stateless / --project=stateful / --project=mobile
			// so this `admin` project never executes against the forum dev server.
			name: "admin",
			testDir: "tests/e2e/bdd/admin",
			testMatch: /.*\.spec\.ts$/,
			fullyParallel: false,
			use: { ...devices["Desktop Chrome"], baseURL: "http://localhost:7032" },
		},
	],

	// Server lifecycle is managed by scripts/run-l3.ts (loads .env files,
	// validates D1 isolation, starts dev server with test env, runs Playwright,
	// tears down). Keeping it out of playwright.config.ts ensures CI gets
	// deterministic teardown and pre-flight env validation.
});
