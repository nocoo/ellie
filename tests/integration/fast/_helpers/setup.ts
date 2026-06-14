/**
 * tests/integration/fast/_helpers/setup — auto-import in any *.fast.test.ts
 * to register the per-test ctx lifecycle.
 *
 * Usage:
 *   import "./_helpers/setup";  // top of the file
 *
 * This installs beforeEach/afterEach that capture and drain the worker's
 * waitUntil promises, so background errors don't disappear silently.
 */

import { afterEach, beforeEach } from "bun:test";
import { flushCurrentTestCtx, setCurrentTestCtx } from "./env";

beforeEach(() => {
	setCurrentTestCtx();
});

afterEach(async () => {
	await flushCurrentTestCtx();
});
