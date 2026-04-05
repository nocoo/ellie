// tests/integration/preload.ts — Global setup/teardown for L2 tests
// Automatically starts the Worker before any integration test runs.

import { afterAll, beforeAll } from "bun:test";
import { startWorker, stopWorker } from "./setup";

beforeAll(async () => {
	await startWorker();
});

afterAll(async () => {
	await stopWorker();
});
