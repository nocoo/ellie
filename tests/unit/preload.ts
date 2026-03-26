// tests/unit/preload.ts — Unit test preload
// Resets the singleton MockDataStore before each test file to ensure
// test isolation. Without this, mutations (delete, ban, etc.) from one
// test would leak into subsequent tests sharing the singleton.

import { beforeEach } from "bun:test";
import { resetStore } from "@/data/index";

beforeEach(() => {
	resetStore();
});
