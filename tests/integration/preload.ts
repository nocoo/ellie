// tests/integration/preload.ts — Global setup/teardown for L2 tests
// Automatically starts the Worker before any integration test runs.
// Also loads environment variables from .dev.vars to match Worker config.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll } from "bun:test";
import { startWorker, stopWorker } from "./setup";

// Load .dev.vars into process.env before tests run
// This ensures test API keys match what the Worker expects
function loadDevVars(): void {
	try {
		const devVarsPath = join(process.cwd(), ".dev.vars");
		const content = readFileSync(devVarsPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIndex = trimmed.indexOf("=");
			if (eqIndex === -1) continue;
			const key = trimmed.slice(0, eqIndex);
			const value = trimmed.slice(eqIndex + 1);
			// Only set if not already in environment (allow overrides)
			if (!process.env[key]) {
				process.env[key] = value;
			}
		}
		console.log("[L2] Loaded .dev.vars");
	} catch {
		console.warn("[L2] Warning: Could not load .dev.vars");
	}
}

loadDevVars();

beforeAll(async () => {
	await startWorker();
});

afterAll(async () => {
	await stopWorker();
});
