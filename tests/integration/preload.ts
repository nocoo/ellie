// tests/integration/preload.ts — Global setup/teardown for L2 tests
// Automatically starts the dev server before any integration test runs.

import { afterAll, beforeAll } from "bun:test";
import { startServer, stopServer } from "./setup";

beforeAll(async () => {
	await startServer();
});

afterAll(async () => {
	await stopServer();
});
